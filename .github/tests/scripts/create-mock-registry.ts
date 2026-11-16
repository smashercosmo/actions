import { once } from "node:events";
import fs from "node:fs";
import { Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { runServer } from "verdaccio";
import { z } from "zod";

/**
 * Dedicated publisher user created on the mock registry for authenticated
 * publish operations.
 */
const USER = "publisher";

/**
 * Validation schemas for Verdaccio API responses. Enforces expected shapes when
 * reading package metadata and staged versions.
 */

/** Schema for user creation response containing the authentication token. */
const UserSchema = z.object({ token: z.string() });

/** Schema for an npm packument document containing metadata and version records. */
const PackumentSchema = z.object({
  versions: z.record(z.string(), z.unknown()),
});

/** Schema for an individual staged package version. */
const StagedItemSchema = z.object({
  id: z.string(),
  packageName: z.string(),
  version: z.string(),
});

const StagedSchema = z.object({ items: z.array(StagedItemSchema) });

/**
 * Starts an isolated in-process Verdaccio npm registry for package publish and
 * install tests.
 *
 * Runs without upstream fallbacks, ensuring packages can only be resolved if
 * published during the test.
 *
 * Package staging (`flags: { stage: true }`) is enabled to test `pnpm stage
 * publish`, which uploads releases to a staging area for review before public
 * release. Staged packages are inspected via `getStagedVersions()` rather than
 * `getVersions()`.
 */
async function createMockRegistry() {
  /** Resolves symlinks in `os.tmpdir()` (common on macOS). */
  const tmpDir = fs.realpathSync(os.tmpdir());
  /**
   * Temporary storage directory for Verdaccio databases, storage, and auth
   * configs.
   */
  const dir = fs.mkdtempSync(path.join(tmpDir, "act-registry-"));

  /**
   * `runServer` returns `Promise<any>`; we validate the resulting HTTP server
   * instance below.
   */
  const server: unknown = await runServer({
    self_path: path.join(dir, "config.yaml"),
    /** Storage path for published tarballs and package metadata. */
    storage: path.join(dir, "storage"),
    /** File storage for registered user credentials. */
    auth: { htpasswd: { file: path.join(dir, "htpasswd") } },
    /**
     * Package access rules: allow all users to read/install; require
     * authentication to publish.
     */
    packages: {
      "**": { access: "$all", publish: "$authenticated" },
    },
    flags: { stage: true },
    /** Restrict logging to fatal errors only to keep test logs concise. */
    log: { type: "stdout", format: "pretty", level: "fatal" },
  });

  if (!(server instanceof Server)) {
    throw new TypeError("Verdaccio didn't return an HTTP server");
  }

  /**
   * Port 0 assigns an ephemeral free port, avoiding collisions between parallel
   * tests.
   */
  server.listen(0);
  await once(server, "listening");

  /** Retrieves the assigned port (`null` if not listening). */
  const address = server.address();

  if (address === null || typeof address === "string") {
    throw new Error("The mock registry has no port");
  }

  const { port } = address;
  const url = `http://localhost:${port}`;

  /**
   * Registers the publisher user via the CouchDB user endpoint (equivalent to
   * `npm adduser`) and retrieves an authentication token.
   */
  const userResponse = await fetch(`${url}/-/user/org.couchdb.user:${USER}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: USER, password: "publisher-password" }),
  });
  const user: unknown = await userResponse.json();
  const { token } = UserSchema.parse(user);

  /**
   * Creates an `.npmrc` file mapping the auth token to both `localhost` (used
   * by pnpm on the host) and `host.docker.internal` (used by pnpm inside Docker
   * containers).
   */
  const npmrcFile = path.join(dir, "npmrc");
  fs.writeFileSync(
    npmrcFile,
    [`localhost:${port}`, `host.docker.internal:${port}`]
      .map((host) => `//${host}/:_authToken=${token}\n`)
      .join(""),
  );

  return {
    /** Assigned port on localhost. */
    port,
    npmrcFile,

    /**
     * Returns all publicly published versions of a package (excluding staged
     * versions). Returns an empty array if the package does not exist.
     */
    async getVersions(name: string) {
      const response = await fetch(`${url}/${name}`);

      if (response.status === 404) {
        return [];
      }

      const packument: unknown = await response.json();

      return Object.keys(PackumentSchema.parse(packument).versions);
    },

    /**
     * Returns package versions currently in the staging area awaiting approval
     * (`<name>@<version>`).
     */
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
     * Publishes a staged version (`<name>@<version>`), what `pnpm stage approve
     * <stage id>` does. The mock registry asks for no one-time password
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
     * Terminates the server, closes active keep-alive connections, and deletes
     * the temporary storage directory.
     */
    async close() {
      server.close();
      server.closeAllConnections();
      await once(server, "close");
      fs.rmSync(dir, { force: true, recursive: true });
    },
  };
}

export { createMockRegistry };
