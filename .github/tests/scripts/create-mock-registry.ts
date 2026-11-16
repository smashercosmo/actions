import type { IncomingMessage, ServerResponse } from "node:http";

import { once } from "node:events";
import fs from "node:fs";
import { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { runServer } from "verdaccio";
import { z } from "zod";

/** Registry account used for authenticated publishes. */
const USER = "publisher";

/** User creation response containing the npm auth token. */
const UserSchema = z.object({ token: z.string() });

/** Packument fields the tests read. */
const PackumentSchema = z.object({
  versions: z.record(z.string(), z.unknown()),
});

/** Staged package fields the tests read. */
const StagedItemSchema = z.object({
  id: z.string(),
  packageName: z.string(),
  version: z.string(),
});

const StagedSchema = z.object({ items: z.array(StagedItemSchema) });

/**
 * Starts an isolated Verdaccio registry with npm staging enabled.
 *
 * There are no upstream fallbacks, so every installed package must have been
 * published by the test. Staged versions stay separate until `approve` is
 * called, matching the release workflow.
 */
async function createMockRegistry() {
  /** Resolve macOS tmpdir symlinks so Docker sees the same paths. */
  const tmpDir = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(tmpDir, "act-registry-"));

  /** Verdaccio types this as `any`, so validate the server before using it. */
  const server: unknown = await runServer({
    self_path: path.join(dir, "config.yaml"),
    storage: path.join(dir, "storage"),
    auth: { htpasswd: { file: path.join(dir, "htpasswd") } },
    packages: {
      "**": { access: "$all", publish: "$authenticated" },
    },
    flags: { stage: true },
    log: { type: "stdout", format: "pretty", level: "fatal" },
  });

  if (!(server instanceof Server)) {
    throw new TypeError("Verdaccio didn't return an HTTP server");
  }

  /** Port 0 avoids collisions between parallel tests. */
  server.listen(0);
  await once(server, "listening");

  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("The mock registry has no port");
  }

  const { port } = address;
  const url = `http://localhost:${port}`;

  /** Register the publisher and capture the token pnpm will use. */
  const userResponse = await fetch(`${url}/-/user/org.couchdb.user:${USER}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: USER, password: "publisher-password" }),
  });
  const user: unknown = await userResponse.json();
  const { token } = UserSchema.parse(user);

  /**
   * Host pnpm uses `localhost`; workflow containers use `host.docker.internal`.
   * The auth token must be valid for both registry hostnames.
   */
  const npmrcFile = path.join(dir, "npmrc");
  fs.writeFileSync(
    npmrcFile,
    [`localhost:${port}`, `host.docker.internal:${port}`]
      .map((host) => `//${host}/:_authToken=${token}\n`)
      .join(""),
  );

  return {
    port,
    npmrcFile,

    /**
     * Public versions only; staged versions are visible through
     * `getStagedVersions`.
     */
    async getVersions(name: string) {
      const response = await fetch(`${url}/${name}`);

      if (response.status === 404) {
        return [];
      }

      const packument: unknown = await response.json();

      return Object.keys(PackumentSchema.parse(packument).versions);
    },

    /** Versions waiting for staging approval, formatted as `<name>@<version>`. */
    async getStagedVersions() {
      const response = await fetch(`${url}/-/stage`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const staged: unknown = await response.json();

      return StagedSchema.parse(staged).items.map(
        ({ packageName, version }) => `${packageName}@${version}`,
      );
    },

    /**
     * Approves a staged version. Verdaccio's test registry does not ask for a
     * one-time password.
     */
    async approve(spec: string) {
      const response = await fetch(`${url}/-/stage`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const staged: unknown = await response.json();
      const item = StagedSchema.parse(staged).items.find(
        ({ packageName, version }) => `${packageName}@${version}` === spec,
      );

      if (item === undefined) {
        throw new Error(`${spec} isn't staged`);
      }

      const approveResponse = await fetch(`${url}/-/stage/${item.id}/approve`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });

      if (!approveResponse.ok) {
        throw new Error(
          `Approving ${spec} failed with ${approveResponse.status}: ${await approveResponse.text()}`,
        );
      }
    },

    /**
     * Waits until `create-github-release` checks whether a package version has
     * reached the public registry.
     */
    async waitForPackumentRequest(name: string) {
      const { promise, resolve } = Promise.withResolvers<ServerResponse>();
      /** Keep the narrowed server type visible inside the hoisted handler. */
      const httpServer = server;

      function onRequest(request: IncomingMessage, response: ServerResponse) {
        if (request.url === `/${name}`) {
          httpServer.off("request", onRequest);
          resolve(response);
        }
      }

      httpServer.on("request", onRequest);
      await once(await promise, "finish");
    },

    /** Close keep-alive connections and delete the temporary registry data. */
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
      fs.rmSync(dir, { force: true, recursive: true });
    },
  };
}

export { createMockRegistry };
