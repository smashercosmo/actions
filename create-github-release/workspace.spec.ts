import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";

import { listWorkspacePackages } from "./workspace.ts";

/**
 * Copies the fixture workspace to a temporary cwd so pnpm sees a real workspace
 * without mutating the fixture.
 *
 * @returns The temporary directory, now the cwd.
 */
function copyFixture() {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(tmpdir(), "create-github-release-")),
  );
  const previous = process.cwd();

  fs.cpSync(
    fileURLToPath(import.meta.resolve("#gh/tests/fixtures/consumer")),
    directory,
    {
      recursive: true,
    },
  );
  process.chdir(directory);
  onTestFinished(() => {
    process.chdir(previous);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  return directory;
}

describe("listWorkspacePackages()", () => {
  it("should parse what the real pnpm lists for a workspace", () => {
    expect.hasAssertions();

    const directory = copyFixture();

    expect(listWorkspacePackages()).toStrictEqual([
      { name: "consumer", version: undefined, path: directory, private: true },
      {
        name: "acme-lib",
        version: "1.0.0",
        path: path.join(directory, "packages", "lib"),
        private: false,
      },
    ]);
  });
});
