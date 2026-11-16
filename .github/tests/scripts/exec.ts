import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import process from "node:process";
import { text } from "node:stream/consumers";

/**
 * Connection details for our fake in-process npm registry: its port number and
 * the path to the `.npmrc` file with the login token (see
 * `create-mock-registry.ts`).
 */
interface Registry {
  port: number;
  npmrcFile: string;
}

/**
 * Runs a git command in a folder and returns its trimmed output. If git fails,
 * it throws an error showing what went wrong.
 */
function git(cwd: string, args: readonly string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    /**
     * Stdio configuration: [stdin, stdout, stderr]
     *
     * - `ignore` stdin: Disables keyboard input so git never pauses to ask for
     *   credentials.
     * - `pipe` stdout & stderr: Captures output in memory so we can inspect it in
     *   tests without cluttering the test runner terminal.
     */
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Runs a pnpm command on the host against our fake npm registry. Throws an
 * error showing all output if the command fails.
 *
 * Why must this be asynchronous (unlike `git`)? Our fake npm registry runs
 * inside this exact same Node.js test process. If we ran pnpm synchronously,
 * Node would completely freeze waiting for pnpm to finish. But pnpm needs to
 * make HTTP requests to our fake registry! If Node is frozen, the registry
 * can't answer, and both sides would wait forever (a deadlock). An async
 * function keeps Node's event loop running so the registry can respond to
 * pnpm's requests.
 */
async function pnpm(cwd: string, args: readonly string[], registry: Registry) {
  const child = spawn("pnpm", args, {
    cwd,
    env: {
      ...process.env,
      /**
       * Tell pnpm to install and publish from our local fake registry instead
       * of npmjs.org.
       */
      pnpm_config_registry: `http://localhost:${registry.port}/`,
      /**
       * Tell pnpm which file has the auth token for our fake registry. We use
       * an environment variable because some subcommands (like `pnpm publish`)
       * crash if you pass `--npmrc-auth-file` as a CLI argument.
       */
      PNPM_CONFIG_NPMRC_AUTH_FILE: registry.npmrcFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
    /**
     * If pnpm gets stuck (e.g. waiting for a network response), kill it after 1
     * minute so the test fails.
     */
    timeout: 60_000,
  });

  /**
   * Why read the output streams while pnpm is still running? The operating
   * system gives child process pipes a small memory buffer (around 64 KB). If
   * pnpm prints more text than fits in that buffer, it pauses and waits for
   * someone to read it. If we waited until pnpm exited before reading, pnpm
   * would pause waiting for us, and we would wait for pnpm—freezing the test.
   * Reading the streams concurrently prevents this deadlock.
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
