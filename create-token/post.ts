import { getState, info, warning } from "#shared/core.ts";
import { createGitHubClient } from "#shared/github.ts";

const token = getState("token");

if (token !== "") {
  try {
    const github = createGitHubClient({ token, userAgent: "create-token" });
    await github.request({ method: "DELETE", path: "/installation/token" });
    info("Token revoked");
  } catch (error) {
    warning(error instanceof Error ? error.message : String(error));
  }
}
