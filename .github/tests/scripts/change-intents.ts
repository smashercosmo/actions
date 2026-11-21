import type { Registry } from "./exec.ts";

import { CONSUMER_PACKAGE, MAIN_BRANCH_NAME } from "./actrc.ts";
import { git, pnpm } from "./exec.ts";

/**
 * Helpers that prepare release workflow states using the same git and pnpm
 * commands a developer or release bot would run.
 */

/**
 * Switch to a branch, creating it from HEAD when needed.
 *
 * @param repo Path of the repository.
 * @param branch Name of the branch.
 */
function switchTo(repo: string, branch: string) {
  const exists = git(repo, ["branch", "--list", branch]) !== "";
  git(repo, exists ? ["switch", branch] : ["switch", "-c", branch]);
}

/**
 * Creates and commits a `.changeset/` intent on the requested branch.
 *
 * @param options The options.
 * @param options.repo Path of the repository.
 * @param options.registry The mock npm registry.
 * @param options.branch Branch to commit the intent on.
 * @param options.bump Version bump of the intent.
 * @param options.summary Summary of the intent.
 */
async function addChangeIntent({
  repo,
  registry,
  branch,
  bump,
  summary,
}: {
  repo: string;
  registry: Registry;
  branch: string;
  bump: "none" | "patch" | "minor" | "major";
  summary: string;
}) {
  switchTo(repo, branch);
  await pnpm(
    repo,
    ["change", "--bump", bump, "--summary", summary, CONSUMER_PACKAGE],
    registry,
  );
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", `docs: add a change intent (${bump})`]);
}

/**
 * Applies pending intents and commits the release PR result. The ledger change
 * is what release planning later recognizes as a merged release.
 *
 * @param options The options.
 * @param options.repo Path of the repository.
 * @param options.registry The mock npm registry.
 * @param options.branch Branch to commit the release on.
 * @returns The ID of the release commit.
 */
async function applyChangeIntents({
  repo,
  registry,
  branch,
}: {
  repo: string;
  registry: Registry;
  branch: string;
}) {
  switchTo(repo, branch);
  await pnpm(repo, ["version", "-r"], registry);
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "chore: release"]);

  return git(repo, ["rev-parse", "HEAD"]);
}

/**
 * Merge like GitHub's PR button: always create a merge commit, even when a
 * fast-forward is possible.
 *
 * @param options The options.
 * @param options.repo Path of the repository.
 * @param options.branch Branch to merge into `main`.
 */
function mergeBranch({ repo, branch }: { repo: string; branch: string }) {
  git(repo, ["switch", MAIN_BRANCH_NAME]);
  git(repo, ["merge", "--no-ff", "-m", `Merge ${branch}`, branch]);
}

export { addChangeIntent, applyChangeIntents, mergeBranch };
