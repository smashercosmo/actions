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

/** App bot user (`GET /users/{username}`). */
const UserSchema = object({ id: number() });

/** Pull request returned by list, create, and update endpoints. */
const PullRequestSchema = object({ number: number(), html_url: url() });

export { PullRequestSchema, ReleasePlanSchema, UserSchema };
