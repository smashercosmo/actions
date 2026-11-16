import { info, setFailed, setOutput } from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import fs from "node:fs";
import process from "node:process";

const HEAD = "HEAD";
const LEDGER = ".changeset/ledger.yaml";

/**
 * Get the commit the branch pointed to before this push.
 *
 * GitHub includes this commit in the push event payload. Reading it directly
 * avoids importing Octokit just to access this information.
 */
function readBefore() {
  const eventPath = process.env["GITHUB_EVENT_PATH"];
  const payload: unknown =
    eventPath !== undefined && fs.existsSync(eventPath)
      ? JSON.parse(fs.readFileSync(eventPath, "utf8"))
      : undefined;

  return typeof payload === "object" &&
    payload !== null &&
    "before" in payload &&
    typeof payload.before === "string"
    ? payload.before
    : "";
}

async function isCommit(rev: string) {
  const exitCode = await exec(
    "git",
    ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`],
    { silent: true, ignoreReturnCode: true },
  );

  return exitCode === 0;
}

/**
 * Find the commit to compare against HEAD.
 *
 * Normally, we compare against the commit the branch pointed to before the
 * push. This ensures we include changes from every commit in the push, not just
 * the last one.
 *
 * That commit may not be available after a force-push, and it doesn't exist for
 * new branches. Manual workflow runs don't provide it either.
 *
 * In those cases, fall back to the previous commit. If HEAD is the first commit
 * in the repository, use the empty Git tree instead.
 */
async function resolveBase() {
  const before = readBefore();

  if (before !== "" && (await isCommit(before))) {
    return before;
  }

  if (await isCommit(`${HEAD}^`)) {
    return `${HEAD}^`;
  }

  const { stdout } = await getExecOutput(
    "git",
    ["hash-object", "-t", "tree", "--stdin"],
    { silent: true, input: Buffer.alloc(0) },
  );

  return stdout.trim();
}

async function listPendingIntents() {
  const { stdout } = await getExecOutput(
    "git",
    ["ls-tree", "--name-only", "-z", HEAD, ".changeset/"],
    { silent: true },
  );

  return stdout.split("\0").filter((file) => file.endsWith(".md"));
}

/**
 * Check whether this push changed the release ledger.
 *
 * `git diff --quiet` returns:
 *
 * - 0 if there are no changes.
 * - 1 if there are changes.
 * - Any other code if Git encountered an error.
 */
async function hasLedgerChanged(base: string) {
  const exitCode = await exec(
    "git",
    ["diff", "--quiet", base, HEAD, "--", LEDGER],
    { ignoreReturnCode: true },
  );

  if (exitCode > 1) {
    throw new Error(`git diff failed with exit code ${exitCode}`);
  }

  return exitCode === 1;
}

/**
 * Decide what this push should do:
 *
 * - `pr`: Open or update the release PR.
 * - `release`: Run the release workflow.
 * - `none`: Nothing needs to be done.
 *
 * A push never has both pending change intents and a release: the release PR
 * can only be merged once it applies every intent on the base branch. The
 * `require-change-intent` check enforces that, together with the "Require
 * branches to be up to date before merging" rule of the base branch.
 */
async function plan() {
  const pending = await listPendingIntents();

  if (pending.length > 0) {
    return "pr";
  }

  /**
   * A manually triggered run always attempts a release when there are no
   * pending change intents. This also allows retrying failed releases.
   */
  if (process.env["GITHUB_EVENT_NAME"] === "workflow_dispatch") {
    return "release";
  }

  return (await hasLedgerChanged(await resolveBase())) ? "release" : "none";
}

try {
  const action = await plan();
  info(`Action: ${action}`);
  setOutput("action", action);
} catch (error_) {
  setFailed(error_ instanceof Error ? error_.message : String(error_));
}
