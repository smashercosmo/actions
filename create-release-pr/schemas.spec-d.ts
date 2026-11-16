import type { PlannedRelease } from "@pnpm/releasing.versioning";

import { describe, expectTypeOf, it } from "vitest";

import type { GitHubResponse } from "#shared/github-response.ts";
import type { Input } from "#shared/schema.ts";

import type {
  GitObjectSchema,
  PullRequestSchema,
  RefSchema,
  ReleasePlanSchema,
} from "./schemas.ts";

describe("schemas", () => {
  it("should accept the release plan pnpm prints", () => {
    expectTypeOf<PlannedRelease[]>().toExtend<
      Input<typeof ReleasePlanSchema>
    >();
  });

  it("should accept a created tree", () => {
    expectTypeOf<
      GitHubResponse<"POST /repos/{owner}/{repo}/git/trees">
    >().toExtend<Input<typeof GitObjectSchema>>();
  });

  it("should accept a created commit", () => {
    expectTypeOf<
      GitHubResponse<"POST /repos/{owner}/{repo}/git/commits">
    >().toExtend<Input<typeof GitObjectSchema>>();
  });

  it("should accept a matching ref", () => {
    expectTypeOf<
      GitHubResponse<"GET /repos/{owner}/{repo}/git/matching-refs/{ref}">[number]
    >().toExtend<Input<typeof RefSchema>>();
  });

  it("should accept a listed pull request", () => {
    expectTypeOf<
      GitHubResponse<"GET /repos/{owner}/{repo}/pulls">[number]
    >().toExtend<Input<typeof PullRequestSchema>>();
  });

  it("should accept a created pull request", () => {
    expectTypeOf<GitHubResponse<"POST /repos/{owner}/{repo}/pulls">>().toExtend<
      Input<typeof PullRequestSchema>
    >();
  });
});
