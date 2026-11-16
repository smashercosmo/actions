import type { TestProject } from "vitest/node";

import fs from "node:fs";

import { stageActionsRepo } from "./scripts/stage-actions-repo";

/**
 * Keeps a list of temporary folders created during setup so `teardown()` can
 * delete them after all tests finish.
 */
const stagedDirs: string[] = [];

/**
 * Runs once before any test begins (configured as `globalSetup` in
 * `vitest.config.ts`).
 *
 * Before `act` can run our workflows locally, we copy this repository into a
 * temporary folder and tweak internal action paths (see
 * `stage-actions-repo.ts`). Doing this once here saves time because every test
 * reuses this exact same copy.
 *
 * Because Vitest runs tests in separate worker processes, the test files cannot
 * read variables from this file directly. We use Vitest's `project.provide()`
 * to send the temporary folder paths to the worker processes, which read them
 * using `inject("localRepositories")`.
 */
function setup(project: TestProject) {
  const { dir, localRepositories } = stageActionsRepo();

  stagedDirs.push(dir);
  project.provide("localRepositories", localRepositories);
}

/** Runs once after all tests finish to delete the temporary folders we created. */
function teardown() {
  for (const dir of stagedDirs) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * Tells TypeScript the exact data types passed between `project.provide()` and
 * `inject()`, catching typos in variable names.
 */
declare module "vitest" {
  export interface ProvidedContext {
    /**
     * Arguments for act's `--local-repository` flag
     * (`<owner>/<repo>@<ref>=<path>`), pointing act to our local temporary
     * folder.
     */
    localRepositories: string[];
  }
}

export { setup, teardown };
