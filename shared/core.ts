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
 */
function issueCommand(command: string, message: string) {
  process.stdout.write(`::${command}::${escapeCommandValue(message)}${EOL}`);
}

/**
 * Writes a value to a runner command file such as `GITHUB_OUTPUT`. Always using
 * the multiline form keeps single-line and multiline values on the same path.
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

/** Parses a boolean action input using the YAML 1.2 spellings GitHub documents. */
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

/** Sets an action output for later steps. */
function setOutput(name: string, value: boolean | number | string) {
  appendToCommandFile("GITHUB_OUTPUT", name, String(value));
}

/** Saves a value for the action's `post` step. */
function saveState(name: string, value: string) {
  appendToCommandFile("GITHUB_STATE", name, value);
}

/**
 * Reads state saved by the action's `main` step, or an empty string when no
 * state was saved.
 */
function getState(name: string) {
  return process.env[`STATE_${name}`] ?? "";
}

/** Masks the value in runner logs from this point on. */
function setSecret(secret: string) {
  issueCommand("add-mask", secret);
}

/** Prints a regular log message. */
function info(message: string) {
  process.stdout.write(`${message}${EOL}`);
}

/** Prints a message shown only when step debug logging is enabled. */
function debug(message: string) {
  issueCommand("debug", message);
}

/** Prints a warning and adds a warning annotation to the run. */
function warning(message: string) {
  issueCommand("warning", message);
}

/** Marks the action as failed without aborting in-flight cleanup or logging. */
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
