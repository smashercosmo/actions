import { getExecOutput } from "#shared/exec.ts";
import {
  array,
  boolean,
  object,
  optional,
  parse,
  string,
} from "#shared/schema.ts";

/**
 * Package entries returned by `pnpm ls -r --depth -1 --json`
 * (https://github.com/pnpm/pnpm/blob/main/pnpm11/deps/inspection/list/src/types.ts).
 */
const WorkspacePackageSchema = object({
  name: string(),
  version: optional(string()),
  path: string(),
  private: optional(boolean()),
});

const WorkspacePackagesSchema = array(WorkspacePackageSchema);

/** Lists workspace packages without their dependency trees. */
function listWorkspacePackages() {
  const { stdout } = getExecOutput(
    "pnpm",
    ["ls", "-r", "--depth", "-1", "--json"],
    { silent: true },
  );

  return parse(
    WorkspacePackagesSchema,
    JSON.parse(stdout),
    "`pnpm ls -r --depth -1 --json`",
  );
}

export { listWorkspacePackages, WorkspacePackagesSchema };
