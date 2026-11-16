import { exec, getExecOutput } from "#shared/exec.ts";

/**
 * Splits the output of a Git command that uses `-z`.
 *
 * NUL separators are safe for every valid path, including paths that contain
 * line breaks.
 */
function splitPaths(output: string) {
  return output.split("\0").filter(Boolean);
}

/**
 * Checks whether `rev` points to an existing commit in the local repository.
 *
 * Useful for revisions from event payloads, which may be missing after a
 * force-push, in a shallow checkout, or in a one-commit repository.
 */
function isCommit(rev: string) {
  /** `^{commit}` rejects tags, trees, and blobs that happen to share a name. */
  const exitCode = exec(
    "git",
    ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`],
    { silent: true, ignoreReturnCode: true },
  );

  return exitCode === 0;
}

/**
 * Checks whether the tag `tag` exists in the local repository.
 *
 * Only fetched tags count, so callers that need remote tags must use a full
 * checkout first.
 */
function hasTag(tag: string) {
  /** The full ref avoids matching a branch with the same name. */
  const exitCode = exec(
    "git",
    ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`],
    { silent: true, ignoreReturnCode: true },
  );

  return exitCode === 0;
}

/**
 * Returns the ID of Git's empty tree.
 *
 * Diffing against the empty tree treats every file in the first commit as
 * added.
 */
function getEmptyTreeId() {
  /** Hash the empty tree without writing a new object into the repository. */
  const { stdout } = getExecOutput(
    "git",
    ["hash-object", "-t", "tree", "--stdin"],
    { silent: true, input: "" },
  );

  return stdout.trim();
}

/**
 * Lists the files and directories directly inside `directory` at `rev`.
 *
 * Paths come from the commit, not the working tree, and include the directory
 * prefix (for example, `.changeset/foo.md`).
 */
function listFiles(rev: string, directory: `${string}/`) {
  const { stdout } = getExecOutput(
    "git",
    ["ls-tree", "--name-only", "-z", rev, directory],
    { silent: true },
  );

  return splitPaths(stdout);
}

/**
 * Checks whether `file` changed between `from` and `to`.
 *
 * Git uses exit code 1 to mean "different", so only codes above 1 are errors.
 */
function hasFileChanged(from: string, to: string, file: string) {
  const exitCode = exec("git", ["diff", "--quiet", from, to, "--", file], {
    ignoreReturnCode: true,
  });

  if (exitCode > 1) {
    throw new Error(`git diff failed with exit code ${exitCode}`);
  }

  return exitCode === 1;
}

/**
 * Lists files added between `from` and `to` that match the given pathspecs
 * (e.g. `.changeset/*.md`).
 *
 * Modified, renamed, and deleted files are ignored.
 */
function listAddedFiles(
  from: string,
  to: string,
  pathspecs: readonly string[],
) {
  const { stdout } = getExecOutput(
    "git",
    [
      "diff",
      "--name-only",
      "--diff-filter=A",
      "-z",
      from,
      to,
      "--",
      ...pathspecs,
    ],
    { silent: true },
  );

  return splitPaths(stdout);
}

/**
 * Lists files staged for the next commit, excluding deleted files.
 *
 * Every returned path refers to a file that exists in the working tree.
 */
function listStagedFiles() {
  /** Lowercase `d` excludes deletions while keeping every other change type. */
  const { stdout } = getExecOutput(
    "git",
    ["diff", "--staged", "--name-only", "--diff-filter=d", "-z"],
    { silent: true },
  );

  return splitPaths(stdout);
}

/**
 * Finds the most recent commit that added or removed `text` in `file`.
 *
 * When `file` still contains `text`, that commit introduced the current
 * occurrence. Returns `undefined` when no matching commit is found.
 */
function findLastCommitChanging(text: string, file: string) {
  const { stdout } = getExecOutput(
    "git",
    ["log", "-1", "--format=%H", `-S${text}`, "--", file],
    { silent: true },
  );
  const commit = stdout.trim();

  return commit === "" ? undefined : commit;
}

export {
  findLastCommitChanging,
  getEmptyTreeId,
  hasFileChanged,
  hasTag,
  isCommit,
  listAddedFiles,
  listFiles,
  listStagedFiles,
};
