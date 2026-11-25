import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  getBooleanInput,
  getInput,
  info,
  setFailed,
  setOutput,
  warning,
} from "#shared/core.ts";
import { findLastCommitChanging, hasTag } from "#shared/git.ts";
import { createGitHubClient, getRepository } from "#shared/github.ts";

import { waitUntilPublished } from "./npm.ts";
import { ReleaseSchema } from "./schemas.ts";
import { listWorkspacePackages } from "./workspace.ts";

function getEnv(name: string) {
  const value = process.env[name];

  if (value === undefined) {
    throw new Error(`${name} env variable isn't set`);
  }

  return value;
}

/**
 * Extracts the release notes for a specific version from CHANGELOG.md.
 *
 * Accepts headings like `## 1.2.0` and `## [1.2.0] - 2026-01-15`, then reads
 * until the next version heading.
 *
 * @param changelog Content of CHANGELOG.md.
 * @param version Version to read the notes of.
 * @returns The notes, or an empty string when the version has no section.
 */
function getReleaseNotes(changelog: string, version: string) {
  const notes: string[] = [];
  let found = false;

  for (const line of changelog.split("\n")) {
    if (line.startsWith("## ")) {
      if (found) {
        break;
      }

      const heading = line.split(/\s+/v)[1]?.replaceAll(/[\[\]]/gv, "");
      found = heading === version;
    } else if (found) {
      notes.push(line);
    }
  }

  return notes.join("\n").trim();
}

/**
 * Finds the commit that introduced the package's current version by looking for
 * the last commit that changed the `"version": "<version>"` line in
 * package.json. Git's `-S` option matches both additions and removals. However,
 * since the version line is present in the current version of package.json, the
 * most recent matching commit must be the one that introduced it.
 *
 * @param packagePath Directory of the package.
 * @param version Current version of the package.
 * @param fallback Commit to return when the history search fails.
 * @returns The ID of the commit, or `fallback`.
 */
function getVersionCommit(
  packagePath: string,
  version: string,
  fallback: string,
) {
  try {
    const commit = findLastCommitChanging(
      `"version": "${version}"`,
      path.join(packagePath, "package.json"),
    );

    if (commit !== undefined) {
      return commit;
    }
  } catch {
    /** The warning below explains the fallback when history search fails. */
  }

  warning(
    `Couldn't find the commit that set version ${version}, tagging ${fallback} instead`,
  );

  return fallback;
}

function getWaitMinutes() {
  const input = getInput("npm-wait-minutes");
  const minutes = Number(input);

  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error(
      `npm-wait-minutes has to be a number of minutes, 0 or more, got "${input}"`,
    );
  }

  return minutes;
}

try {
  const token = getInput("token", { required: true });
  const includePrivate = getBooleanInput("include-private");
  const npm = getBooleanInput("npm");
  const deadline = Date.now() + getWaitMinutes() * 60_000;
  const sha = getEnv("GITHUB_SHA");

  const workspacePackages = listWorkspacePackages();

  /**
   * Releasable packages need a version. Private packages are opt-in because
   * they are tagged on GitHub but never waited for on npm.
   */
  const releasablePackages = workspacePackages.flatMap(
    ({ name, version, path: packagePath, private: isPrivate = false }) =>
      version === undefined || (isPrivate && !includePrivate)
        ? []
        : [{ name, version, packagePath, isPrivate }],
  );

  /**
   * Existing releases use `v<version>` tags. That format is ambiguous for
   * multi-package releases, so fail instead of inventing a second tag scheme.
   */
  if (releasablePackages.length > 1) {
    throw new Error(
      `"v<version>" tags only work with one released package, found ${releasablePackages.length}: ${releasablePackages.map(({ name }) => name).join(", ")}`,
    );
  }

  const { owner, repo } = getRepository();
  const github = createGitHubClient({
    token,
    userAgent: "create-github-release",
  });

  /**
   * The tag of each package's release once the release exists, whether it
   * existed already or was created now. A version that isn't on npm yet has
   * none.
   */
  const tags = await Promise.all(
    releasablePackages.map(
      async ({ name, version, packagePath, isPrivate }) => {
        const tag = `v${version}`;

        /**
         * Creating a release also creates its tag, so the tag is the
         * idempotency check for reruns and ordinary pushes.
         */
        if (hasTag(tag)) {
          info(`Release ${tag} already exists, skipping`);
          return tag;
        }

        /**
         * Public staged versions become releasable only after npm approval.
         * Later workflow runs will create the GitHub release once npm has it.
         */
        if (npm && !isPrivate) {
          const published = await waitUntilPublished(name, version, deadline);

          if (!published) {
            warning(
              `${name}@${version} isn't on npm yet, so its release ${tag} isn't created. If it's staged, approve it with \`pnpm stage approve\`. The next run of the release workflow creates the release once it's on npm`,
            );
            return;
          }
        }

        let notes = getReleaseNotes(
          fs.readFileSync(path.join(packagePath, "CHANGELOG.md"), "utf8"),
          version,
        );

        if (notes === "") {
          warning(`No CHANGELOG.md section found for ${name}@${version}`);
          notes = `Release ${name}@${version}`;
        }

        const commit = getVersionCommit(packagePath, version, sha);

        const release = await github.request(
          {
            method: "POST",
            path: `/repos/${owner}/${repo}/releases`,
            body: {
              tag_name: tag,
              target_commitish: commit,
              name: tag,
              body: notes,
            },
          },
          ReleaseSchema,
        );

        info(`Created release ${release.html_url}`);

        return tag;
      },
    ),
  );

  /** There's one releasable package at most, so there's one tag at most. */
  setOutput("tag", tags.find((tag) => tag !== undefined) ?? "");
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
