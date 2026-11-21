import fs from "node:fs";
import { EOL, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
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
} from "./core.ts";

/**
 * Parses a runner command file, such as `GITHUB_OUTPUT`, into `[name, value]`
 * pairs using the same heredoc form the helpers write.
 *
 * @param filePath Path of the command file.
 * @returns The entries of the file, in order.
 */
function readCommandFile(filePath: string) {
  const lines = fs.readFileSync(filePath, "utf8").split(EOL);
  const entries: [name: string, value: string][] = [];
  let start = 0;

  /** Ignore the empty item after the final line break. */
  while (start < lines.length - 1) {
    const [name, delimiter] = (lines[start] ?? "").split("<<");
    const end =
      delimiter === undefined ? -1 : lines.indexOf(delimiter, start + 1);

    if (name === undefined || end === -1) {
      throw new Error(`Malformed command file entry at line ${start + 1}`);
    }

    entries.push([name, lines.slice(start + 1, end).join(EOL)]);
    start = end + 1;
  }

  return entries;
}

/**
 * Creates a temporary runner command file such as `GITHUB_OUTPUT` or
 * `GITHUB_STATE`.
 *
 * @returns The path of the file, deleted when the test finishes.
 */
function createCommandFile() {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "shared-core-"));
  const filePath = path.join(directory, "commands");

  fs.writeFileSync(filePath, "");
  onTestFinished(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return filePath;
}

/**
 * Capture stdout so assertions can inspect workflow commands.
 *
 * @returns The spy on `process.stdout.write`.
 */
function spyOnStdout() {
  return vi.spyOn(process.stdout, "write").mockReturnValue(true);
}

/**
 * Delete runner-like env vars even when tests run inside GitHub Actions.
 *
 * @param name Name of the env variable.
 */
function unsetEnv(name: string) {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- `undefined` is how Vitest is told to delete the variable, and the argument can't be left out.
  vi.stubEnv(name, undefined);
}

describe("getInput()", () => {
  it("should read the input from its env variable", () => {
    expect.hasAssertions();

    vi.stubEnv("INPUT_FORMAT-COMMAND", "pnpm exec oxfmt");

    expect(getInput("format-command")).toBe("pnpm exec oxfmt");
  });

  it("should replace spaces in the name with underscores", () => {
    expect.hasAssertions();

    vi.stubEnv("INPUT_FORMAT_COMMAND", "pnpm exec oxfmt");

    expect(getInput("format command")).toBe("pnpm exec oxfmt");
  });

  it("should trim whitespace around the value", () => {
    expect.hasAssertions();

    vi.stubEnv("INPUT_TOKEN", "  token\n");

    expect(getInput("token")).toBe("token");
  });

  it("should return an empty string for an input that isn't set", () => {
    expect.hasAssertions();

    unsetEnv("INPUT_TOKEN");

    expect(getInput("token")).toBe("");
  });

  it.for([undefined, "", "  "])(
    "should throw for a required input with the value %j",
    (value) => {
      expect.hasAssertions();

      vi.stubEnv("INPUT_TOKEN", value);

      expect(() => getInput("token", { required: true })).toThrow(
        "Input required and not supplied: token",
      );
    },
  );
});

describe("getBooleanInput()", () => {
  it.for([
    ["true", true],
    ["True", true],
    ["TRUE", true],
    ["false", false],
    ["False", false],
    ["FALSE", false],
  ] as const)("should read %j as %j", ([value, expected]) => {
    expect.hasAssertions();

    vi.stubEnv("INPUT_INCLUDE-PRIVATE", value);

    expect(getBooleanInput("include-private")).toBe(expected);
  });

  it.for([undefined, "", "yes", "1", "tRuE"])(
    "should throw for the value %j",
    (value) => {
      expect.hasAssertions();

      vi.stubEnv("INPUT_INCLUDE-PRIVATE", value);

      expect(() => getBooleanInput("include-private")).toThrow(
        'Input "include-private" isn\'t a boolean',
      );
    },
  );
});

describe("setOutput()", () => {
  it("should append the outputs to the GITHUB_OUTPUT file", () => {
    expect.hasAssertions();

    const commandFile = createCommandFile();

    vi.stubEnv("GITHUB_OUTPUT", commandFile);

    setOutput("action", "release");
    setOutput("pr-number", 42);
    setOutput("draft", false);

    expect(readCommandFile(commandFile)).toStrictEqual([
      ["action", "release"],
      ["pr-number", "42"],
      ["draft", "false"],
    ]);
  });

  it("should keep a value spanning several lines intact", () => {
    expect.hasAssertions();

    const commandFile = createCommandFile();

    vi.stubEnv("GITHUB_OUTPUT", commandFile);

    setOutput("notes", "first line\n\nname=value\nlast line");

    expect(readCommandFile(commandFile)).toStrictEqual([
      ["notes", "first line\n\nname=value\nlast line"],
    ]);
  });

  it("should use a different delimiter for every output", () => {
    expect.hasAssertions();

    const commandFile = createCommandFile();

    vi.stubEnv("GITHUB_OUTPUT", commandFile);

    setOutput("first", "1");
    setOutput("second", "2");

    const delimiters = fs
      .readFileSync(commandFile, "utf8")
      .split(EOL)
      .filter((line) => line.startsWith("ghadelimiter_"));

    expect(new Set(delimiters).size).toBe(2);
  });

  it.for([undefined, ""])("should throw when GITHUB_OUTPUT is %j", (value) => {
    expect.hasAssertions();

    vi.stubEnv("GITHUB_OUTPUT", value);

    expect(() => {
      setOutput("action", "release");
    }).toThrow("GITHUB_OUTPUT env variable isn't set");
  });
});

describe("saveState()", () => {
  it("should append the state to the GITHUB_STATE file", () => {
    expect.hasAssertions();

    const commandFile = createCommandFile();

    vi.stubEnv("GITHUB_STATE", commandFile);

    saveState("token", "ghs_token");

    expect(readCommandFile(commandFile)).toStrictEqual([
      ["token", "ghs_token"],
    ]);
  });

  it("should throw when GITHUB_STATE isn't set", () => {
    expect.hasAssertions();

    unsetEnv("GITHUB_STATE");

    expect(() => {
      saveState("token", "ghs_token");
    }).toThrow("GITHUB_STATE env variable isn't set");
  });
});

describe("getState()", () => {
  it("should read the state from its env variable", () => {
    expect.hasAssertions();

    vi.stubEnv("STATE_token", "ghs_token");

    expect(getState("token")).toBe("ghs_token");
  });

  it("should return an empty string for a state that wasn't saved", () => {
    expect.hasAssertions();

    unsetEnv("STATE_token");

    expect(getState("token")).toBe("");
  });
});

describe("setSecret()", () => {
  it("should tell the runner to mask the value", () => {
    expect.hasAssertions();

    const write = spyOnStdout();

    setSecret("ghs_token");

    expect(write).toHaveBeenCalledExactlyOnceWith(
      `::add-mask::ghs_token${EOL}`,
    );
  });

  it("should keep a value spanning several lines in one command", () => {
    expect.hasAssertions();

    const write = spyOnStdout();

    setSecret("-----BEGIN KEY-----\r\n100%\n-----END KEY-----");

    expect(write).toHaveBeenCalledExactlyOnceWith(
      `::add-mask::-----BEGIN KEY-----%0D%0A100%25%0A-----END KEY-----${EOL}`,
    );
  });
});

describe("info()", () => {
  it("should print the message as it is", () => {
    expect.hasAssertions();

    const write = spyOnStdout();

    info("Change intents added:\n100% of them");

    expect(write).toHaveBeenCalledExactlyOnceWith(
      `Change intents added:\n100% of them${EOL}`,
    );
  });
});

describe("debug()", () => {
  it("should print the message as a debug command", () => {
    expect.hasAssertions();

    const write = spyOnStdout();

    debug("Auth token has been created");

    expect(write).toHaveBeenCalledExactlyOnceWith(
      `::debug::Auth token has been created${EOL}`,
    );
  });
});

describe("warning()", () => {
  it("should print the message as a warning command", () => {
    expect.hasAssertions();

    const write = spyOnStdout();

    warning("No CHANGELOG.md section found\nfor lib@1.0.0");

    expect(write).toHaveBeenCalledExactlyOnceWith(
      `::warning::No CHANGELOG.md section found%0Afor lib@1.0.0${EOL}`,
    );
  });
});

describe("setFailed()", () => {
  it("should print the message as an error command and set a failure exit code", () => {
    expect.hasAssertions();

    const write = spyOnStdout();

    setFailed("Something went wrong");

    /**
     * Reset before asserting so a failed assertion does not poison the whole
     * test process.
     */
    const { exitCode } = process;
    process.exitCode = 0;

    expect(exitCode).toBe(1);
    expect(write).toHaveBeenCalledExactlyOnceWith(
      `::error::Something went wrong${EOL}`,
    );
  });
});
