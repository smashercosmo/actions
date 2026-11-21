import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { git } from "./exec.ts";

/** Manifest fields the tests edit; unknown fields are preserved. */
const ManifestSchema = z.looseObject({
  private: z.boolean().optional(),
  scripts: z.record(z.string(), z.string()).default({}),
});

type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Edits and commits a package manifest in the mock repository.
 *
 * @param options The options.
 * @param options.repo Path of the repository.
 * @param options.dir Directory of the package, relative to `repo`.
 * @param options.edit Returns the edited manifest.
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

/**
 * Replaces a package script with a failing command.
 *
 * @param script Name of the script.
 * @returns An `edit` function for `editManifest`.
 */
function failScript(script: string) {
  return (manifest: Manifest): Manifest => ({
    ...manifest,
    scripts: { ...manifest.scripts, [script]: "exit 1" },
  });
}

export { editManifest, failScript };
