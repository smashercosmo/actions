import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Registry } from "./exec.ts";

import {
  CONSUMER_PACKAGE_DIR,
  CONSUMER_REPO,
  CONSUMER_URL,
  MAIN_BRANCH_NAME,
} from "./actrc.ts";
import { git, pnpm } from "./exec.ts";

/** Consumer repository fixture copied for each test. */
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../fixtures/consumer");

/**
 * Creates a consumer working tree and a bare remote that stands in for GitHub.
 *
 * The baseline package version is published and tagged first so release tests
 * start from a realistic "1.0.0 already released" state.
 *
 * @param options The options.
 * @param options.registry The mock npm registry to publish 1.0.0 to.
 * @returns The paths of the working tree and of the remote, and a `cleanup`
 *   function that deletes both.
 */
async function createMockGitRepo({ registry }: { registry: Registry }) {
  /** Resolve macOS tmpdir symlinks so Docker can mount the same path. */
  const tmpDir = fs.realpathSync(os.tmpdir());
  /**
   * Per-test layout:
   *
   * - `local`: working tree where tests commit changes and act runs workflows.
   * - `remote/consumer.git`: bare repository used as `origin`.
   */
  const rootDir = fs.mkdtempSync(path.join(tmpDir, "act-consumer-"));
  const localRepoDir = path.join(rootDir, "local");
  const remoteDir = path.join(rootDir, "remote");
  const remoteRepoDir = path.join(remoteDir, `${CONSUMER_REPO}.git`);

  fs.mkdirSync(remoteRepoDir, { recursive: true });
  git(remoteRepoDir, ["init", "--bare", "-b", MAIN_BRANCH_NAME]);

  fs.cpSync(FIXTURE_DIR, localRepoDir, { recursive: true });
  git(localRepoDir, ["init", "-b", MAIN_BRANCH_NAME]);
  /** Use deterministic commit authors regardless of host Git config. */
  git(localRepoDir, ["config", "user.name", "Test User"]);
  git(localRepoDir, ["config", "user.email", "test-user@example.com"]);
  /** Host GPG-signing settings should not affect tests. */
  git(localRepoDir, ["config", "commit.gpgsign", "false"]);
  /**
   * Rewrite both `<CONSUMER_URL>` and `<CONSUMER_URL>.git` to the local bare
   * repository.
   */
  git(localRepoDir, [
    "config",
    `url.${path.join(remoteDir, CONSUMER_REPO)}.insteadOf`,
    CONSUMER_URL,
  ]);
  git(localRepoDir, ["remote", "add", "origin", `${CONSUMER_URL}.git`]);
  git(localRepoDir, ["add", "."]);
  git(localRepoDir, ["commit", "-m", "chore: initial commit"]);
  git(localRepoDir, ["tag", "v1.0.0"]);
  git(localRepoDir, ["push", "origin", MAIN_BRANCH_NAME, "v1.0.0"]);

  /**
   * Publish the baseline version. `--no-git-checks` avoids branch/clean-tree
   * checks while the fixture is being assembled.
   */
  await pnpm(
    path.join(localRepoDir, CONSUMER_PACKAGE_DIR),
    ["publish", "--no-git-checks"],
    registry,
  );

  return {
    localRepoDir,
    remoteDir,
    remoteRepoDir,
    cleanup() {
      fs.rmSync(rootDir, { force: true, recursive: true });
    },
  };
}

export { createMockGitRepo };
