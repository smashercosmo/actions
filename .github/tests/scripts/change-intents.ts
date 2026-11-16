import type { Registry } from "./exec";

import { CONSUMER_PACKAGE, MAIN_BRANCH_NAME } from "./actrc";
import { git, pnpm } from "./exec";

/**
 * Test helpers that prepare the mock repository in the states required for
 * workflow testing, executing the same git and pnpm commands used by developers
 * or the release bot.
 *
 * A change intent is a Markdown file in `.changeset/` defining affected
 * packages, semantic version bump types, and changelog summaries. Pull requests
 * introduce them, and the automated release workflow applies them.
 */

/** Switches to the specified branch, creating it if it does not already exist. */
function switchTo(repo: string, branch: string) {
  const exists = git(repo, ["branch", "--list", branch]) !== "";
  git(repo, exists ? ["switch", branch] : ["switch", "-c", branch]);
}

/**
 * Creates and commits a change intent on a branch using `pnpm change`. Creates
 * the branch from HEAD if it does not already exist.
 *
 * Setting `bump: "none"` creates an intent that documents changes without
 * triggering a package version bump or release.
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
 * Applies pending change intents using `pnpm version -r` and commits the
 * result. This simulates the exact changes introduced in an automated release
 * PR. Returns the SHA of the resulting release commit.
 *
 * `pnpm version -r` bumps package versions in package.json, appends changelog
 * entries, deletes applied change intent files, and updates
 * `.changeset/ledger.yaml`. Workflows inspect changes to `ledger.yaml` to
 * recognize merged release commits.
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
 * Merges a branch into `main` using a non-fast-forward merge commit
 * (`--no-ff`), mirroring GitHub's PR merge behavior.
 *
 * `--no-ff` ensures a distinct merge commit is created even when fast-forward
 * is possible. This is essential for release tests, which verify that the
 * created GitHub release tag points directly to the release PR commit rather
 * than the merge commit on `main`.
 */
function mergeBranch({ repo, branch }: { repo: string; branch: string }) {
  git(repo, ["switch", MAIN_BRANCH_NAME]);
  git(repo, ["merge", "--no-ff", "-m", `Merge ${branch}`, branch]);
}

export { addChangeIntent, applyChangeIntents, mergeBranch };
