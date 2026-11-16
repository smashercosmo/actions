import { defineConfig } from "vitest/config";

/**
 * Configures Vitest to test our GitHub Actions workflows locally.
 *
 * Instead of pushing commits to real GitHub servers to test our workflows, we
 * use `act`. `act` runs the workflows inside local Docker containers on your
 * computer, interacting with mocked consumer repository, mocked GitHub API
 * server, and mocked npm registry.
 */
export default defineConfig({
  test: {
    include: [".github/tests/**/*.spec.ts"],
    globalSetup: "./.github/tests/global-setup.ts",
    /**
     * `act` names its Docker containers based on the workflow name (e.g. "CI").
     * If two test files run simultaneously using the same workflow, Docker
     * tries to create containers with the exact same name, crashing the tests
     * (see
     * https://github.com/pshevche/act-test-runner/wiki/Known-limitations#sequential-runner-invocations).
     */
    fileParallelism: false,
    /**
     * Give each test up to 5 minutes (instead of Vitest's default 5 seconds).
     * Starting Docker containers, downloading pnpm, and installing dependencies
     * inside the container takes noticeable time.
     */
    testTimeout: 300_000,
  },
});
