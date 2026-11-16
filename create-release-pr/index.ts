import { getInput, setOutput, info, setFailed } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import { getOctokit, context } from "@actions/github";
import { type PlannedRelease } from "@pnpm/releasing.versioning";
import { z } from "zod";

/**
 * The structure of the JSON output produced by `pnpm version -r --json`.
 *
 * Each entry describes a package that pnpm plans to release, including its
 * current version and the version it will be updated to.
 */
const ReleasePlanSchema = z.toZod<
  Array<Pick<PlannedRelease, "name" | "newVersion" | "currentVersion">>
>()(
  z.array(
    z.object({
      name: z.string(),
      currentVersion: z.string(),
      newVersion: z.string(),
    }),
  ),
);

async function run() {
  const token = getInput("token", { required: true });
  const appSlug = getInput("app-slug", { required: true });
  const base = getInput("base", { required: true });
  const branch = getInput("branch", { required: true });
  const formatCommand = getInput("format-command");

  const octokit = getOctokit(token);
  const { owner, repo } = context.repo;

  const bot = `${appSlug}[bot]`;
  const { data: botUser } = await octokit.rest.users.getByUsername({
    username: bot,
  });
  await exec("git", ["config", "user.name", bot]);
  await exec("git", [
    "config",
    "user.email",
    `${botUser.id}+${bot}@users.noreply.github.com`,
  ]);

  /** Create the release branch or reset it if it already exists. */
  await exec("git", ["switch", "-C", branch]);

  const { stdout: releasePlanOutput } = await getExecOutput("pnpm", [
    "version",
    "-r",
    "--json",
  ]);
  const parsedReleasePlanOutput = ReleasePlanSchema.safeParse(
    JSON.parse(releasePlanOutput),
  );

  if (!parsedReleasePlanOutput.success) {
    throw new Error(
      `\`pnpm version -r --json\` failed to produce a release plan:\n${z.prettifyError(parsedReleasePlanOutput.error)}`,
    );
  }

  const releasePlan = parsedReleasePlanOutput.data;

  /**
   * If the release plan is empty, none of the pending changes require a version
   * bump (for example, they may use `pnpm change --bump none`).
   *
   * There's nothing to release, so we don't need to create or update a release
   * PR. The change files are left untouched on the base branch and can be
   * handled by a future release PR.
   */
  if (releasePlan.length === 0) {
    info("No packages need to be released. Skipping release PR creation.");
    return;
  }

  /**
   * Check if a previous release is still waiting to be published.
   *
   * Pnpm keeps the current version when a release hasn't been published to npm
   * yet, even if it's already staged.
   *
   * Creating another release for the same version could cause publishing
   * conflicts or include changes that aren't part of the original release. The
   * previous release must be completed first.
   */
  const unreleased = releasePlan.filter(
    ({ currentVersion, newVersion }) => currentVersion === newVersion,
  );

  if (unreleased.length > 0) {
    const versions = unreleased
      .map(({ name, currentVersion }) => `${name}@${currentVersion}`)
      .join(", ");

    throw new Error(
      `${versions} isn't on npm yet, so this release PR would release it again. If it's staged, approve it with \`pnpm stage approve\`. If its release failed or never ran, re-run the release workflow run of the release PR merge. If the release PR was merged while change intents were pending, revert that merge instead. Then re-run this job`,
    );
  }

  await exec("git", ["add", "-A"]);

  /** Format only the files pnpm modified or created */
  if (formatCommand !== "") {
    const { stdout: changedFilesOutput } = await getExecOutput(
      "git",
      ["diff", "--staged", "--name-only", "--diff-filter=d", "-z"],
      { silent: true },
    );
    const changedFiles = changedFilesOutput.split("\0").filter(Boolean);

    if (changedFiles.length > 0) {
      await exec(formatCommand, changedFiles);
    }
  }

  const title = `chore: release ${releasePlan
    .map(({ name, newVersion }) => `${name}@${newVersion}`)
    .join(", ")}`;

  const body = [
    "Merging this PR stages the following packages on npm and drafts their GitHub releases.",
    "Nothing is public until the staged versions are approved (`pnpm stage approve`) and the drafts are published:",
    "",
    ...releasePlan.map(
      ({ name, currentVersion, newVersion }) =>
        `- \`${name}\`: ${currentVersion} → ${newVersion}`,
    ),
    "",
    `It is updated automatically when new change intents land on \`${base}\`.`,
  ].join("\n");

  await exec("git", ["add", "-A"]);
  await exec("git", ["commit", "-m", title]);
  await exec(
    "git",
    [
      "remote",
      "set-url",
      "origin",
      `https://x-access-token:${token}@github.com/${owner}/${repo}.git`,
    ],
    { silent: true },
  );
  await exec("git", ["push", "--force", "origin", branch]);

  const { data: pulls } = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${branch}`,
    base,
    state: "open",
  });

  const [existing] = pulls;

  if (existing) {
    await octokit.rest.pulls.update({
      owner,
      repo,
      pull_number: existing.number,
      title,
      body,
    });
    info(`Updated release PR ${existing.html_url}`);
    setOutput("pr-number", existing.number);
  } else {
    const { data: created } = await octokit.rest.pulls.create({
      owner,
      repo,
      head: branch,
      base,
      title,
      body,
    });
    info(`Opened release PR ${created.html_url}`);
    setOutput("pr-number", created.number);
  }
}

try {
  await run();
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
