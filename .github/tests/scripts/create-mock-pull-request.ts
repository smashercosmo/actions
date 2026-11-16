import { MAIN_BRANCH_NAME } from "./actrc";
import { git } from "./exec";

/**
 * Simulates a GitHub pull request merge commit and returns the `pull_request`
 * webhook payload.
 *
 * On GitHub, every open PR maintains a synthetic merge commit at
 * `refs/pull/<number>/merge` representing the merge of the PR branch into the
 * base branch (`main`). Workflows triggered by `pull_request` check out this
 * merge commit to test the integration result. Since the local mock git remote
 * lacks a GitHub server, this function creates the merge commit and ref
 * directly.
 */
function createMockPullRequest({
  repo,
  branch,
  number,
  author = "octocat",
}: {
  repo: string;
  branch: string;
  number: number;
  author?: string;
}) {
  /**
   * Computes a 3-way merge tree between `main` and the PR branch without
   * modifying the working tree on disk.
   */
  const tree = git(repo, [
    "merge-tree",
    "--write-tree",
    MAIN_BRANCH_NAME,
    branch,
  ]);

  /**
   * Creates the merge commit with `main` as the first parent (`HEAD^1`) and the
   * PR branch as the second parent (`HEAD^2`). This parent order is critical
   * because `require-change-intent` inspects `HEAD^1..HEAD` to isolate commits
   * introduced by the PR.
   */
  const mergeCommit = git(repo, [
    "commit-tree",
    tree,
    "-p",
    MAIN_BRANCH_NAME,
    "-p",
    branch,
    "-m",
    `Merge ${branch} into ${MAIN_BRANCH_NAME}`,
  ]);

  /**
   * Updates the `refs/pull/<number>/merge` ref on the mock remote so
   * `actions/checkout` can fetch it during workflow runs.
   */
  const mergeRef = `refs/pull/${number}/merge`;
  git(repo, ["update-ref", mergeRef, mergeCommit]);
  git(repo, ["push", "--force", "origin", `${mergeRef}:${mergeRef}`]);

  /**
   * Points HEAD in the local test repository to the merge commit so act sets
   * `github.sha` to match the PR merge commit, mirroring GitHub Actions
   * behavior.
   */
  git(repo, ["checkout", "--detach", mergeCommit]);

  /**
   * Generates a partial `pull_request` webhook payload. The author login is
   * used by workflows to filter out Dependabot PRs.
   */
  return {
    action: "opened",
    number,
    pull_request: {
      number,
      state: "open",
      base: { ref: MAIN_BRANCH_NAME },
      head: { ref: branch },
      user: { login: author },
    },
  } as const;
}

export { createMockPullRequest };
