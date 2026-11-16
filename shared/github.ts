import process from "node:process";

import type { Schema } from "./schema.ts";

import { parse } from "./schema.ts";

type ClientOptions = Readonly<{
  /** Token used for authenticated requests. */
  token: string;
  /** User agent sent to GitHub, usually the action name. */
  userAgent: string;
}>;

type RequestOptions = Readonly<{
  method: "DELETE" | "GET" | "PATCH" | "POST";
  /** REST endpoint path, for example `/repos/octocat/hello-world/pulls`. */
  path: `/${string}`;
  /** Query parameters appended to the path. */
  searchParams?: Readonly<Record<string, number | string>>;
  /** JSON request body. */
  body?: Readonly<Record<string, unknown>>;
}>;

/**
 * Reads the current workflow repository from `GITHUB_REPOSITORY`
 * (`owner/repo`).
 */
function getRepository() {
  const repository = process.env["GITHUB_REPOSITORY"];

  if (repository === undefined || repository === "") {
    throw new Error("GITHUB_REPOSITORY env variable isn't set");
  }

  const [owner, repo, ...rest] = repository.split("/");

  if (
    owner === undefined ||
    owner === "" ||
    repo === undefined ||
    repo === "" ||
    rest.length > 0
  ) {
    throw new Error(
      `GITHUB_REPOSITORY env variable isn't in the "owner/repo" form: ${repository}`,
    );
  }

  return { owner, repo };
}

/**
 * Minimal authenticated GitHub REST client.
 *
 * Responses are validated before use, and `GITHUB_API_URL` lets tests point the
 * client at a mock GitHub server.
 */
function createGitHubClient({ token, userAgent }: ClientOptions) {
  const apiUrl = process.env["GITHUB_API_URL"] ?? "https://api.github.com";
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": userAgent,
  };

  /**
   * Pass a schema when the endpoint returns JSON the caller needs; omit it for
   * empty responses such as 204 No Content.
   */
  async function request(options: RequestOptions): Promise<undefined>;
  async function request<TValue>(
    options: RequestOptions,
    schema: Schema<TValue, unknown>,
  ): Promise<TValue>;
  async function request(
    options: RequestOptions,
    schema?: Schema<unknown, unknown>,
  ): Promise<unknown> {
    const { method, path, searchParams = {}, body } = options;
    const label = `GitHub API ${method} ${path}`;
    const url = new URL(`${apiUrl}${path}`);

    for (const [name, value] of Object.entries(searchParams)) {
      url.searchParams.set(name, String(value));
    }

    const response = await fetch(url, {
      method,
      headers: {
        ...headers,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      throw new Error(
        `${label} failed with ${response.status}: ${await response.text()}`,
      );
    }

    if (schema === undefined) {
      return undefined;
    }

    return parse(schema, await response.json(), label);
  }

  return { request };
}

export { createGitHubClient, getRepository };
