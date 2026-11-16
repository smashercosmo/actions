import { setTimeout } from "node:timers/promises";

import { info } from "#shared/core.ts";
import { getExecOutput } from "#shared/exec.ts";
import { object, parse, string } from "#shared/schema.ts";

/** Poll interval while waiting for npm approval to publish a staged version. */
const CHECK_INTERVAL_MS = 30_000;

/** Error shape printed by `pnpm view --json`. */
const ViewErrorSchema = object({
  error: object({ code: string(), message: string() }),
});

/**
 * Missing version and missing package both mean "not published yet" for staged
 * releases.
 */
const NOT_FOUND_CODES = new Set([
  "ERR_PNPM_PACKAGE_NOT_FOUND",
  "ERR_PNPM_FETCH_404",
]);

/**
 * Checks the registry configured for this workspace, not necessarily npmjs.org.
 *
 * Missing packages are treated as "not published yet"; other registry failures
 * are thrown so they are not mistaken for staging delay.
 */
function isPublished(name: string, version: string) {
  const spec = `${name}@${version}`;
  const { exitCode, stdout } = getExecOutput(
    "pnpm",
    ["view", spec, "version", "--json"],
    { silent: true, ignoreReturnCode: true },
  );

  if (exitCode === 0) {
    return true;
  }

  const { error } = parse(
    ViewErrorSchema,
    JSON.parse(stdout),
    `\`pnpm view ${spec}\``,
  );

  if (NOT_FOUND_CODES.has(error.code)) {
    return false;
  }

  throw new Error(`\`pnpm view ${spec}\` failed: ${error.message}`);
}

/**
 * Polls until `name@version` is visible on the registry or `deadline` passes. A
 * past deadline still performs one check.
 */
async function waitUntilPublished(
  name: string,
  version: string,
  deadline: number,
): Promise<boolean> {
  if (isPublished(name, version)) {
    return true;
  }

  if (Date.now() >= deadline) {
    return false;
  }

  info(`${name}@${version} isn't on npm yet, checking again in 30 seconds`);
  await setTimeout(CHECK_INTERVAL_MS);

  return waitUntilPublished(name, version, deadline);
}

export { isPublished, waitUntilPublished };
