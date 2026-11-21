import { MAIN_BRANCH_NAME } from "./actrc.ts";
import { git } from "./exec.ts";

/**
 * Creates GitHub's synthetic PR merge commit. The mock remote has no GitHub
 * server to maintain `refs/pull/<number>/merge`, so tests create it directly.
 *
 * @param options The options.
 * @param options.repo Path of the repository.
 * @param options.branch Head branch of the PR, merged into `main`.
 * @param options.number Number of the PR.
 * @param options.author Login of the PR's author.
 * @returns The payload of the pull request event.
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
  /** Compute the merge result without changing the working tree. */
  const tree = git(repo, [
    "merge-tree",
    "--write-tree",
    MAIN_BRANCH_NAME,
    branch,
  ]);

  /**
   * Keep GitHub's parent order: base as `HEAD^1`, PR branch as `HEAD^2`.
   * `require-change-intent` relies on `HEAD^1..HEAD` being the PR diff.
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

  /** Publish the synthetic merge ref so `actions/checkout` can fetch it. */
  const mergeRef = `refs/pull/${number}/merge`;
  git(repo, ["update-ref", mergeRef, mergeCommit]);
  git(repo, ["push", "--force", "origin", `${mergeRef}:${mergeRef}`]);

  /** Detach at the merge commit so act uses the same `github.sha` GitHub would. */
  git(repo, ["checkout", "--detach", mergeCommit]);

  /** Include only the payload fields these workflows read. */
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
