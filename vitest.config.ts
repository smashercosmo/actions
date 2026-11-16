import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      /** Fast unit tests for actions and shared helpers. */
      {
        test: {
          name: "unit",
          include: ["shared/*.spec.ts", "*/*.spec.ts"],
          /**
           * Schema type tests compare runtime validators with GitHub and pnpm
           * response types.
           */
          typecheck: {
            enabled: true,
            include: ["*/*.spec-d.ts"],
          },
          restoreMocks: true,
          unstubEnvs: true,
        },
      },
      /**
       * Local workflow tests. `act` runs the reusable workflows in Docker
       * against mocked GitHub, Git, and npm services.
       */
      {
        test: {
          name: "act",
          include: [".github/tests/**/*.spec.ts"],
          globalSetup: "./.github/tests/global-setup.ts",
          /**
           * `act` derives container names from workflow names, so parallel
           * files running the same workflow collide:
           * https://github.com/pshevche/act-test-runner/wiki/Known-limitations#sequential-runner-invocations).
           */
          fileParallelism: false,
          /**
           * Docker startup, pnpm download, and in-container installs are much
           * slower than ordinary unit tests.
           */
          testTimeout: 300_000,
        },
      },
    ],
  },
});
