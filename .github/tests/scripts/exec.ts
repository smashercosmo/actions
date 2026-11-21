import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import process from "node:process";
import { text } from "node:stream/consumers";

/** Connection details for the in-process registry and its auth file. */
interface Registry {
  port: number;
  npmrcFile: string;
}

/**
 * Run git in `cwd`.
 *
 * @param cwd Directory to run git in.
 * @param args The arguments of git.
 * @param options The options.
 * @param options.input Written to stdin.
 * @param options.env Added to the environment.
 * @returns The trimmed stdout.
 */
function git(
  cwd: string,
  args: readonly string[],
  {
    input,
    env = {},
  }: { input?: string; env?: Readonly<Record<string, string>> } = {},
) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    /**
     * Without `input`, disable stdin so git cannot prompt. Capture output for
     * assertions and failure messages.
     */
    ...(input === undefined
      ? { stdio: ["ignore", "pipe", "pipe"] }
      : { input, stdio: ["pipe", "pipe", "pipe"] }),
  }).trim();
}

/**
 * Runs pnpm on the host against the fake npm registry.
 *
 * This must stay async: the registry runs in this same Node process, so a
 * synchronous pnpm child would block the event loop and deadlock its own HTTP
 * requests.
 *
 * @param cwd Directory to run pnpm in.
 * @param args The arguments of pnpm.
 * @param registry The mock npm registry.
 */
async function pnpm(cwd: string, args: readonly string[], registry: Registry) {
  const child = spawn("pnpm", args, {
    cwd,
    env: {
      ...process.env,
      pnpm_config_registry: `http://localhost:${registry.port}/`,
      /**
       * Some pnpm subcommands crash when this is passed as a CLI flag, so use
       * the environment variable form.
       */
      PNPM_CONFIG_NPMRC_AUTH_FILE: registry.npmrcFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
    /** Kill hung network waits quickly enough for the test to fail usefully. */
    timeout: 60_000,
  });

  /**
   * Drain output while pnpm runs; otherwise a full pipe buffer can block pnpm
   * before it exits.
   */
  const [stdout, stderr, [exitCode]] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    once(child, "close"),
  ]);

  if (exitCode !== 0) {
    throw new Error(`pnpm ${args.join(" ")} failed\n${stdout}\n${stderr}`);
  }
}

export type { Registry };
export { git, pnpm };
