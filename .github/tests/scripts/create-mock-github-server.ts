import type { Endpoints } from "@octokit/types";
import type { RequestHandler } from "msw";
import type { IncomingMessage, ServerResponse } from "node:http";

import { getResponse, http, HttpResponse } from "msw";
import { once } from "node:events";
import { createServer } from "node:http";
import { buffer } from "node:stream/consumers";
import { z } from "zod";

import {
  CONSUMER_OWNER,
  CONSUMER_URL,
  INSTALLATION_TOKEN,
  RELEASE_BOT_INSTALLATION_ID,
  RELEASE_BOT_SLUG,
  RELEASE_BOT_USER_ID,
} from "./actrc.ts";
import { git } from "./exec.ts";

/** MSW handler factory by HTTP method. */
const ROUTES = {
  DELETE: http.delete,
  GET: http.get,
  HEAD: http.head,
  PATCH: http.patch,
  POST: http.post,
  PUT: http.put,
};

function isMethod(method: string): method is keyof typeof ROUTES {
  return Object.hasOwn(ROUTES, method);
}

/**
 * GitHub REST route as Octokit types it, including method and path template.
 * Using these strings makes mocked endpoints type-check against the real API.
 */
type Route = keyof Endpoints;

/** Documented response body for a GitHub endpoint. */
type Data<TRoute extends Route> = Endpoints[TRoute]["response"]["data"];

/**
 * Mock handlers only return fields the actions read. List endpoints are
 * unwrapped so item fields can be partial too.
 */
type ResponseData<TRoute extends Route> =
  Data<TRoute> extends readonly (infer TItem)[]
    ? Partial<TItem>[]
    : Partial<Data<TRoute>>;

interface MockRequest {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  token: string;
}

interface MockPullRequest {
  number: number;
  title: string;
  body: string;
  head: string;
  base: string;
}

interface MockRelease {
  tag_name: string;
  target_commitish: string;
  name: string;
  body: string;
}

interface RecordedRequest {
  method: string;
  path: string;
  token: string;
}

/**
 * Validate mutating request bodies so broken action payloads fail at the mock
 * boundary with useful errors.
 */
const TokenRequestSchema = z.object({
  repositories: z.array(z.string()),
  permissions: z.record(z.string(), z.string()),
});

const PullRequestSchema = z.object({
  title: z.string(),
  body: z.string(),
  head: z.string(),
  base: z.string(),
});

/**
 * Inline `content` for added and changed files, `sha: null` for deleted ones,
 * the two forms the release PR action sends.
 */
const TreeEntrySchema = z.strictObject({
  path: z.string(),
  mode: z.string(),
  type: z.literal("blob"),
});

const ChangedTreeEntrySchema = TreeEntrySchema.extend({ content: z.string() });
const DeletedTreeEntrySchema = TreeEntrySchema.extend({ sha: z.null() });

const TreeSchema = z.strictObject({
  base_tree: z.string(),
  tree: z.array(z.union([ChangedTreeEntrySchema, DeletedTreeEntrySchema])),
});

/**
 * GitHub signs a commit made by an app only without a custom author, committer,
 * or signature, so the mock rejects those fields.
 */
const CommitSchema = z.strictObject({
  message: z.string(),
  tree: z.string(),
  parents: z.array(z.string()),
});

const CreateRefSchema = z.strictObject({ ref: z.string(), sha: z.string() });

/** The mock implements forced updates only. */
const UpdateRefSchema = z.strictObject({
  sha: z.string(),
  force: z.literal(true),
});

/**
 * Extra release fields such as `draft: true` would change GitHub semantics the
 * mock does not implement.
 */
const ReleaseSchema = z.strictObject({
  tag_name: z.string(),
  target_commitish: z.string(),
  name: z.string(),
  body: z.string(),
});

function getPullUrl(number: number) {
  return `${CONSUMER_URL}/pull/${number}`;
}

function getReleaseUrl(tag: string) {
  return `${CONSUMER_URL}/releases/tag/${tag}`;
}

/**
 * Extracts the auth token and normalizes GitHub App JWTs, whose timestamps and
 * signatures change on every request.
 */
function getToken(request: Request) {
  const [, token = ""] = (request.headers.get("authorization") ?? "").split(
    " ",
  );

  return token.split(".").length === 3 ? "app-jwt" : token;
}

/** Registers a typed MSW handler for one GitHub REST endpoint. */
function mockEndpoint<TRoute extends Route>(
  route: TRoute,
  status: number,
  resolve: (request: MockRequest) => ResponseData<TRoute> | undefined,
) {
  const [method = "", url = ""] = route.split(" ");

  if (!isMethod(method)) {
    throw new Error(`Can't mock ${route}, its method isn't supported`);
  }

  return ROUTES[method](
    /**
     * Convert GitHub route params to MSW params and match any host/port. A
     * `{ref}` such as `heads/release` spans several path segments.
     */
    `*${url.replace("{ref}", ":ref+").replaceAll(/\{(?<name>[^\{\}]+)\}/gv, ":$<name>")}`,
    async ({ params, request }) => {
      /** Read text first so body-less requests do not hit JSON parse errors. */
      const text = await request.text();
      const body: unknown = text === "" ? undefined : JSON.parse(text);
      const data = resolve({
        params: Object.fromEntries(
          Object.entries(params).map(([name, value]) => [name, String(value)]),
        ),
        query: new URL(request.url).searchParams,
        body,
        token: getToken(request),
      });

      return data === undefined
        ? new HttpResponse(null, { status })
        : HttpResponse.json(data, { status });
    },
  );
}

/**
 * Starts the GitHub REST API surface needed by the workflow tests. Node handles
 * TCP traffic from Docker; MSW handles route matching.
 *
 * Git database requests and creating a release write to the consumer's bare
 * remote, just like GitHub does.
 */
async function createMockGitHubServer({
  remoteRepoDir,
}: {
  remoteRepoDir: string;
}) {
  const requests: RecordedRequest[] = [];
  const tokenRequests: z.infer<typeof TokenRequestSchema>[] = [];
  const revokedTokens: string[] = [];
  const pulls: MockPullRequest[] = [];
  const releases: MockRelease[] = [];

  const handlers: RequestHandler[] = [
    /** App installation lookup used before creating an installation token. */
    mockEndpoint("GET /repos/{owner}/{repo}/installation", 200, () => ({
      id: RELEASE_BOT_INSTALLATION_ID,
      app_slug: RELEASE_BOT_SLUG,
    })),

    /** Issue the fake installation token and record requested permissions. */
    mockEndpoint(
      "POST /app/installations/{installation_id}/access_tokens",
      201,
      ({ body }) => {
        tokenRequests.push(TokenRequestSchema.parse(body));

        return {
          token: INSTALLATION_TOKEN,
          expires_at: "2099-01-01T00:00:00Z",
        };
      },
    ),

    /** Record the token revoked by the action's post step. */
    mockEndpoint("DELETE /installation/token", 204, ({ token }) => {
      revokedTokens.push(token);
    }),

    /**
     * Build the tree in an index of its own, starting from `base_tree`. Paths
     * that aren't listed keep what they have there. `read-tree` replaces what
     * the index had, so it can be reused.
     */
    mockEndpoint("POST /repos/{owner}/{repo}/git/trees", 201, ({ body }) => {
      const { base_tree: baseTree, tree } = TreeSchema.parse(body);
      const env = { GIT_INDEX_FILE: `${remoteRepoDir}/mock-tree-index` };

      git(remoteRepoDir, ["read-tree", baseTree], { env });

      /** Mode 0 removes a path from the index. */
      const entries = tree.map((entry) => {
        if (!("content" in entry)) {
          return `0 ${"0".repeat(40)}\t${entry.path}`;
        }

        const blob = git(remoteRepoDir, ["hash-object", "-w", "--stdin"], {
          input: entry.content,
        });

        return `${entry.mode} ${blob}\t${entry.path}`;
      });

      git(remoteRepoDir, ["update-index", "--index-info"], {
        env,
        input: `${entries.join("\n")}\n`,
      });

      return { sha: git(remoteRepoDir, ["write-tree"], { env }) };
    }),

    /** Author the commit as the app's bot, like GitHub does for app tokens. */
    mockEndpoint("POST /repos/{owner}/{repo}/git/commits", 201, ({ body }) => {
      const { message, tree, parents } = CommitSchema.parse(body);
      const bot = `${RELEASE_BOT_SLUG}[bot]`;

      return {
        sha: git(
          remoteRepoDir,
          [
            "commit-tree",
            tree,
            ...parents.flatMap((parent) => ["-p", parent]),
            "-m",
            message,
          ],
          {
            env: {
              GIT_AUTHOR_NAME: bot,
              GIT_AUTHOR_EMAIL: `${RELEASE_BOT_USER_ID}+${bot}@users.noreply.github.com`,
              GIT_COMMITTER_NAME: "GitHub",
              GIT_COMMITTER_EMAIL: "noreply@github.com",
            },
          },
        ),
      };
    }),

    /** GitHub lists every ref that starts with `ref`, not only an exact match. */
    mockEndpoint(
      "GET /repos/{owner}/{repo}/git/matching-refs/{ref}",
      200,
      ({ params }) =>
        git(remoteRepoDir, ["for-each-ref", "--format=%(refname)"])
          .split("\n")
          .filter((name) => name.startsWith(`refs/${params["ref"] ?? ""}`))
          .map((name) => ({ ref: name })),
    ),

    /** An empty old value makes `update-ref` fail if the ref exists already. */
    mockEndpoint("POST /repos/{owner}/{repo}/git/refs", 201, ({ body }) => {
      const { ref, sha } = CreateRefSchema.parse(body);
      git(remoteRepoDir, ["update-ref", ref, sha, ""]);

      return { ref };
    }),

    /** `rev-parse` makes the update fail if the ref doesn't exist, like GitHub. */
    mockEndpoint(
      "PATCH /repos/{owner}/{repo}/git/refs/{ref}",
      200,
      ({ params, body }) => {
        const ref = `refs/${params["ref"] ?? ""}`;
        const { sha } = UpdateRefSchema.parse(body);
        git(remoteRepoDir, ["rev-parse", "--verify", ref]);
        git(remoteRepoDir, ["update-ref", ref, sha]);

        return { ref };
      },
    ),

    /** Filter open PRs the same way the release action queries them. */
    mockEndpoint("GET /repos/{owner}/{repo}/pulls", 200, ({ query }) =>
      pulls
        .filter(
          (pull) =>
            query.get("head") === `${CONSUMER_OWNER}:${pull.head}` &&
            query.get("base") === pull.base,
        )
        .map(({ number, title, body }) => ({
          number,
          title,
          body,
          html_url: getPullUrl(number),
        })),
    ),

    /** Assign stable sequential PR numbers for assertions. */
    mockEndpoint("POST /repos/{owner}/{repo}/pulls", 201, ({ body }) => {
      const number = pulls.length + 1;
      pulls.push({ number, ...PullRequestSchema.parse(body) });

      return { number, html_url: getPullUrl(number) };
    }),

    mockEndpoint(
      "PATCH /repos/{owner}/{repo}/pulls/{pull_number}",
      200,
      ({ params, body }) => {
        const number = Number(params["pull_number"]);
        const pull = pulls.find((candidate) => candidate.number === number);

        if (pull === undefined) {
          throw new Error(`Pull request ${number} doesn't exist`);
        }

        Object.assign(
          pull,
          PullRequestSchema.pick({ title: true, body: true }).parse(body),
        );

        return { number, html_url: getPullUrl(number) };
      },
    ),

    /**
     * Publishing a release creates its tag. Duplicate tags fail the action even
     * though the mock returns 500 instead of GitHub's 422.
     */
    mockEndpoint("POST /repos/{owner}/{repo}/releases", 201, ({ body }) => {
      const release = ReleaseSchema.parse(body);

      if (releases.some(({ tag_name: tag }) => tag === release.tag_name)) {
        throw new Error(`A release with the tag ${release.tag_name} exists`);
      }

      git(remoteRepoDir, ["tag", release.tag_name, release.target_commitish]);
      releases.push(release);

      return {
        tag_name: release.tag_name,
        html_url: getReleaseUrl(release.tag_name),
      };
    }),
  ];

  /** Convert Node HTTP requests into Fetch requests so MSW can route them. */
  async function respond(incoming: IncomingMessage) {
    const method = incoming.method ?? "GET";
    const url = new URL(incoming.url ?? "/", "http://github.mock");
    const headers = new Headers();

    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) {
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
    }

    /**
     * Omit empty bodies because Fetch disallows bodies on methods such as GET
     * and HEAD.
     */
    const payload = await buffer(incoming);
    const request = new Request(url, {
      method,
      headers,
      ...(payload.length > 0 ? { body: payload } : {}),
    });

    requests.push({ method, path: url.pathname, token: getToken(request) });

    const response = await getResponse(handlers, request);

    /** Unknown endpoints should fail the action, not silently pass. */
    return (
      response ??
      HttpResponse.json(
        { message: `${method} ${url.pathname} isn't mocked` },
        { status: 404 },
      )
    );
  }

  /**
   * Turn mock failures, including schema validation errors, into HTTP responses
   * the action can print in its own logs.
   */
  async function handle(incoming: IncomingMessage, outgoing: ServerResponse) {
    try {
      const response = await respond(incoming);
      const body = await response.arrayBuffer();

      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(body));
    } catch (error) {
      outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ message: String(error) }));
    }
  }

  /** `handle` owns error reporting, so the request task can be fire-and-forget. */
  const server = createServer((incoming, outgoing) => {
    void handle(incoming, outgoing);
  });

  /** Port 0 avoids collisions between parallel tests. */
  server.listen(0);
  await once(server, "listening");

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("The mock GitHub server has no port");
  }

  return {
    port: address.port,
    requests,
    tokenRequests,
    revokedTokens,
    pulls,
    releases,

    /** Close keep-alive connections so test teardown does not hang. */
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}

export { createMockGitHubServer };
