import { EOL } from "node:os";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";

import { exec, getExecOutput } from "./exec.ts";

/**
 * Use Node as the test executable because it is always available here. Quote
 * the path because it can contain spaces.
 */
const NODE = `"${process.execPath}"`;

/** Script fixture that writes to both output streams. */
const PRINT_SCRIPT = "console.log('to stdout'); console.error('to stderr')";

/** Script fixture that reports argv as JSON. */
const ARGS_SCRIPT = "JSON.stringify(process.argv.slice(1))";

/** Script fixture that echoes stdin. */
const STDIN_SCRIPT = "process.stdin.pipe(process.stdout)";

/** Capture logs so assertions can inspect them without noisy test output. */
function spyOnStdout() {
  return vi.spyOn(process.stdout, "write").mockReturnValue(true);
}

describe("getExecOutput()", () => {
  it("should return the exit code and the output of the command", () => {
    expect.hasAssertions();

    expect(
      getExecOutput(NODE, ["-e", PRINT_SCRIPT], { silent: true }),
    ).toStrictEqual({
      exitCode: 0,
      stdout: "to stdout\n",
      stderr: "to stderr\n",
    });
  });

  it("should pass the arguments as they are", () => {
    expect.hasAssertions();

    const args = ["two words", 'say "hi"', "$HOME", "*", ""];
    const { stdout } = getExecOutput(NODE, ["-p", ARGS_SCRIPT, ...args], {
      silent: true,
    });

    expect(JSON.parse(stdout)).toStrictEqual(args);
  });

  it("should take the arguments of the command line before the others", () => {
    expect.hasAssertions();

    const { stdout } = getExecOutput(
      String.raw`${NODE} -p ${ARGS_SCRIPT} one  "two words" "say \"hi\"" back\slash`,
      ["three"],
      { silent: true },
    );

    expect(JSON.parse(stdout)).toStrictEqual([
      "one",
      "two words",
      'say "hi"',
      String.raw`back\slash`,
      "three",
    ]);
  });

  it("should write the input to the stdin of the command", () => {
    expect.hasAssertions();

    const { stdout } = getExecOutput(NODE, ["-e", STDIN_SCRIPT], {
      silent: true,
      input: "from stdin",
    });

    expect(stdout).toBe("from stdin");
  });

  it("should give the command an empty stdin without the input", () => {
    expect.hasAssertions();

    const { stdout } = getExecOutput(NODE, ["-e", STDIN_SCRIPT], {
      silent: true,
    });

    expect(stdout).toBe("");
  });

  it("should throw when the command exits with a non-zero code", () => {
    expect.hasAssertions();

    expect(() =>
      getExecOutput(NODE, ["-e", "process.exit(3)"], { silent: true }),
    ).toThrow(`The process '${process.execPath}' failed with exit code 3`);
  });

  it("should return a non-zero exit code when it's ignored", () => {
    expect.hasAssertions();

    expect(
      getExecOutput(NODE, ["-e", `${PRINT_SCRIPT}; process.exit(3)`], {
        silent: true,
        ignoreReturnCode: true,
      }),
    ).toStrictEqual({
      exitCode: 3,
      stdout: "to stdout\n",
      stderr: "to stderr\n",
    });
  });

  it("should throw when the command is terminated by a signal", () => {
    expect.hasAssertions();

    expect(() =>
      getExecOutput(NODE, ["-e", "process.kill(process.pid, 'SIGKILL')"], {
        silent: true,
        ignoreReturnCode: true,
      }),
    ).toThrow(`The process '${process.execPath}' was terminated by SIGKILL`);
  });

  it("should throw when the command doesn't exist", () => {
    expect.hasAssertions();

    expect(() =>
      getExecOutput("surely-there-is-no-such-command", [], { silent: true }),
    ).toThrow("Failed to run 'surely-there-is-no-such-command'");
  });

  it.for(["", "   "])("should throw for the command line %j", (commandLine) => {
    expect.hasAssertions();

    expect(() => getExecOutput(commandLine)).toThrow(
      "The command to run can't be empty",
    );
  });

  it("should print the command and its output to the log", () => {
    expect.hasAssertions();

    const write = spyOnStdout();

    getExecOutput(NODE, ["-e", PRINT_SCRIPT]);

    expect(write.mock.calls.map(([chunk]) => chunk)).toStrictEqual([
      `[command]${process.execPath} -e ${PRINT_SCRIPT}${EOL}`,
      "to stdout\nto stderr\n",
    ]);
  });

  it("should print nothing to the log when silent", () => {
    expect.hasAssertions();

    const write = spyOnStdout();

    getExecOutput(NODE, ["-e", PRINT_SCRIPT], { silent: true });

    expect(write).not.toHaveBeenCalled();
  });
});

describe("exec()", () => {
  it("should return the exit code of the command", () => {
    expect.hasAssertions();

    expect(exec(NODE, ["-e", ""], { silent: true })).toBe(0);
  });

  it("should return a non-zero exit code when it's ignored", () => {
    expect.hasAssertions();

    expect(
      exec(NODE, ["-e", "process.exit(1)"], {
        silent: true,
        ignoreReturnCode: true,
      }),
    ).toBe(1);
  });

  it("should throw when the command exits with a non-zero code", () => {
    expect.hasAssertions();

    expect(() =>
      exec(NODE, ["-e", "process.exit(1)"], { silent: true }),
    ).toThrow(`The process '${process.execPath}' failed with exit code 1`);
  });
});
