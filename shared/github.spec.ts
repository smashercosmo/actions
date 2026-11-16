import type { MockInstance } from "vitest";

import { describe, expect, it, vi } from "vitest";

import { createGitHubClient, getRepository } from "./github.ts";
import { array, number, object } from "./schema.ts";

const PullRequestSchema = object({ number: number() });

/** Stub `fetch` so tests never go online. */
function mockFetch(response: Response) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
}

/** Rebuilds the `Request` object from the arguments passed to `fetch`. */
function getRequest(fetchSpy: MockInstance<typeof fetch>) {
  const [call] = fetchSpy.mock.calls;

  if (call === undefined) {
    throw new Error("fetch wasn't called");
  }

  return new Request(...call);
}

/** Delete runner-like env vars even when tests run inside GitHub Actions. */
function unsetEnv(name: string) {
  // oxlint-disable-next-line unicorn/no-useless-undefined -- `undefined` is how Vitest is told to delete the variable, and the argument can't be left out.
  vi.stubEnv(name, undefined);
}

function createClient() {
  return createGitHubClient({ token: "ghs_token", userAgent: "some-action" });
}

describe("getRepository()", () => {
  it("should read the owner and the name from GITHUB_REPOSITORY", () => {
    expect.hasAssertions();

    vi.stubEnv("GITHUB_REPOSITORY", "octocat/hello-world");

    expect(getRepository()).toStrictEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  it.for([undefined, ""])(
    "should throw when GITHUB_REPOSITORY is %j",
    (value) => {
      expect.hasAssertions();

      vi.stubEnv("GITHUB_REPOSITORY", value);

      expect(() => getRepository()).toThrow(
        "GITHUB_REPOSITORY env variable isn't set",
      );
    },
  );

  it.for(["octocat", "octocat/", "/hello-world", "octocat/hello/world"])(
    "should throw when GITHUB_REPOSITORY is the malformed %j",
    (value) => {
      expect.hasAssertions();

      vi.stubEnv("GITHUB_REPOSITORY", value);

      expect(() => getRepository()).toThrow(
        `GITHUB_REPOSITORY env variable isn't in the "owner/repo" form: ${value}`,
      );
    },
  );
});

describe("createGitHubClient()", () => {
  describe("request", () => {
    it("should send an authenticated request to GITHUB_API_URL", async () => {
      expect.hasAssertions();

      vi.stubEnv("GITHUB_API_URL", "http://localhost:8080/api/v3");

      const fetchSpy = mockFetch(Response.json([]));

      await createClient().request(
        {
          method: "GET",
          path: "/repos/octocat/hello-world/pulls",
          searchParams: { head: "octocat:release", per_page: 1 },
        },
        array(PullRequestSchema),
      );

      const request = getRequest(fetchSpy);

      expect(request.method).toBe("GET");
      expect(request.url).toBe(
        "http://localhost:8080/api/v3/repos/octocat/hello-world/pulls?head=octocat%3Arelease&per_page=1",
      );
      expect(Object.fromEntries(request.headers)).toStrictEqual({
        accept: "application/vnd.github+json",
        authorization: "Bearer ghs_token",
        "user-agent": "some-action",
        "x-github-api-version": "2022-11-28",
      });
    });

    it("should send the request to GitHub.com without GITHUB_API_URL", async () => {
      expect.hasAssertions();

      unsetEnv("GITHUB_API_URL");

      const fetchSpy = mockFetch(Response.json({ number: 1 }));

      await createClient().request(
        { method: "GET", path: "/repos/octocat/hello-world/pulls/1" },
        PullRequestSchema,
      );

      expect(getRequest(fetchSpy).url).toBe(
        "https://api.github.com/repos/octocat/hello-world/pulls/1",
      );
    });

    it("should send the body as JSON", async () => {
      expect.hasAssertions();

      const fetchSpy = mockFetch(Response.json({ number: 1 }, { status: 201 }));
      const body = { title: "chore: release", head: "release", base: "main" };

      await createClient().request(
        { method: "POST", path: "/repos/octocat/hello-world/pulls", body },
        PullRequestSchema,
      );

      const request = getRequest(fetchSpy);

      expect(request.method).toBe("POST");
      expect(request.headers.get("content-type")).toBe("application/json");
      await expect(request.json()).resolves.toStrictEqual(body);
    });

    it("should resolve with the response body, validated against the schema", async () => {
      expect.hasAssertions();

      mockFetch(Response.json({ number: 1, title: "chore: release" }));

      await expect(
        createClient().request(
          { method: "GET", path: "/repos/octocat/hello-world/pulls/1" },
          PullRequestSchema,
        ),
      ).resolves.toStrictEqual({ number: 1 });
    });

    it("should resolve with nothing when no schema is given", async () => {
      expect.hasAssertions();

      mockFetch(new Response(null, { status: 204 }));

      await expect(
        createClient().request({
          method: "DELETE",
          path: "/installation/token",
        }),
      ).resolves.toBeUndefined();
    });

    it("should throw when the response isn't a success", async () => {
      expect.hasAssertions();

      mockFetch(Response.json({ message: "Not Found" }, { status: 404 }));

      await expect(
        createClient().request(
          { method: "GET", path: "/repos/octocat/hello-world/pulls/1" },
          PullRequestSchema,
        ),
      ).rejects.toThrow(
        'GitHub API GET /repos/octocat/hello-world/pulls/1 failed with 404: {"message":"Not Found"}',
      );
    });

    it("should throw when the response body doesn't match the schema", async () => {
      expect.hasAssertions();

      mockFetch(Response.json({ number: "one" }));

      await expect(
        createClient().request(
          { method: "GET", path: "/repos/octocat/hello-world/pulls/1" },
          PullRequestSchema,
        ),
      ).rejects.toThrow(
        "GitHub API GET /repos/octocat/hello-world/pulls/1 returned an unexpected value:",
      );
    });
  });
});
