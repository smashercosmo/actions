import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ACTIONS_REF, ACTIONS_REPOSITORY } from "./actrc.ts";
import { git } from "./exec.ts";

/** Root of this actions repository. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Internal action reference (`uses: $/<path>`) that GitHub resolves relative to
 * the reusable workflow repository.
 */
const SELF_REFERENCE = /(?<uses>\buses:\s*)\$\/(?<path>\S+)/gv;

/**
 * Act rejects the newer `queue` concurrency key and ignores concurrency groups,
 * so workflow tests can safely remove it from the staged copy.
 */
const CONCURRENCY_QUEUE = /^[\t ]*queue:[\t ]*(?:max|single)[\t ]*\n/gmv;

/**
 * Lists workflow and action YAML files under `dir`.
 *
 * @param dir Directory to search, recursively.
 * @returns The paths of the files.
 */
function listYamlFiles(dir: string) {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.ya?ml$/v.test(file))
    .map((file) => path.join(dir, file));
}

/**
 * Stages the current working tree for act, including uncommitted changes.
 *
 * GitHub supports `uses: $/<path>` in reusable workflows; act does not. Rewrite
 * those references to an explicit local repository ref that act can map with
 * `--local-repository`.
 *
 * @returns The temporary directory with the copy.
 */
function copyWorkingTree() {
  /** Resolve macOS tmpdir symlinks so Docker sees the same paths. */
  const tmpDir = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(tmpDir, "act-actions-"));

  /**
   * Copy tracked files plus untracked unignored files. NUL delimiters preserve
   * unusual paths.
   */
  const files = git(REPO_ROOT, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ])
    .split("\0")
    .filter((file) => file !== "" && !file.startsWith(".github/tests/"));

  for (const file of files) {
    const source = path.join(REPO_ROOT, file);

    /** Skip deleted files that still appear in the index. */
    if (fs.existsSync(source)) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }

  /** Rewrite only the staged copy, never the developer working tree. */
  for (const file of listYamlFiles(dir)) {
    const content = fs.readFileSync(file, "utf8");
    fs.writeFileSync(
      file,
      content
        .replaceAll(
          SELF_REFERENCE,
          `$<uses>${ACTIONS_REPOSITORY}/$<path>@${ACTIONS_REF}`,
        )
        .replaceAll(CONCURRENCY_QUEUE, ""),
    );
  }

  return dir;
}

/**
 * Stages this actions repo for act.
 *
 * @returns The staged repo plus the act mapping that routes this repo's action
 *   calls to it.
 */
function stageActionsRepo() {
  const dir = copyWorkingTree();

  return {
    dir,
    localRepositories: [`${ACTIONS_REPOSITORY}@${ACTIONS_REF}=${dir}`],
  };
}

export { stageActionsRepo };
