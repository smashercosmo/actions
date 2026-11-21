import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
  findLastCommitChanging,
  getEmptyTreeId,
  hasFileChanged,
  hasTag,
  isCommit,
  listAddedFiles,
  listChangedFiles,
  listFiles,
  listStagedChanges,
  readBlob,
  resolveId,
} from "./git.ts";

function git(args: readonly string[]) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function writeFile(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/**
 * Commits the current tree.
 *
 * @param message Message of the commit.
 * @returns The ID of the new commit.
 */
function commit(message: string) {
  git(["add", "-A"]);
  git(["commit", "--allow-empty", "--quiet", "-m", message]);

  return git(["rev-parse", "HEAD"]);
}

/** Creates an isolated Git repository and makes it the current directory. */
function createRepository() {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "shared-git-"));
  const previous = process.cwd();

  /**
   * Ignore machine-level Git config and provide the author fields required for
   * commits.
   */
  vi.stubEnv("GIT_CONFIG_GLOBAL", path.join(directory, ".gitconfig"));
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_AUTHOR_NAME", "Test");
  vi.stubEnv("GIT_AUTHOR_EMAIL", "test@example.com");
  vi.stubEnv("GIT_COMMITTER_NAME", "Test");
  vi.stubEnv("GIT_COMMITTER_EMAIL", "test@example.com");

  process.chdir(directory);
  onTestFinished(() => {
    process.chdir(previous);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  git(["init", "--quiet"]);
}

/** Silence helper command logs during failure-path tests. */
function silenceStdout() {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
}

describe("isCommit()", () => {
  it("should tell that an existing commit is one", () => {
    expect.hasAssertions();

    createRepository();
    const id = commit("first");

    expect(isCommit(id)).toBe(true);
    expect(isCommit("HEAD")).toBe(true);
  });

  it("should tell that a missing commit isn't one", () => {
    expect.hasAssertions();

    createRepository();
    commit("first");

    expect(isCommit("HEAD^")).toBe(false);
    expect(isCommit("0".repeat(40))).toBe(false);
  });

  it("should tell that a tree isn't a commit", () => {
    expect.hasAssertions();

    createRepository();
    commit("first");

    expect(isCommit("HEAD^{tree}")).toBe(false);
  });
});

describe("hasTag()", () => {
  it("should tell that an existing tag exists", () => {
    expect.hasAssertions();

    createRepository();
    commit("first");
    git(["tag", "v1.0.0"]);
    git(["tag", "--annotate", "-m", "Second", "v1.1.0"]);

    expect(hasTag("v1.0.0")).toBe(true);
    expect(hasTag("v1.1.0")).toBe(true);
  });

  it("should tell that a missing tag doesn't exist", () => {
    expect.hasAssertions();

    createRepository();
    commit("first");
    git(["tag", "v1.0.0"]);

    expect(hasTag("v1.1.0")).toBe(false);
  });

  it("should not take a branch for a tag", () => {
    expect.hasAssertions();

    createRepository();
    commit("first");
    git(["branch", "v1.0.0"]);

    expect(hasTag("v1.0.0")).toBe(false);
  });
});

describe("getEmptyTreeId()", () => {
  it("should return the ID of the empty tree of the repository", () => {
    expect.hasAssertions();

    createRepository();

    /** Empty tree ID for SHA-1 repositories. */
    expect(getEmptyTreeId()).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
  });
});

describe("listFiles()", () => {
  it("should list what's directly in the directory in the commit", () => {
    expect.hasAssertions();

    createRepository();
    writeFile(".changeset/first.md", "");
    writeFile(".changeset/ledger.yaml", "");
    writeFile(".changeset/nested/second.md", "");
    writeFile("other.md", "");
    commit("first");

    expect(listFiles("HEAD", ".changeset/")).toStrictEqual([
      ".changeset/first.md",
      ".changeset/ledger.yaml",
      ".changeset/nested",
    ]);
  });

  it("should ignore the changes that aren't committed", () => {
    expect.hasAssertions();

    createRepository();
    writeFile(".changeset/first.md", "");
    commit("first");
    writeFile(".changeset/second.md", "");
    fs.rmSync(".changeset/first.md");

    expect(listFiles("HEAD", ".changeset/")).toStrictEqual([
      ".changeset/first.md",
    ]);
  });

  it("should list nothing for a directory the commit doesn't have", () => {
    expect.hasAssertions();

    createRepository();
    commit("first");

    expect(listFiles("HEAD", ".changeset/")).toStrictEqual([]);
  });

  it("should keep a path with unusual characters as it is", () => {
    expect.hasAssertions();

    createRepository();
    writeFile(".changeset/new\nline é.md", "");
    commit("first");

    expect(listFiles("HEAD", ".changeset/")).toStrictEqual([
      ".changeset/new\nline é.md",
    ]);
  });
});

describe("hasFileChanged()", () => {
  it("should tell whether the file differs between the commits", () => {
    expect.hasAssertions();

    createRepository();
    silenceStdout();
    writeFile("ledger.yaml", "first");
    const first = commit("first");
    writeFile("other.txt", "");
    const second = commit("second");
    writeFile("ledger.yaml", "third");
    const third = commit("third");

    expect(hasFileChanged(first, second, "ledger.yaml")).toBe(false);
    expect(hasFileChanged(second, third, "ledger.yaml")).toBe(true);
  });

  it("should tell that a file added since the empty tree has changed", () => {
    expect.hasAssertions();

    createRepository();
    silenceStdout();
    writeFile("ledger.yaml", "");
    commit("first");

    expect(hasFileChanged(getEmptyTreeId(), "HEAD", "ledger.yaml")).toBe(true);
  });

  it("should throw when a commit doesn't exist", () => {
    expect.hasAssertions();

    createRepository();
    silenceStdout();
    commit("first");

    expect(() => hasFileChanged("0".repeat(40), "HEAD", "ledger.yaml")).toThrow(
      "git diff failed with exit code 128",
    );
  });
});

describe("listAddedFiles()", () => {
  it("should list only the added files that match the pathspecs", () => {
    expect.hasAssertions();

    createRepository();
    /**
     * Keep contents distinct so Git does not report the add/delete pair as a
     * rename.
     */
    writeFile(".changeset/modified.md", "modified, first version");
    writeFile(".changeset/deleted.md", "deleted");
    const first = commit("first");
    writeFile(".changeset/modified.md", "modified, second version");
    fs.rmSync(".changeset/deleted.md");
    writeFile(".changeset/added.md", "added");
    writeFile(".changeset/added.yaml", "");
    writeFile("added.md", "");
    commit("second");

    expect(listAddedFiles(first, "HEAD", [".changeset/*.md"])).toStrictEqual([
      ".changeset/added.md",
    ]);
  });

  it("should list nothing when no file was added", () => {
    expect.hasAssertions();

    createRepository();
    const first = commit("first");
    commit("second");

    expect(listAddedFiles(first, "HEAD", [".changeset/*.md"])).toStrictEqual(
      [],
    );
  });
});

describe("listChangedFiles()", () => {
  it("should list the changed and untracked files except the deleted and ignored ones", () => {
    expect.hasAssertions();

    createRepository();
    writeFile(".gitignore", "ignored.md\n");
    writeFile("modified.md", "first");
    writeFile("staged.md", "first");
    writeFile("deleted.md", "");
    writeFile("removed.md", "");
    writeFile("unchanged.md", "");
    commit("first");
    writeFile("modified.md", "second");
    writeFile("staged.md", "second");
    writeFile("added.md", "");
    writeFile("untracked.md", "");
    writeFile("ignored.md", "");
    fs.rmSync("deleted.md");
    git(["add", "staged.md", "added.md"]);
    git(["rm", "--quiet", "removed.md"]);

    expect(listChangedFiles()).toStrictEqual([
      "added.md",
      "modified.md",
      "staged.md",
      "untracked.md",
    ]);
  });
});

describe("resolveId()", () => {
  it("should return the full ID of a commit and of its tree", () => {
    expect.hasAssertions();

    createRepository();
    const id = commit("first");

    expect({
      commit: resolveId("HEAD"),
      tree: resolveId("HEAD^{tree}"),
    }).toStrictEqual({
      commit: id,
      tree: git(["show", "--no-patch", "--format=%T", id]),
    });
  });

  it("should throw for a revision that doesn't exist", () => {
    expect.hasAssertions();

    createRepository();
    commit("first");

    expect(() => resolveId("missing")).toThrow(
      "The process 'git' failed with exit code 128",
    );
  });
});

describe("listStagedChanges()", () => {
  it("should list each staged change with its mode and content", () => {
    expect.hasAssertions();

    createRepository();
    writeFile("modified.md", "first");
    writeFile("deleted.sh", "");
    fs.chmodSync("deleted.sh", 0o755);
    writeFile("renamed.md", "renamed");
    commit("first");
    writeFile("modified.md", "second");
    fs.rmSync("deleted.sh");
    fs.renameSync("renamed.md", "moved.md");
    writeFile("added file.md", "added");
    writeFile("unstaged.md", "");
    git(["add", "modified.md", "deleted.sh", "renamed.md", "moved.md"]);
    git(["add", "added file.md"]);

    function blob(file: string) {
      return git(["rev-parse", `:${file}`]);
    }

    expect(listStagedChanges()).toStrictEqual([
      { path: "added file.md", mode: "100644", blob: blob("added file.md") },
      { path: "deleted.sh", mode: "100755", blob: undefined },
      { path: "modified.md", mode: "100644", blob: blob("modified.md") },
      { path: "moved.md", mode: "100644", blob: blob("moved.md") },
      { path: "renamed.md", mode: "100644", blob: undefined },
    ]);
  });

  it("should list nothing when nothing is staged", () => {
    expect.hasAssertions();

    createRepository();
    writeFile("file.md", "first");
    commit("first");
    writeFile("file.md", "second");

    expect(listStagedChanges()).toStrictEqual([]);
  });
});

describe("readBlob()", () => {
  it("should return the content of a blob as it is", () => {
    expect.hasAssertions();

    createRepository();
    writeFile("file.md", "line\n\n");
    git(["add", "file.md"]);

    expect(readBlob(git(["rev-parse", ":file.md"]))).toBe("line\n\n");
  });
});

describe("findLastCommitChanging()", () => {
  it("should find the commit that added the text", () => {
    expect.hasAssertions();

    createRepository();
    writeFile("package.json", '{ "version": "1.0.0" }');
    commit("first");
    writeFile("package.json", '{ "version": "1.1.0" }');
    const second = commit("second");
    writeFile("package.json", '{ "version": "1.1.0", "private": true }');
    commit("third");

    expect(findLastCommitChanging('"version": "1.1.0"', "package.json")).toBe(
      second,
    );
  });

  it("should only look at the given file", () => {
    expect.hasAssertions();

    createRepository();
    writeFile("package.json", '{ "version": "1.0.0" }');
    const first = commit("first");
    writeFile("other/package.json", '{ "version": "1.0.0" }');
    commit("second");

    expect(findLastCommitChanging('"version": "1.0.0"', "package.json")).toBe(
      first,
    );
  });

  it("should return undefined when no commit changed the text", () => {
    expect.hasAssertions();

    createRepository();
    writeFile("package.json", '{ "version": "1.0.0" }');
    commit("first");

    expect(
      findLastCommitChanging('"version": "2.0.0"', "package.json"),
    ).toBeUndefined();
  });

  it("should throw when Git fails", () => {
    expect.hasAssertions();

    /** No commits means `git log` has no history to search. */
    createRepository();

    expect(() =>
      findLastCommitChanging('"version": "1.0.0"', "package.json"),
    ).toThrow("The process 'git' failed with exit code 128");
  });
});
