import type { ActStepExecResult, ActWorkflowExecResult } from "act-test-runner";
import type { TestAPI } from "vitest";

import { ActExecStatus, ActRunner } from "act-test-runner";
import process from "node:process";
import { inject } from "vitest";

import {
  getAdditionalArgs,
  getEnv,
  getSecrets,
  getVariables,
} from "./scripts/actrc";
import { createMockGitRepo } from "./scripts/create-mock-git-repo";
import { createMockGitHubServer } from "./scripts/create-mock-github-server";
import { createMockRegistry } from "./scripts/create-mock-registry";

/**
 * Known execution status strings defined by act-test-runner (`SUCCESS`,
 * `FAILED`, `SKIPPED`).
 */
const STATUSES = new Set<string>(Object.values(ActExecStatus));

/**
 * Checks whether a specific step execution phase actually ran.
 *
 * Act-test-runner reports entries for each phase (`pre`, `main`, and `post`).
 * Phases that were not executed have missing or empty status values, so we
 * verify the status against known valid values.
 */
function hasRun(step: ActStepExecResult) {
  return STATUSES.has(step.status);
}

/**
 * Generates a human-readable summary of a workflow run, listing jobs, executed
 * steps, and error output from failed steps. Included in assertion errors to
 * aid debugging.
 */
function describeRun(result: ActWorkflowExecResult) {
  const jobs = Object.values(result.jobs);
  const lines = [`The workflow run: ${result.status}`];

  for (const job of jobs) {
    lines.push(`  ${job.name}: ${job.status}`);

    for (const step of job.steps.filter(hasRun)) {
      lines.push(`    ${step.name}: ${step.status}`);

      if (step.status === ActExecStatus.FAILED) {
        lines.push(step.output);
      }
    }
  }

  /**
   * Captures act runner stderr/stdout when act terminates before scheduling any
   * jobs.
   */
  if (jobs.length === 0) {
    lines.push(result.output);
  }

  return lines.join("\n");
}

/**
 * Finds the main execution result of a specific step within a job. Throws an
 * informative error including the full run summary if the job or step did not
 * execute.
 */
function getStep(result: ActWorkflowExecResult, job: string, name: string) {
  const step = result.jobs[job]?.steps.find(
    (candidate) => candidate.name === name && hasRun(candidate),
  );

  if (step === undefined) {
    throw new Error(
      `The step "${name}" of the job "${job}" didn't run\n${describeRun(result)}`,
    );
  }

  return step;
}

/**
 * Asserts that the overall workflow execution completed with the expected
 * status. Fails with a detailed report of job and step outputs when the status
 * differs.
 */
function assertStatus(result: ActWorkflowExecResult, expected: ActExecStatus) {
  if (result.status !== expected) {
    throw new Error(
      `Expected the workflow run to have the status ${expected}\n${describeRun(result)}`,
    );
  }
}

/**
 * Extends Vitest's `it` test runner with isolated workflow fixtures:
 *
 * - `registry`: Local Verdaccio npm registry instance for package publishing and
 *   staging.
 * - `consumer`: Local git repository initialized from `fixtures/consumer`, with a
 *   bare remote.
 * - `github`: Mock GitHub REST API server for pull requests, releases, and token
 *   management.
 * - `act`: Factory function returning an `ActRunner` configured with environment
 *   variables, secrets, and arguments pointing to the test's mock services.
 *
 * Fixtures are isolated per test and automatically torn down after execution.
 */
function withWorkflowFixtures(base: TestAPI) {
  return (
    base
      // oxlint-disable-next-line no-empty-pattern -- Vitest inspects parameter destructuring names in the function signature to resolve fixture dependencies. `{}` must be kept even when unused.
      .extend("registry", async ({}, { onCleanup }) => {
        const registry = await createMockRegistry();
        onCleanup(async () => {
          await registry.close();
        });

        return registry;
      })
      /**
       * Requires `registry` because repository initialization publishes the
       * initial package version.
       */
      .extend("consumer", async ({ registry }, { onCleanup }) => {
        const consumer = await createMockGitRepo({ registry });
        onCleanup(() => {
          consumer.cleanup();
        });

        return consumer;
      })
      // oxlint-disable-next-line no-empty-pattern -- Vitest fixture dependency resolution requires `{}` in the signature.
      .extend("github", async ({}, { onCleanup }) => {
        const github = await createMockGitHubServer();
        onCleanup(async () => {
          await github.close();
        });

        return github;
      })
      /**
       * Returns a runner factory because `ActRunner` instances cannot be reused
       * across runs.
       */
      .extend("act", ({ consumer, github, registry }) => () => {
        /**
         * Configures act with environment variables, secrets, variables, and
         * flags routing requests to the mock GitHub server and registry (see
         * `actrc.ts`).
         */
        const runner = new ActRunner()
          .withEnv(
            getEnv({
              remoteDir: consumer.remoteDir,
              githubApiPort: github.port,
              registryPort: registry.port,
            }),
          )
          .withSecrets(getSecrets())
          .withVariables(getVariables())
          .withAdditionalArgs(
            ...getAdditionalArgs({
              localRepoDir: consumer.localRepoDir,
              remoteDir: consumer.remoteDir,
              npmrcFile: registry.npmrcFile,
              /** Staged once globally before all tests (see `global-setup.ts`). */
              localRepositories: inject("localRepositories"),
            }),
          );

        /**
         * By default, act output is captured in the test result. Setting
         * `ACT_TESTS_VERBOSE=1` streams container logs directly to stdout
         * during execution.
         */
        return process.env["ACT_TESTS_VERBOSE"] === undefined
          ? runner
          : runner.forwardOutput();
      })
  );
}

export { assertStatus, getStep, withWorkflowFixtures };
