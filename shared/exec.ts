import { spawnSync } from "node:child_process";
import { EOL } from "node:os";
import process from "node:process";

type ExecOptions = Readonly<{
  /** Do not print the command or its output. */
  silent?: boolean;
  /** Return a non-zero exit code instead of throwing. */
  ignoreReturnCode?: boolean;
  /** Data written to stdin. Omitted means empty stdin. */
  input?: Buffer | string;
}>;

type ExecOutput = Readonly<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

/**
 * Splits a command line such as `pnpm exec oxfmt` into the command and its
 * arguments.
 *
 * Arguments are separated by spaces. Double quotes keep the spaces inside them
 * and are not part of the argument; inside quotes, `\"` means a literal quote.
 * This is intentionally much smaller than a shell parser.
 *
 * @param commandLine Command line to split.
 * @returns The command, then its arguments.
 */
function splitCommandLine(commandLine: string) {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;

  for (const character of commandLine) {
    if (escaped) {
      /** Inside quotes, only `\"` is special; other backslashes stay literal. */
      current += character === '"' ? character : `\\${character}`;
      escaped = false;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === "\\" && inQuotes) {
      escaped = true;
    } else if (character === " " && !inQuotes) {
      if (current !== "") {
        parts.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }

  if (current !== "") {
    parts.push(current);
  }

  return parts;
}

/**
 * Runs a command and returns its exit code and everything it printed.
 *
 * The command is run directly, not in a shell, so the arguments need no
 * escaping. Unless `silent` is set, the command and its output are also printed
 * to the log, the output once the command has finished.
 *
 * Throws if the command can't be started, is terminated by a signal, or exits
 * with a non-zero code (unless `ignoreReturnCode` is set).
 *
 * @param commandLine The command to run. Can include arguments (see
 *   `splitCommandLine`), which come before `args`.
 * @param args The arguments, passed to the command as they are.
 * @param options How to run the command, see `ExecOptions`.
 * @returns The exit code and the output of the command.
 */
function getExecOutput(
  commandLine: string,
  args: readonly string[] = [],
  options: ExecOptions = {},
): ExecOutput {
  const { silent = false, ignoreReturnCode = false, input } = options;
  const [command, ...commandLineArgs] = splitCommandLine(commandLine);

  if (command === undefined) {
    throw new Error("The command to run can't be empty");
  }

  const commandArgs = [...commandLineArgs, ...args];

  if (!silent) {
    process.stdout.write(
      `[command]${[command, ...commandArgs].join(" ")}${EOL}`,
    );
  }

  /** `spawnSync` closes stdin after writing `input`, so the child cannot hang. */
  const { error, status, signal, stdout, stderr } = spawnSync(
    command,
    commandArgs,
    { input, encoding: "utf8" },
  );

  /** For example, the executable was not found. */
  if (error !== undefined) {
    throw new Error(`Failed to run '${command}': ${error.message}`, {
      cause: error,
    });
  }

  /**
   * Many tools, including Git, report progress on stderr. In Actions logs that
   * progress belongs next to stdout, so print both streams together.
   */
  if (!silent) {
    process.stdout.write(`${stdout}${stderr}`);
  }

  if (status === null) {
    throw new Error(`The process '${command}' was terminated by ${signal}`);
  }

  if (status !== 0 && !ignoreReturnCode) {
    throw new Error(`The process '${command}' failed with exit code ${status}`);
  }

  return { exitCode: status, stdout, stderr };
}

/**
 * Runs a command when the caller only needs the exit code.
 *
 * @param commandLine The command to run, as for `getExecOutput`.
 * @param args The arguments, passed to the command as they are.
 * @param options How to run the command, see `ExecOptions`.
 * @returns The exit code of the command.
 */
function exec(
  commandLine: string,
  args: readonly string[] = [],
  options: ExecOptions = {},
) {
  return getExecOutput(commandLine, args, options).exitCode;
}

export { exec, getExecOutput };
