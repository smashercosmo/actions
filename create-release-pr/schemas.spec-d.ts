import type { PlannedRelease } from "@pnpm/releasing.versioning";

import { describe, expectTypeOf, it } from "vitest";

import type { GitHubResponse } from "#shared/github-response.ts";
import type { Input } from "#shared/schema.ts";

import type {
  PullRequestSchema,
  ReleasePlanSchema,
  UserSchema,
} from "./schemas.ts";

describe("schemas", () => {
  it("should accept the release plan pnpm prints", () => {
    expectTypeOf<PlannedRelease[]>().toExtend<
      Input<typeof ReleasePlanSchema>
    >();
  });

  it("should accept the user of the app's bot", () => {
    expectTypeOf<GitHubResponse<"GET /users/{username}">>().toExtend<
      Input<typeof UserSchema>
    >();
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
