import type { TestProject } from "vitest/node";

import fs from "node:fs";

import { stageActionsRepo } from "./scripts/stage-actions-repo.ts";

/** Temporary staged repositories to remove in global teardown. */
const stagedDirs: string[] = [];

/**
 * Stage this actions repo once and share the path with worker processes.
 *
 * Vitest global setup runs outside test workers, so values must go through
 * `project.provide()` and `inject()`.
 *
 * @param project The Vitest project to provide the values to.
 */
function setup(project: TestProject) {
  const { dir, localRepositories } = stageActionsRepo();

  stagedDirs.push(dir);
  project.provide("localRepositories", localRepositories);
}

/** Remove staged repository copies created during setup. */
function teardown() {
  for (const dir of stagedDirs) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
}

/** Type the values passed through `project.provide()` and `inject()`. */
declare module "vitest" {
  export interface ProvidedContext {
    /** Act `--local-repository` mappings: `<owner>/<repo>@<ref>=<path>`. */
    localRepositories: string[];
  }
}

export { setup, teardown };
