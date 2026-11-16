import { describe, expectTypeOf, it } from "vitest";

import type { GitHubResponse } from "#shared/github-response.ts";
import type { Input } from "#shared/schema.ts";

import type { ReleaseSchema } from "./schemas.ts";

describe("schemas", () => {
  it("should accept a created release", () => {
    expectTypeOf<
      GitHubResponse<"POST /repos/{owner}/{repo}/releases">
    >().toExtend<Input<typeof ReleaseSchema>>();
  });
});
