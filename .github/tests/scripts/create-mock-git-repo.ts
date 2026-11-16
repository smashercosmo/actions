import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Registry } from "./exec";

import {
  CONSUMER_PACKAGE_DIR,
  CONSUMER_REPO,
  CONSUMER_URL,
  MAIN_BRANCH_NAME,
} from "./actrc";
import { git, pnpm } from "./exec";

/** Initial template files copied into every new mock consumer repository. */
const FIXTURE_DIR = path.resolve(import.meta.dirname, "../fixtures/consumer");

/**
 * Initializes a mock consumer repository from `fixtures/consumer` alongside a
 * bare git repository that acts as its remote on github.com. All git fetch and
 * push operations targeting the consumer's GitHub URL are redirected to this
 * bare repository.
 *
 * Also publishes the fixture's initial package version (1.0.0) to the mock npm
 * registry. This establishes pre-existing release state: if no versions exist
 * on the registry, pnpm treats the first release as an initial un-bumped
 * publish. Pre-publishing version 1.0.0 allows subsequent tests to assert on
 * version bumps (e.g. 1.0.0 → 1.1.0).
 */
async function createMockGitRepo({ registry }: { registry: Registry }) {
  /**
   * Resolves symlinks in `os.tmpdir()` (common on macOS) so Docker can mount
   * directory paths reliably.
   */
  const tmpDir = fs.realpathSync(os.tmpdir());
  /**
   * Structure created for each test:
   *
   * - `<rootDir>/local`: Working tree repository where tests commit changes and
   *   act executes workflows.
   * - `<rootDir>/remote/consumer.git`: Bare git repository serving as the remote
   *   origin.
   */
  const rootDir = fs.mkdtempSync(path.join(tmpDir, "act-consumer-"));
  const localRepoDir = path.join(rootDir, "local");
  const remoteDir = path.join(rootDir, "remote");
  const remoteRepoDir = path.join(remoteDir, `${CONSUMER_REPO}.git`);

  /** Initializes a bare repository to represent the remote git server. */
  fs.mkdirSync(remoteRepoDir, { recursive: true });
  git(remoteRepoDir, ["init", "--bare", "-b", MAIN_BRANCH_NAME]);

  fs.cpSync(FIXTURE_DIR, localRepoDir, { recursive: true });
  git(localRepoDir, ["init", "-b", MAIN_BRANCH_NAME]);
  /**
   * Configures dedicated test git user identity to ensure consistent commit
   * author details across environments.
   */
  git(localRepoDir, ["config", "user.name", "Test User"]);
  git(localRepoDir, ["config", "user.email", "test-user@example.com"]);
  /**
   * Explicitly disables GPG signing so commits succeed regardless of host user
   * git configuration.
   */
  git(localRepoDir, ["config", "commit.gpgsign", "false"]);
  /**
   * Configures git `insteadOf` URL rewriting in the local repository so fetches
   * and pushes directed at `CONSUMER_URL` are routed to the local bare
   * repository. Containerized jobs receive identical settings via `getEnv` in
   * `actrc.ts`.
   *
   * Omission of `.git` in the path ensures that both `<CONSUMER_URL>` and
   * `<CONSUMER_URL>.git` match and rewrite properly.
   */
  git(localRepoDir, [
    "config",
    `url.${path.join(remoteDir, CONSUMER_REPO)}.insteadOf`,
    CONSUMER_URL,
  ]);
  /** Configures standard remote origin pointing to the canonical GitHub URL. */
  git(localRepoDir, ["remote", "add", "origin", `${CONSUMER_URL}.git`]);
  git(localRepoDir, ["add", "."]);
  git(localRepoDir, ["commit", "-m", "chore: initial commit"]);
  git(localRepoDir, ["push", "origin", MAIN_BRANCH_NAME]);

  /**
   * Publishes the baseline package version to the mock registry prior to
   * running tests. `--no-git-checks` bypasses git branch and clean working tree
   * checks during initial publish.
   */
  await pnpm(
    path.join(localRepoDir, CONSUMER_PACKAGE_DIR),
    ["publish", "--no-git-checks"],
    registry,
  );

  return {
    /** Local repository working tree directory where workflows execute. */
    localRepoDir,
    /**
     * Directory mounted into job containers to provide access to the bare
     * remote.
     */
    remoteDir,
    /**
     * Path to the bare remote repository, inspected by tests to verify pushed
     * commits and branches.
     */
    remoteRepoDir,
    cleanup() {
      fs.rmSync(rootDir, { force: true, recursive: true });
    },
  };
}

export { createMockGitRepo };
