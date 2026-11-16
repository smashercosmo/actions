import { createAppJwt } from "#shared/app-jwt.ts";
import {
  debug,
  getInput,
  saveState,
  setFailed,
  setOutput,
  setSecret,
} from "#shared/core.ts";
import { createGitHubClient, getRepository } from "#shared/github.ts";

import { InstallationSchema, InstallationTokenSchema } from "./schemas.ts";

type Permission = "read" | "write";

function getPermissionInput(name: string): Permission {
  const value = getInput(name) || "read";

  if (value !== "read" && value !== "write") {
    throw new Error(`${name} value can be only \`read\` or \`write\``);
  }

  return value;
}

try {
  const clientId = getInput("client-id", { required: true });
  const privateKey = getInput("private-key", { required: true });

  const permissions = {
    contents: getPermissionInput("permission-contents"),
    pull_requests: getPermissionInput("permission-pull-requests"),
  };

  const appJwt = createAppJwt({ clientId, privateKey });
  const { owner, repo } = getRepository();
  const github = createGitHubClient({
    token: appJwt,
    userAgent: "create-token",
  });

  const installation = await github.request(
    { method: "GET", path: `/repos/${owner}/${repo}/installation` },
    InstallationSchema,
  );

  const accessToken = await github.request(
    {
      method: "POST",
      path: `/app/installations/${installation.id}/access_tokens`,
      body: {
        /** Limit the token to this repository, not the whole installation. */
        repositories: [repo],
        permissions,
      },
    },
    InstallationTokenSchema,
  );

  setSecret(accessToken.token);
  debug("Auth token has been successfully created");
  saveState("token", accessToken.token);
  setOutput("app-slug", installation.app_slug);
  setOutput("token", accessToken.token);
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
