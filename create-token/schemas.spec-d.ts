import { describe, expectTypeOf, it } from "vitest";

import type { GitHubResponse } from "#shared/github-response.ts";
import type { Input } from "#shared/schema.ts";

import type { InstallationSchema, InstallationTokenSchema } from "./schemas.ts";

describe("schemas", () => {
  it("should accept the installation of the app", () => {
    expectTypeOf<
      GitHubResponse<"GET /repos/{owner}/{repo}/installation">
    >().toExtend<Input<typeof InstallationSchema>>();
  });

  it("should accept an installation access token", () => {
    expectTypeOf<
      GitHubResponse<"POST /app/installations/{installation_id}/access_tokens">
    >().toExtend<Input<typeof InstallationTokenSchema>>();
  });
});
