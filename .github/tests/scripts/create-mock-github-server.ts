import type { RequestHandler } from "msw";
import type { IncomingMessage, ServerResponse } from "node:http";

import { getOctokit } from "@actions/github";
import { getResponse, http, HttpResponse } from "msw";
import { graphql } from "msw/graphql";
import { once } from "node:events";
import { createServer } from "node:http";
import { buffer } from "node:stream/consumers";
import { z } from "zod";

import {
  CONSUMER_OWNER,
  CONSUMER_REPO,
  CONSUMER_URL,
  INSTALLATION_TOKEN,
  RELEASE_BOT_INSTALLATION_ID,
  RELEASE_BOT_SLUG,
  RELEASE_BOT_USER_ID,
} from "./actrc";

/**
 * Maps HTTP method names to corresponding MSW route handler creators. Octokit
 * exposes uppercase method names on endpoint definitions, which maps to these
 * functions.
 */
const ROUTES = {
  DELETE: http.delete,
  GET: http.get,
  HEAD: http.head,
  PATCH: http.patch,
  POST: http.post,
  PUT: http.put,
};

/**
 * Type definition for an Octokit REST endpoint method (e.g.
 * `rest.pulls.create`).
 *
 * In addition to being callable, Octokit defines endpoint metadata under
 * `endpoint.DEFAULTS`, such as the HTTP method and route template (e.g. `POST`
 * and `/repos/{owner}/{repo}/pulls`). The function parameters use `never[]`
 * because the method is only used for metadata inspection, not invocation.
 */
interface Endpoint {
  (...args: never[]): Promise<{ data: unknown }>;
  endpoint: { DEFAULTS: { method: keyof typeof ROUTES; url: string } };
}

/** Extracts the resolved response data type from an Octokit endpoint method. */
type Data<TEndpoint extends Endpoint> = Awaited<ReturnType<TEndpoint>>["data"];

/**
 * Expected return type for a mocked endpoint handler. Makes all response fields
 * optional since mock handlers only need to supply the fields read by the
 * actions under test. Automatically unwraps array elements for list endpoints.
 */
type ResponseData<TEndpoint extends Endpoint> =
  Data<TEndpoint> extends readonly (infer TItem)[]
    ? Partial<TItem>[]
    : Partial<Data<TEndpoint>>;

/** Request details provided to a mock endpoint handler. */
interface MockRequest {
  /** Parsed URL path parameters matching `{param}` placeholders in the route. */
  params: Record<string, string>;
  /** Parsed query string parameters from the request URL. */
  query: URLSearchParams;
  /** Parsed JSON request body, or `undefined` if the request has no body. */
  body: unknown;
  /** Extracted authorization token or `'app-jwt'` (see `getToken`). */
  token: string;
}

/** In-memory pull request representation stored by the mock server. */
interface MockPullRequest {
  number: number;
  title: string;
  body: string;
  /** Head branch containing the changes. */
  head: string;
  /** Base branch receiving the changes. */
  base: string;
}

/**
 * In-memory release representation stored by the mock server using GitHub REST
 * API fields.
 */
interface MockRelease {
  tag_name: string;
  /** Commit SHA or branch name the release tag points to. */
  target_commitish: string;
  name: string;
  body: string;
  draft: boolean;
}

/** Inbound HTTP request captured by the mock server for test assertions. */
interface RecordedRequest {
  method: string;
  path: string;
  /**
   * Auth token or `'app-jwt'` if authenticated via GitHub App JWT (see
   * `getToken`).
   */
  token: string;
}

/**
 * Validation schemas for mutating request payloads sent by GitHub Actions.
 * Validating incoming request bodies ensures actions provide the expected
 * payload structures, failing fast if an action omits required fields or sends
 * invalid types.
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

const ReleaseSchema = z.object({
  tag_name: z.string(),
  target_commitish: z.string(),
  name: z.string(),
  body: z.string(),
  draft: z.boolean(),
});

/** Variables of the release lookup sent by `create-github-release`. */
const ExistingReleaseVariablesSchema = z.object({
  owner: z.string(),
  name: z.string(),
  tag: z.string(),
});

/** Builds the HTML URL for a pull request on the mock consumer repository. */
function getPullUrl(number: number) {
  return `${CONSUMER_URL}/pull/${number}`;
}

/** Builds the HTML URL for a release tag on the mock consumer repository. */
function getReleaseUrl(tag: string) {
  return `${CONSUMER_URL}/releases/tag/${tag}`;
}

/**
 * Extracts the token from the `Authorization` header (`token <token>` or
 * `Bearer <token>`). Returns an empty string if the header is absent.
 *
 * GitHub App JWTs (three dot-separated base64 segments) are normalized to
 * `'app-jwt'` because JWTs have dynamic timestamps and signatures that vary
 * across requests.
 */
function getToken(request: Request) {
  const [, token = ""] = (request.headers.get("authorization") ?? "").split(
    " ",
  );

  return token.split(".").length === 3 ? "app-jwt" : token;
}

/**
 * Registers an MSW request handler using Octokit endpoint metadata.
 *
 * The HTTP method and URL route are derived directly from `endpoint.DEFAULTS`,
 * ensuring mock routes match real Octokit endpoints and responses adhere to
 * expected types.
 *
 * @param endpoint The Octokit REST endpoint to mock.
 * @param status HTTP response status code (e.g. 200, 201, 204).
 * @param resolve Handler callback that receives the request and returns the
 *   response body.
 */
function mockEndpoint<TEndpoint extends Endpoint>(
  endpoint: TEndpoint,
  status: number,
  resolve: (request: MockRequest) => ResponseData<TEndpoint> | undefined,
) {
  const { method, url } = endpoint.endpoint.DEFAULTS;
  const route = ROUTES[method];

  return route(
    /**
     * Converts Octokit URL parameter syntax (`{param}`) to MSW syntax
     * (`:param`). The leading wildcard `*` matches requests to any host or
     * port.
     */
    `*${url.replaceAll(/\{(?<name>[^\{\}]+)\}/gv, ":$<name>")}`,
    async ({ params, request }) => {
      /**
       * Reads as text first to handle body-less requests without JSON parse
       * errors.
       */
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
 * Spawns a local HTTP server emulating the GitHub REST API endpoints, and the
 * GraphQL query, required by the actions.
 *
 * Handles requests from actions running in Docker containers, tracks created
 * pull requests and releases in memory, and records all incoming requests for
 * test assertions. MSW is used here solely for route matching and request
 * parsing (`getResponse`), while Node's `http.createServer` handles actual TCP
 * networking.
 */
async function createMockGitHubServer() {
  /**
   * An octokit client that never sends a request. Only its `rest` methods are
   * used, for the HTTP method and URL of each endpoint, see `mockEndpoint`
   */
  const { rest } = getOctokit("unused");

  /** What the server remembers, see the returned object */
  const requests: RecordedRequest[] = [];
  const tokenRequests: z.infer<typeof TokenRequestSchema>[] = [];
  const revokedTokens: string[] = [];
  const pulls: MockPullRequest[] = [];
  const releases: MockRelease[] = [];

  /**
   * Typed explicitly, as msw types the extras of a GraphQL handler as `any`,
   * which would make the inferred array unsafe to pass to `getResponse`
   */
  const handlers: RequestHandler[] = [
    /**
     * Endpoints called by the `create-token` action:
     *
     * 1. Retrieves installation details for the GitHub App on the target
     *    repository.
     */
    mockEndpoint(rest.apps.getRepoInstallation, 200, () => ({
      id: RELEASE_BOT_INSTALLATION_ID,
      app_slug: RELEASE_BOT_SLUG,
    })),

    /**
     * 2. Issues an installation access token. Stores the requested scopes and
     *    permissions for test assertions.
     */
    mockEndpoint(rest.apps.createInstallationAccessToken, 201, ({ body }) => {
      tokenRequests.push(TokenRequestSchema.parse(body));

      return {
        token: INSTALLATION_TOKEN,
        expires_at: "2099-01-01T00:00:00Z",
      };
    }),

    /**
     * 3. Revokes the temporary installation token during post-job cleanup.
     *    Authenticated using the token being revoked and returns an empty 204
     *    response.
     */
    mockEndpoint(rest.apps.revokeInstallationAccessToken, 204, ({ token }) => {
      revokedTokens.push(token);
    }),

    /**
     * Resolves the bot user identity for `create-release-pr`, which formats the
     * commit author email using this user ID
     * (`<id>+<slug>[bot]@users.noreply.github.com`).
     */
    mockEndpoint(rest.users.getByUsername, 200, ({ params }) => ({
      id: RELEASE_BOT_USER_ID,
      login: params["username"] ?? "",
    })),

    /**
     * Lists existing PRs to check whether an automated release PR is already
     * open. The GitHub API expects `head` formatted as `<owner>:<branch>`.
     */
    mockEndpoint(rest.pulls.list, 200, ({ query }) =>
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

    /** Creates a new pull request, assigning sequential numbers starting at 1. */
    mockEndpoint(rest.pulls.create, 201, ({ body }) => {
      const number = pulls.length + 1;
      pulls.push({ number, ...PullRequestSchema.parse(body) });

      return { number, html_url: getPullUrl(number) };
    }),

    /** Updates the title and body of an existing release pull request. */
    mockEndpoint(rest.pulls.update, 200, ({ params, body }) => {
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
    }),

    /**
     * Looks up a release by tag, drafts included, so `create-github-release`
     * doesn't draft a release that exists already. Matched by the operation
     * name of its query, so any other GraphQL operation stays unmocked. Like
     * GitHub, a lookup that finds nothing returns `release: null` with a 200
     * status
     */
    graphql.link("*/graphql").query("ExistingRelease", ({ variables }) => {
      const { owner, name, tag } =
        ExistingReleaseVariablesSchema.parse(variables);

      if (owner !== CONSUMER_OWNER || name !== CONSUMER_REPO) {
        throw new Error(`Unexpected repository ${owner}/${name}`);
      }

      const release = releases.find(({ tag_name: tagName }) => tagName === tag);

      return HttpResponse.json({
        data: {
          repository: {
            release:
              release === undefined
                ? // oxlint-disable-next-line unicorn/no-null -- GitHub answers a missing release with null, which JSON keeps (unlike undefined)
                  null
                : {
                    isDraft: release.draft,
                    url: getReleaseUrl(release.tag_name),
                  },
          },
        },
      });
    }),

    /** Drafts a new GitHub release for a tag. */
    mockEndpoint(rest.repos.createRelease, 201, ({ body }) => {
      const release = ReleaseSchema.parse(body);
      releases.push(release);

      return {
        tag_name: release.tag_name,
        html_url: getReleaseUrl(release.tag_name),
      };
    }),
  ];

  /**
   * Matches an incoming Node.js HTTP request against registered MSW route
   * handlers, converting between Node HTTP streams and the standard Fetch API
   * `Request`/`Response`.
   */
  async function respond(incoming: IncomingMessage) {
    const method = incoming.method ?? "GET";
    /** Node requests provide path only; URL constructor requires a base URL. */
    const url = new URL(incoming.url ?? "/", "http://github.mock");
    const headers = new Headers();

    /**
     * Combines multi-value Node headers into comma-delimited strings for Fetch
     * Headers.
     */
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) {
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
    }

    /**
     * Reads the entire body buffer. Omits `body` when empty, as Fetch API
     * disallows bodies on methods like GET/HEAD.
     */
    const payload = await buffer(incoming);
    const request = new Request(url, {
      method,
      headers,
      ...(payload.length > 0 ? { body: payload } : {}),
    });

    requests.push({ method, path: url.pathname, token: getToken(request) });

    /** Resolves the response from the first matching MSW handler. */
    const response = await getResponse(handlers, request);

    /** Unhandled endpoints return 404 so caller actions fail explicitly. */
    return (
      response ??
      HttpResponse.json(
        { message: `${method} ${url.pathname} isn't mocked` },
        { status: 404 },
      )
    );
  }

  /**
   * Handles incoming HTTP requests and pipes responses back to the client.
   * Catches errors (e.g. schema validation failures in handlers) and responds
   * with 500 so failing actions output informative error messages.
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

  /**
   * Error handling is encapsulated inside `handle`, so unawaited execution is
   * safe.
   */
  const server = createServer((incoming, outgoing) => {
    void handle(incoming, outgoing);
  });

  /**
   * Port 0 assigns an ephemeral free port, avoiding collisions between parallel
   * tests.
   */
  server.listen(0);
  await once(server, "listening");

  /** Retrieves assigned server address (`null` if not listening). */
  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("The mock GitHub server has no port");
  }

  return {
    /** Assigned port on localhost. */
    port: address.port,
    /** Chronological record of all received HTTP requests. */
    requests,
    /** Recorded payload bodies from GitHub App token requests. */
    tokenRequests,
    /** Tokens revoked via token revocation endpoint. */
    revokedTokens,
    /** In-memory pull requests and releases maintained by the mock server. */
    pulls,
    releases,

    /**
     * Terminates the server and actively closes persistent connections to
     * ensure prompt test teardown without hanging.
     */
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
    },
  };
}

export { createMockGitHubServer };
