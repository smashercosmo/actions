import type { Endpoints } from "@octokit/types";

/**
 * Shape of an Octokit response after it has gone through `JSON.parse`.
 *
 * Octokit uses `number | bigint` for documented 64-bit integers, but JSON
 * parsing returns numbers only, so schema type tests must compare against that
 * runtime shape.
 */
type FromJson<TValue> = TValue extends bigint
  ? number
  : TValue extends readonly (infer TItem)[]
    ? FromJson<TItem>[]
    : TValue extends object
      ? { [TKey in keyof TValue]: FromJson<TValue[TKey]> }
      : TValue;

/**
 * Response body type for a GitHub REST endpoint, adjusted to JSON runtime
 * values. Schema type tests use it like this:
 *
 * ```ts
 * expectTypeOf<GitHubResponse<"GET /users/{username}">>().toExtend<
 *   Input<typeof UserSchema>
 * >();
 * ```
 *
 * Test-only: actions cannot import `@octokit/types` at runtime because the
 * runner does not install dev dependencies.
 */
type GitHubResponse<TRoute extends keyof Endpoints> = FromJson<
  Endpoints[TRoute]["response"]["data"]
>;

export type { GitHubResponse };
