import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { EOL } from "node:os";
import process from "node:process";

type InputOptions = Readonly<{
  /** Throw when the input is missing or empty. */
  required?: boolean;
}>;

/**
 * Workflow commands are parsed line by line. Escape line breaks and the escape
 * marker itself so the value stays inside one command.
 *
 * @param value Value to put in a workflow command.
 * @returns The escaped value.
 */
function escapeCommandValue(value: string) {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

/**
 * Sends a workflow command to the runner. See
 * https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands.
 *
 * @param command Name of the command, e.g. `warning`.
 * @param message Value of the command, escaped here.
 */
function issueCommand(command: string, message: string) {
  process.stdout.write(`::${command}::${escapeCommandValue(message)}${EOL}`);
}

/**
 * Writes a value to a runner command file such as `GITHUB_OUTPUT`. Always using
 * the multiline form keeps single-line and multiline values on the same path.
 *
 * @param variable Environment variable that holds the path of the file.
 * @param name Name of the value.
 * @param value The value itself.
 */
function appendToCommandFile(
  variable: "GITHUB_OUTPUT" | "GITHUB_STATE",
  name: string,
  value: string,
) {
  const filePath = process.env[variable];

  if (filePath === undefined || filePath === "") {
    throw new Error(`${variable} env variable isn't set`);
  }

  /** The random delimiter prevents values from ending their own heredoc. */
  const delimiter = `ghadelimiter_${randomUUID()}`;

  if (name.includes(delimiter) || value.includes(delimiter)) {
    throw new Error(
      `Neither the name nor the value can contain the delimiter "${delimiter}"`,
    );
  }

  fs.appendFileSync(
    filePath,
    `${name}<<${delimiter}${EOL}${value}${EOL}${delimiter}${EOL}`,
    "utf8",
  );
}

/**
 * Reads an action input from the environment, matching the runner's input
 * variable naming.
 *
 * @param name Name of the input, as in `action.yml`.
 * @param options Whether the input is required.
 * @returns The value of the input, trimmed, or an empty string when it's
 *   missing.
 */
function getInput(name: string, options: InputOptions = {}) {
  const variable = `INPUT_${name.replaceAll(" ", "_").toUpperCase()}`;
  const value = (process.env[variable] ?? "").trim();

  if (options.required === true && value === "") {
    throw new Error(`Input required and not supplied: ${name}`);
  }

  return value;
}

const TRUE_VALUES = new Set(["true", "True", "TRUE"]);
const FALSE_VALUES = new Set(["false", "False", "FALSE"]);

/**
 * Parses a boolean action input using the YAML 1.2 spellings GitHub documents.
 *
 * @param name Name of the input, as in `action.yml`.
 * @param options Whether the input is required.
 * @returns The value of the input.
 */
function getBooleanInput(name: string, options: InputOptions = {}) {
  const value = getInput(name, options);

  if (TRUE_VALUES.has(value)) {
    return true;
  }

  if (FALSE_VALUES.has(value)) {
    return false;
  }

  throw new TypeError(
    `Input "${name}" isn't a boolean, expected one of: true, True, TRUE, false, False, FALSE`,
  );
}

/**
 * Sets an action output for later steps.
 *
 * @param name Name of the output, as in `action.yml`.
 * @param value Value of the output, converted to a string.
 */
function setOutput(name: string, value: boolean | number | string) {
  appendToCommandFile("GITHUB_OUTPUT", name, String(value));
}

/**
 * Saves a value for the action's `post` step.
 *
 * @param name Name of the value, for `getState`.
 * @param value The value itself.
 */
function saveState(name: string, value: string) {
  appendToCommandFile("GITHUB_STATE", name, value);
}

/**
 * Reads state saved by the action's `main` step, or an empty string when no
 * state was saved.
 *
 * @param name Name the value was saved under with `saveState`.
 * @returns The saved value.
 */
function getState(name: string) {
  return process.env[`STATE_${name}`] ?? "";
}

/**
 * Masks the value in runner logs from this point on.
 *
 * @param secret Value to mask.
 */
function setSecret(secret: string) {
  issueCommand("add-mask", secret);
}

/**
 * Prints a regular log message.
 *
 * @param message Message to print.
 */
function info(message: string) {
  process.stdout.write(`${message}${EOL}`);
}

/**
 * Prints a message shown only when step debug logging is enabled.
 *
 * @param message Message to print.
 */
function debug(message: string) {
  issueCommand("debug", message);
}

/**
 * Prints a warning and adds a warning annotation to the run.
 *
 * @param message Message of the warning.
 */
function warning(message: string) {
  issueCommand("warning", message);
}

/**
 * Marks the action as failed without aborting in-flight cleanup or logging.
 *
 * @param message Message of the error annotation.
 */
function setFailed(message: string) {
  process.exitCode = 1;
  issueCommand("error", message);
}

export {
  debug,
  getBooleanInput,
  getInput,
  getState,
  info,
  saveState,
  setFailed,
  setOutput,
  setSecret,
  warning,
};
