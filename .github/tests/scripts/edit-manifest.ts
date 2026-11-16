import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { git } from "./exec";

/** The fields of a package.json the tests change, the others are kept */
const ManifestSchema = z.looseObject({
  private: z.boolean().optional(),
  scripts: z.record(z.string(), z.string()).default({}),
});

type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Rewrites the package.json in `dir` of the mock repository and commits it,
 * e.g. to make a package private or a script fail
 */
function editManifest({
  repo,
  dir,
  edit,
}: {
  repo: string;
  dir: string;
  edit: (manifest: Manifest) => Manifest;
}) {
  const file = path.join(repo, dir, "package.json");
  const manifest = ManifestSchema.parse(
    JSON.parse(fs.readFileSync(file, "utf8")),
  );
  fs.writeFileSync(file, `${JSON.stringify(edit(manifest), null, 2)}\n`);
  git(repo, ["commit", "-am", "chore: edit package.json"]);
}

/** Makes a script of the package.json exit with 1 */
function failScript(script: string) {
  return (manifest: Manifest): Manifest => ({
    ...manifest,
    scripts: { ...manifest.scripts, [script]: "exit 1" },
  });
}

export { editManifest, failScript };
