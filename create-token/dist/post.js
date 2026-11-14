import { c as getState, l as info, m as warning, n as getOctokit } from "./github-C7tXd-Py.js";
// create-token/post.ts
const token = getState("token");
if (token) try {
	await getOctokit(token).rest.apps.revokeInstallationAccessToken();
	info("Token revoked");
} catch (error) {
	warning(error instanceof Error ? error.message : String(error));
}
export {};
