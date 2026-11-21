import { getInput, info, setFailed, setOutput } from "#shared/core.ts";
import { exec, getExecOutput } from "#shared/exec.ts";
import {
  listChangedFiles,
  listStagedChanges,
  readBlob,
  resolveId,
} from "#shared/git.ts";
import { createGitHubClient, getRepository } from "#shared/github.ts";
import { array, parse } from "#shared/schema.ts";

import {
  GitObjectSchema,
  PullRequestSchema,
  RefSchema,
  ReleasePlanSchema,
} from "./schemas.ts";

type GitHubClient = ReturnType<typeof createGitHubClient>;
type RepoPath = `/repos/${string}/${string}`;

/**
 * Applies pending change intents with `pnpm version -r` and returns the
 * packages pnpm plans to publish.
 *
 * @returns The packages with their new versions.
 */
function getReleasePlan() {
  const { stdout } = getExecOutput("pnpm", ["version", "-r", "--json"]);
  return parse(
    ReleasePlanSchema,
    JSON.parse(stdout),
    "`pnpm version -r --json`",
  );
}

/**
 * Commits staged changes on top of `HEAD` through the GitHub API and returns
 * the commit ID. No branch points at the commit yet.
 *
 * GitHub signs the commit when an app installation token is used and the
 * request sets no author or committer, so the commit shows as verified.
 *
 * @param options The options.
 * @param options.github Client authenticated with the app installation token.
 * @param options.repoPath API path of the repository.
 * @param options.message Message of the commit.
 * @returns The ID of the new commit.
 */
async function createSignedCommit({
  github,
  repoPath,
  message,
}: {
  github: GitHubClient;
  repoPath: RepoPath;
  message: string;
}) {
  const tree = await github.request(
    {
      method: "POST",
      path: `${repoPath}/git/trees`,
      body: {
        base_tree: resolveId("HEAD^{tree}"),
        tree: listStagedChanges().map(({ path, mode, blob }) =>
          blob === undefined
            ? // oxlint-disable-next-line unicorn/no-null -- The API deletes a path whose `sha` is null.
              { path, mode, type: "blob", sha: null }
            : { path, mode, type: "blob", content: readBlob(blob) },
        ),
      },
    },
    GitObjectSchema,
  );

  const commit = await github.request(
    {
      method: "POST",
      path: `${repoPath}/git/commits`,
      body: { message, tree: tree.sha, parents: [resolveId("HEAD")] },
    },
    GitObjectSchema,
  );

  return commit.sha;
}

/**
 * Points `branch` at `sha`, creating the branch if needed and discarding its
 * previous history otherwise.
 *
 * The branch moves straight from its previous commit to the new one. Resetting
 * it to the base branch first would briefly make the release PR's head point at
 * commit the base branch already contains, and GitHub might mark the PR as
 * merged.
 *
 * @param options The options.
 * @param options.github Client authenticated with the app installation token.
 * @param options.repoPath API path of the repository.
 * @param options.branch Name of the branch, without `refs/heads/`.
 * @param options.sha ID of the commit to point the branch at.
 */
async function forceUpdateBranch({
  github,
  repoPath,
  branch,
  sha,
}: {
  github: GitHubClient;
  repoPath: RepoPath;
  branch: string;
  sha: string;
}) {
  /** Matching refs are listed by prefix, e.g. `release` also lists `release-x`. */
  const ref = `heads/${branch}`;
  const matchingRefs = await github.request(
    { method: "GET", path: `${repoPath}/git/matching-refs/${ref}` },
    array(RefSchema),
  );

  const exists = matchingRefs.some(({ ref: name }) => name === `refs/${ref}`);

  await github.request(
    exists
      ? {
          method: "PATCH",
          path: `${repoPath}/git/refs/${ref}`,
          body: { sha, force: true },
        }
      : {
          method: "POST",
          path: `${repoPath}/git/refs`,
          body: { ref: `refs/${ref}`, sha },
        },
  );
}

async function run() {
  const token = getInput("token", { required: true });
  const base = getInput("base", { required: true });
  const branch = getInput("branch", { required: true });
  const formatCommand = getInput("format-command");

  const github = createGitHubClient({ token, userAgent: "create-release-pr" });
  const { owner, repo } = getRepository();

  const releasePlan = getReleasePlan();

  /**
   * An empty plan means every pending change explicitly opted out of a release.
   * Leave those intent files on the base branch for a future release PR.
   */
  if (releasePlan.length === 0) {
    info("No packages need to be released. Skipping release PR creation.");
    return;
  }

  /**
   * Pnpm keeps a package at its current version until that version is published
   * on npm. Creating another release PR for the same version would mix new
   * changes into the previous unpublished release.
   */
  const unreleased = releasePlan.filter(
    ({ currentVersion, newVersion }) => currentVersion === newVersion,
  );

  if (unreleased.length > 0) {
    const versions = unreleased
      .map(({ name, currentVersion }) => `${name}@${currentVersion}`)
      .join(", ");

    throw new Error(
      [
        `${versions} isn't on npm yet, so this release PR would release it again.`,
        `If it's staged, approve it with \`pnpm stage approve\`.`,
        `If its release failed or never ran, re-run the release PR merge workflow.`,
      ].join(" "),
    );
  }

  /**
   * Format the files `pnpm version` changed or created (the checkout is clean
   * before it runs, so every change is pnpm's). New files, like a package's
   * first CHANGELOG.md, are untracked hence "changed" files and not "staged"
   * ones.
   */
  if (formatCommand !== "") {
    const changedFiles = listChangedFiles();

    if (changedFiles.length > 0) {
      exec(formatCommand, changedFiles);
    }
  }

  /** Stage everything for the release commit. */
  exec("git", ["add", "-A"]);

  const title = `chore: release ${releasePlan
    .map(({ name, newVersion }) => `${name}@${newVersion}`)
    .join(", ")}`;

  const body = [
    "Merging this PR stages the following packages on npm.",
    "Nothing is public until the staged versions are approved (`pnpm stage approve`), which also publishes their GitHub releases:",
    "",
    ...releasePlan.map(
      ({ name, currentVersion, newVersion }) =>
        `- \`${name}\`: ${currentVersion} → ${newVersion}`,
    ),
    "",
    `It is updated automatically when new change intents land on \`${base}\`.`,
  ].join("\n");

  const repoPath = `/repos/${owner}/${repo}` as const;
  const sha = await createSignedCommit({ github, repoPath, message: title });
  await forceUpdateBranch({ github, repoPath, branch, sha });

  const pullsPath = `${repoPath}/pulls` as const;
  const [existing] = await github.request(
    {
      method: "GET",
      path: pullsPath,
      searchParams: { head: `${owner}:${branch}`, base, state: "open" },
    },
    array(PullRequestSchema),
  );

  if (existing) {
    await github.request({
      method: "PATCH",
      path: `${pullsPath}/${existing.number}`,
      body: { title, body },
    });
    info(`Updated release PR ${existing.html_url}`);
    setOutput("pr-number", existing.number);
  } else {
    const created = await github.request(
      {
        method: "POST",
        path: pullsPath,
        body: { head: branch, base, title, body },
      },
      PullRequestSchema,
    );
    info(`Opened release PR ${created.html_url}`);
    setOutput("pr-number", created.number);
  }
}

try {
  await run();
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
