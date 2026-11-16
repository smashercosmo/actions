import { object, string, url } from "#shared/schema.ts";

/** Created release (`POST /repos/{owner}/{repo}/releases`). */
const ReleaseSchema = object({
  tag_name: string(),
  html_url: url(),
});

export { ReleaseSchema };
