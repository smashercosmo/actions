import fs from "node:fs";
import process from "node:process";

import { info, setFailed, setOutput } from "#shared/core.ts";
import {
  getEmptyTreeId,
  hasFileChanged,
  isCommit,
  listFiles,
} from "#shared/git.ts";

const HEAD = "HEAD";
const LEDGER = ".changeset/ledger.yaml";

/**
 * Reads the pre-push commit from GitHub's event payload without pulling in a
 * GitHub API client just for one field.
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

/**
 * Chooses the base commit for deciding what changed in this run.
 *
 * The event's `before` commit covers every commit in a push. Force-pushes, new
 * branches, and manual runs may not have it locally, so fall back to `HEAD^` or
 * the empty tree for the first commit.
 */
function resolveBase() {
  const before = readBefore();

  if (before !== "" && isCommit(before)) {
    return before;
  }

  if (isCommit(`${HEAD}^`)) {
    return `${HEAD}^`;
  }

  return getEmptyTreeId();
}

/**
 * Pending release intents are the Markdown files `pnpm change` writes directly
 * under `.changeset/`.
 */
function listPendingIntents() {
  const files = listFiles(HEAD, ".changeset/");

  return files.filter((file) => file.endsWith(".md"));
}

/**
 * Decide what this push should do:
 *
 * - `pr`: Open or update the release PR.
 * - `release`: Run the release workflow.
 * - `none`: Nothing needs to be done.
 *
 * A push should never both open a release PR and publish a release. The release
 * PR must already include every pending intent before it can merge.
 */
function plan() {
  const pending = listPendingIntents();

  if (pending.length > 0) {
    return "pr";
  }

  /**
   * Manual runs are the retry path for failed releases when no newer release PR
   * is pending.
   */
  if (process.env["GITHUB_EVENT_NAME"] === "workflow_dispatch") {
    return "release";
  }

  /** The release ledger changes only when the release PR merges. */
  const hasLedgerChanged = hasFileChanged(resolveBase(), HEAD, LEDGER);

  return hasLedgerChanged ? "release" : "none";
}

try {
  const action = plan();
  info(`Action: ${action}`);
  setOutput("action", action);
} catch (error_) {
  setFailed(error_ instanceof Error ? error_.message : String(error_));
}
