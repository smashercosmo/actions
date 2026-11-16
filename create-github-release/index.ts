import {
  getInput,
  getBooleanInput,
  info,
  warning,
  setFailed,
} from "@actions/core";
import { getExecOutput } from "@actions/exec";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { z } from "zod";

/**
 * The structure of the JSON output produced by `pnpm ls -r --depth -1 --json`
 * (https://github.com/pnpm/pnpm/blob/main/pnpm11/deps/inspection/list/src/types.ts).
 */
const WorkspacePackagesSchema = z.array(
  z.object({
    name: z.string(),
    version: z.string().optional(),
    path: z.string(),
    private: z.boolean().default(false),
  }),
);

const ReleaseSchema = z.object({
  tag_name: z.string(),
  html_url: z.url(),
});

type RequestOptions<TSchema extends z.ZodType> =
  | Readonly<{ method: "GET"; endpoint: `/${string}`; schema: TSchema }>
  | Readonly<{
      method: "POST";
      endpoint: `/${string}`;
      schema: TSchema;
      body: Readonly<Record<string, unknown>>;
    }>;

/**
 * GraphQL reports most errors (e.g. an unknown repository) with a 200 status
 * and an `errors` array, so the status alone doesn't tell a success
 */
const GraphQLErrorSchema = z.object({ message: z.string() });

const GraphQLResponseSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(GraphQLErrorSchema).optional(),
});

const ExistingReleaseRepositorySchema = z.object({
  release: z.object({ isDraft: z.boolean(), url: z.url() }).nullable(),
});

const ExistingReleaseSchema = z.object({
  repository: ExistingReleaseRepositorySchema,
});

/**
 * Looks up an existing release by its tag, including drafts.
 * The REST API's get-release-by-tag endpoint only returns published
 * releases, but GitHub's GraphQL release(tagName:) also returns drafts
 * (verified against GitHub.com, as this behavior isn't documented).
 *
 * This matters because creating a draft release doesn't create its git
 * tag. As a result, multiple drafts can exist with the same tag.
 * GraphQL returns one of them, which is enough for our purposes:
 * we only need to know whether a release with this tag already exists.
 */
const EXISTING_RELEASE_QUERY = `
  query ExistingRelease($owner: String!, $name: String!, $tag: String!) {
    repository(owner: $owner, name: $name) {
      release(tagName: $tag) {
        isDraft
        url
      }
    }
  }
`;

function parse<TSchema extends z.ZodType>(
  schema: TSchema,
  data: unknown,
  label: string,
): z.infer<TSchema> {
  const result = schema.safeParse(data);

  if (!result.success) {
    throw new Error(
      `${label} returned an unexpected response:\n${z.prettifyError(result.error)}`,
    );
  }

  return result.data;
}

function getEnv(name: string) {
  const value = process.env[name];

  if (value === undefined) {
    throw new Error(`${name} env variable isn't set`);
  }

  return value;
}

/**
 * A small GitHub API client for making authenticated requests, with `request`
 * for the REST API and `query` for the GraphQL API
 */
function createGitHubClient(token: string) {
  const apiUrl = process.env["GITHUB_API_URL"] ?? "https://api.github.com";
  const graphqlUrl =
    process.env["GITHUB_GRAPHQL_URL"] ?? "https://api.github.com/graphql";
  const repository = getEnv("GITHUB_REPOSITORY");
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "create-github-release",
  };

  async function request<TSchema extends z.ZodType>(
    options: RequestOptions<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const { method, endpoint, schema } = options;
    const label = `GitHub API ${method} ${endpoint}`;
    const response = await fetch(`${apiUrl}/repos/${repository}${endpoint}`, {
      method,
      headers: {
        ...headers,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(options.method === "POST"
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(options.method === "POST"
        ? { body: JSON.stringify(options.body) }
        : {}),
    });

    if (!response.ok) {
      throw new Error(
        `${label} failed with ${response.status}: ${await response.text()}`,
      );
    }

    return parse(schema, await response.json(), label);
  }

  async function query<TSchema extends z.ZodType>(
    document: string,
    variables: Readonly<Record<string, unknown>>,
    schema: TSchema,
  ): Promise<z.infer<TSchema>> {
    const [owner, name] = repository.split("/");
    const label = "GitHub GraphQL API";
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: document,
        variables: { owner, name, ...variables },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `${label} failed with ${response.status}: ${await response.text()}`,
      );
    }

    const { data, errors } = parse(
      GraphQLResponseSchema,
      await response.json(),
      label,
    );

    if (errors !== undefined && errors.length > 0) {
      throw new Error(
        `${label} failed: ${errors.map(({ message }) => message).join("; ")}`,
      );
    }

    return parse(schema, data, label);
  }

  return { request, query };
}

/**
 * Extracts the release notes for a specific version from CHANGELOG.md.
 *
 * Looks for a heading such as:
 *
 * ## 1.2.0
 *
 * ## [1.2.0] - 2026-01-15
 *
 * Returns everything below that heading, up to the next version heading.
 * Returns an empty string if the version isn't found.
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
 */
async function getVersionCommit(
  packagePath: string,
  version: string,
  fallback: string,
) {
  const { stdout, exitCode } = await getExecOutput(
    "git",
    [
      "log",
      "-1",
      "--format=%H",
      `-S"version": "${version}"`,
      "--",
      path.join(packagePath, "package.json"),
    ],
    { silent: true, ignoreReturnCode: true },
  );
  const commit = stdout.trim();

  if (exitCode !== 0 || commit === "") {
    warning(
      `Couldn't find the commit that set version ${version}, tagging ${fallback} instead`,
    );
    return fallback;
  }

  return commit;
}

try {
  const token = getInput("token", { required: true });
  const includePrivate = getBooleanInput("include-private");
  const sha = getEnv("GITHUB_SHA");

  const { stdout: workspacePackagesOutput } = await getExecOutput(
    "pnpm",
    ["ls", "-r", "--depth", "-1", "--json"],
    { silent: true },
  );
  const workspacePackages = WorkspacePackagesSchema.parse(
    JSON.parse(workspacePackagesOutput),
  );

  /**
   * Only packages with a version can be released. This excludes packages such
   * as the workspace root, which usually don't have their own version.
   *
   * Private packages are excluded by default because they aren't published to
   * npm. Set include-private to true if you also want to create GitHub releases
   * and tags for them.
   */
  const releasablePackages = workspacePackages.flatMap(
    ({ name, version, path: packagePath, private: isPrivate }) =>
      version === undefined || (isPrivate && !includePrivate)
        ? []
        : [{ name, version, packagePath }],
  );

  /**
   * We use "v<version>" as the release tag (for example, "v1.2.0").
   *
   * This naming scheme only works when releasing one package, because two
   * packages could have the same version and would then need the same tag.
   *
   * We could use package-specific tags such as "package-name@1.2.0", but that
   * would introduce a different naming convention and break consistency with
   * the existing release tags.
   *
   * Rather than risk creating conflicting tags, fail if multiple packages are
   * eligible for release.
   *
   * TODO support multi-package releases in the future
   */
  if (releasablePackages.length > 1) {
    throw new Error(
      `"v<version>" tags only work with one released package, found ${releasablePackages.length}: ${releasablePackages.map(({ name }) => name).join(", ")}`,
    );
  }

  const { request, query } = createGitHubClient(token);

  await Promise.all(
    releasablePackages.map(async ({ name, version, packagePath }) => {
      const tag = `v${version}`;

      /**
       * The release may exist already, e.g. when the workflow is run manually
       * to retry a failed release. Creating it again would leave a duplicate
       * draft.
       */
      const {
        repository: { release: existingRelease },
      } = await query(EXISTING_RELEASE_QUERY, { tag }, ExistingReleaseSchema);

      if (existingRelease !== null) {
        info(
          `Release ${tag} already exists${existingRelease.isDraft ? " as a draft" : ""}, skipping: ${existingRelease.url}`,
        );
        return;
      }

      let notes = getReleaseNotes(
        fs.readFileSync(path.join(packagePath, "CHANGELOG.md"), "utf8"),
        version,
      );

      if (notes === "") {
        warning(`No CHANGELOG.md section found for ${name}@${version}`);
        notes = `Release ${name}@${version}`;
      }

      const commit = await getVersionCommit(packagePath, version, sha);

      /**
       * The tag is created once the draft is published, pointing to the
       * released commit
       */
      const release = await request({
        method: "POST",
        endpoint: "/releases",
        schema: ReleaseSchema,
        body: {
          tag_name: tag,
          target_commitish: commit,
          name: tag,
          body: notes,
          draft: true,
        },
      });

      info(`Created draft release ${release.html_url}`);
    }),
  );
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
