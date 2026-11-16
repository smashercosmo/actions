import { info, setFailed } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import process from "node:process";

/**
 * The checkout of a `pull_request` event is the merge commit of the pull
 * request, and HEAD^1 is the tip of the base branch. So HEAD^1..HEAD is what
 * the pull request changes
 */
const BASE = "HEAD^1";
const HEAD = "HEAD";

/**
 * The merge commit of the release PR also has the intents that landed on the
 * base branch after the PR was built. Merged now, they would still be pending,
 * and the release workflow would open the next release PR instead of releasing
 * this one. The release workflow rebuilds the PR on every push that has pending
 * intents, so this passes again once it caught up. The intents are the Markdown
 * files directly in `.changeset/`, as `pnpm change` writes them
 */
async function requireNoPendingIntents() {
  const { stdout } = await getExecOutput(
    "git",
    ["ls-tree", "--name-only", "-z", HEAD, ".changeset/"],
    { silent: true },
  );
  const pending = stdout.split("\0").filter((file) => file.endsWith(".md"));

  if (pending.length > 0) {
    throw new Error(
      `The base branch has change intents this release PR doesn't apply yet:\n${pending.join("\n")}\nWait for the release workflow to update the PR, or run it by hand if it failed, then merge the updated PR`,
    );
  }
}

async function run() {
  const eventName = process.env["GITHUB_EVENT_NAME"];

  if (eventName !== "pull_request") {
    throw new Error(
      `Runs on \`pull_request\` events only, got \`${eventName ?? "none"}\``,
    );
  }

  const baseExitCode = await exec(
    "git",
    ["rev-parse", "--verify", "--quiet", `${BASE}^{commit}`],
    { silent: true, ignoreReturnCode: true },
  );

  if (baseExitCode !== 0) {
    throw new Error(
      "The parent of the checked out commit is missing. Check out the merge commit of the pull request with `fetch-depth: 2`",
    );
  }

  /**
   * The release PR applies the intents instead of adding one. It's the only
   * pull request that changes the ledger, which is also how the release
   * workflow recognizes it. `git diff --quiet` exits with 1 when there are
   * changes, anything other than 0 and 1 is an error
   */
  const ledgerExitCode = await exec(
    "git",
    ["diff", "--quiet", BASE, HEAD, "--", ".changeset/ledger.yaml"],
    { ignoreReturnCode: true },
  );

  if (ledgerExitCode === 1) {
    await requireNoPendingIntents();
    info("Release PR, no change intent needed");
    return;
  }

  if (ledgerExitCode !== 0) {
    throw new Error(`git diff failed with exit code ${ledgerExitCode}`);
  }

  const { stdout } = await getExecOutput(
    "git",
    [
      "diff",
      "--name-only",
      "--diff-filter=A",
      "-z",
      BASE,
      HEAD,
      "--",
      ".changeset/*.md",
      ":!.changeset/README.md",
    ],
    { silent: true },
  );
  const added = stdout.split("\0").filter(Boolean);

  if (added.length === 0) {
    throw new Error(
      "This pull request doesn't add a change intent. Run `pnpm change` and commit the file it creates, or `pnpm change --bump none` if the change needs no release",
    );
  }

  info(`Change intents added:\n${added.join("\n")}`);
}

try {
  await run();
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
