import { array, number, object, string, url } from "#shared/schema.ts";

/**
 * JSON output from `pnpm version -r --json`: one entry per package pnpm plans
 * to release.
 */
const ReleasePlanSchema = array(
  object({
    name: string(),
    currentVersion: string(),
    newVersion: string(),
  }),
);

/** Tree or commit returned when one is created through the Git database API. */
const GitObjectSchema = object({ sha: string() });

/** Ref returned by `GET /repos/{owner}/{repo}/git/matching-refs/{ref}`. */
const RefSchema = object({ ref: string() });

/** Pull request returned by list, create, and update endpoints. */
const PullRequestSchema = object({ number: number(), html_url: url() });

export { GitObjectSchema, PullRequestSchema, RefSchema, ReleasePlanSchema };
