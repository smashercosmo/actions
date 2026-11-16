import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ACTIONS_REF, ACTIONS_REPOSITORY } from "./actrc";
import { git } from "./exec";

/** Root directory of this repository (three levels up from this script). */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * Matches internal workflow actions referenced via `uses: $/<path>`. Captures
 * `uses:` and whitespace to preserve formatting, and `path` to rewrite the
 * action target.
 */
const SELF_REFERENCE = /(?<uses>\buses:\s*)\$\/(?<path>\S+)/gv;

/**
 * Matches the `queue` key of a concurrency group. act doesn't know the key yet
 * and rejects the whole workflow because of it (nektos/act#6095). It ignores
 * concurrency groups anyway, so the staged copy can do without the line.
 */
const CONCURRENCY_QUEUE = /^[\t ]*queue:[\t ]*(?:max|single)[\t ]*\n/gmv;

/**
 * Recursively discovers all YAML workflow and action manifest files in a
 * directory.
 */
function listYamlFiles(dir: string) {
  return fs
    .readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.ya?ml$/v.test(file))
    .map((file) => path.join(dir, file));
}

/**
 * Copies unignored working tree files to a temporary directory and rewrites
 * `$/<path>` action references to explicit repository refs
 * (`smashercosmo/actions/<path>@local`).
 *
 * GitHub Actions resolves `$/` to the repository containing the reusable
 * workflow. However, act does not natively support `$/` syntax. By rewriting
 * `$/` to a pinned ref and mapping that ref via act's `--local-repository`
 * flag, act resolves action steps to the local staged directory.
 *
 * Files are copied directly from the working tree rather than git commits so
 * tests can validate uncommitted local modifications.
 */
function copyWorkingTree() {
  /** Resolves symlinks in `os.tmpdir()` (common on macOS). */
  const tmpDir = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(tmpDir, "act-actions-"));

  /**
   * Queries git for tracked files (`--cached`) and untracked unignored files
   * (`--others --exclude-standard`). Delimited by NUL (`-z`) to safely handle
   * arbitrary paths. Excludes `.github/tests/` because workflows do not depend
   * on test files.
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

    /** Skips deleted files that still linger in the git staging index. */
    if (fs.existsSync(source)) {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    }
  }

  /**
   * Rewrites `$/` self-references and removes the `queue` key of concurrency
   * groups within workflow and action YAML files in the staged copy only.
   */
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
 * Prepares the local actions repository for act test runs.
 *
 * Returns the temporary directory path and the `--local-repository` argument
 * mapping `<owner>/<repo>@<ref>=<path>` so act routes action calls to the
 * staged files. Third-party actions are cached separately by act (see
 * `getAdditionalArgs` in `actrc.ts`).
 */
function stageActionsRepo() {
  const dir = copyWorkingTree();

  return {
    dir,
    /** Act `--local-repository` option format: `<owner>/<repo>@<ref>=<folder>`. */
    localRepositories: [`${ACTIONS_REPOSITORY}@${ACTIONS_REF}=${dir}`],
  };
}

export { stageActionsRepo };
