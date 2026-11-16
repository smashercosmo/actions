import { number, object, string } from "#shared/schema.ts";

/** Repository installation (`GET /repos/{owner}/{repo}/installation`). */
const InstallationSchema = object({ id: number(), app_slug: string() });

/** Installation token (`POST /app/installations/{id}/access_tokens`). */
const InstallationTokenSchema = object({ token: string() });

export { InstallationSchema, InstallationTokenSchema };
