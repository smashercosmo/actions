import { getInput, info, setFailed, setOutput } from "#shared/core.ts";
import { exec, getExecOutput } from "#shared/exec.ts";
import { listStagedFiles } from "#shared/git.ts";
import { createGitHubClient, getRepository } from "#shared/github.ts";
import { array, parse } from "#shared/schema.ts";

import { PullRequestSchema, ReleasePlanSchema, UserSchema } from "./schemas.ts";

/**
 * Applies pending change intents with `pnpm version -r` and returns the
 * packages pnpm plans to publish.
 */
function applyChangeIntents() {
  const { stdout } = getExecOutput("pnpm", ["version", "-r", "--json"]);
  return parse(
    ReleasePlanSchema,
    JSON.parse(stdout),
    "`pnpm version -r --json`",
  );
}

async function run() {
  const token = getInput("token", { required: true });
  const appSlug = getInput("app-slug", { required: true });
  const base = getInput("base", { required: true });
  const branch = getInput("branch", { required: true });
  const formatCommand = getInput("format-command");

  const github = createGitHubClient({ token, userAgent: "create-release-pr" });
  const { owner, repo } = getRepository();

  const bot = `${appSlug}[bot]`;
  const botUser = await github.request(
    { method: "GET", path: `/users/${encodeURIComponent(bot)}` },
    UserSchema,
  );
  exec("git", ["config", "user.name", bot]);
  exec("git", [
    "config",
    "user.email",
    `${botUser.id}+${bot}@users.noreply.github.com`,
  ]);

  exec("git", ["switch", "-C", branch]);

  const releasePlan = applyChangeIntents();

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
        `If the release PR was merged while change intents were pending,`,
        `revert that merge instead. Then re-run this job.`,
      ].join(" "),
    );
  }

  exec("git", ["add", "-A"]);

  /**
   * Format exactly the files `pnpm version` staged, then stage formatter
   * output.
   */
  if (formatCommand !== "") {
    const changedFiles = listStagedFiles();

    if (changedFiles.length > 0) {
      exec(formatCommand, changedFiles);
    }
  }

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

  exec("git", ["add", "-A"]);
  exec("git", ["commit", "-m", title]);
  exec(
    "git",
    [
      "remote",
      "set-url",
      "origin",
      `https://x-access-token:${token}@github.com/${owner}/${repo}.git`,
    ],
    { silent: true },
  );
  exec("git", ["push", "--force", "origin", branch]);

  const pullsPath = `/repos/${owner}/${repo}/pulls` as const;
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
