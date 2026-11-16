import process from "node:process";

import { info, setFailed } from "#shared/core.ts";
import {
  hasFileChanged,
  isCommit,
  listAddedFiles,
  listFiles,
} from "#shared/git.ts";

/**
 * Pull request checks run on the merge commit. `HEAD^1..HEAD` isolates what the
 * pull request adds over the base branch.
 */
const BASE = "HEAD^1";
const HEAD = "HEAD";
const LEDGER = ".changeset/ledger.yaml";

/**
 * A release PR is mergeable only after it applies every intent currently on the
 * base branch. Otherwise, those intents would remain pending after merge, and
 * the next workflow run would open another release PR instead of publishing.
 */
function requireNoPendingIntents() {
  const files = listFiles(HEAD, ".changeset/");
  const pending = files.filter((file) => file.endsWith(".md"));

  if (pending.length > 0) {
    throw new Error(
      `The base branch has change intents this release PR doesn't apply yet:\n${pending.join("\n")}\nWait for the release workflow to update the PR, or run it by hand if it failed, then merge the updated PR`,
    );
  }
}

function run() {
  const eventName = process.env["GITHUB_EVENT_NAME"];

  if (eventName !== "pull_request") {
    throw new Error(
      `Runs on \`pull_request\` events only, got \`${eventName ?? "none"}\``,
    );
  }

  if (!isCommit(BASE)) {
    throw new Error(
      "The parent of the checked out commit is missing. Check out the merge commit of the pull request with `fetch-depth: 2`",
    );
  }

  /**
   * The release PR is the only PR allowed to change the ledger because it has
   * already applied the intents.
   */
  if (hasFileChanged(BASE, HEAD, LEDGER)) {
    requireNoPendingIntents();
    info("Release PR, no change intent needed");
    return;
  }

  const added = listAddedFiles(BASE, HEAD, [".changeset/*.md"]);

  if (added.length === 0) {
    throw new Error(
      "This pull request doesn't add a change intent. Run `pnpm change` and commit the file it creates, or `pnpm change --bump none` if the change needs no release",
    );
  }

  info(`Change intents added:\n${added.join("\n")}`);
}

try {
  run();
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
