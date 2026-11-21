import { MAIN_BRANCH_NAME } from "./actrc.ts";
import { git } from "./exec.ts";

/**
 * Pushes `main`. `before` must come from the remote ref so release planning
 * compares the same range GitHub would.
 *
 * @param options The options.
 * @param options.repo Path of the repository.
 * @returns The payload of the push event.
 */
function createMockPush({ repo }: { repo: string }) {
  const ref = `refs/heads/${MAIN_BRANCH_NAME}`;

  const [before = ""] = git(repo, ["ls-remote", "origin", ref]).split(/\s+/v);

  git(repo, ["checkout", MAIN_BRANCH_NAME]);
  git(repo, ["push", "origin", MAIN_BRANCH_NAME]);

  return {
    ref,
    before,
    after: git(repo, ["rev-parse", "HEAD"]),
  } as const;
}

export { createMockPush };
