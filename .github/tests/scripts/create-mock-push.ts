import { MAIN_BRANCH_NAME } from "./actrc";
import { git } from "./exec";

/**
 * Pushes the `main` branch to the mock remote and returns the corresponding
 * `push` webhook payload.
 *
 * The release workflow compares the `before` and `after` commit SHAs in the
 * push event payload to determine whether the push merged a release pull
 * request (checking for modifications to `.changeset/ledger.yaml`). Accurately
 * capturing `before` from the remote ensures the workflow correctly detects
 * changes.
 */
function createMockPush({ repo }: { repo: string }) {
  const ref = `refs/heads/${MAIN_BRANCH_NAME}`;

  /**
   * Retrieves the current remote commit SHA on `main` before pushing. `git
   * ls-remote` returns `<sha>\t<ref>`, where the first token is the commit
   * SHA.
   */
  const [before = ""] = git(repo, ["ls-remote", "origin", ref]).split(/\s+/v);

  /**
   * Checks out and pushes `main` so act resolves `github.sha` and `github.ref`
   * to the pushed branch tip.
   */
  git(repo, ["checkout", MAIN_BRANCH_NAME]);
  git(repo, ["push", "origin", MAIN_BRANCH_NAME]);

  return {
    ref,
    before,
    after: git(repo, ["rev-parse", "HEAD"]),
  } as const;
}

export { createMockPush };
