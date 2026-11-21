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
} from "./scripts/actrc.ts";
import { createMockGitRepo } from "./scripts/create-mock-git-repo.ts";
import { createMockGitHubServer } from "./scripts/create-mock-github-server.ts";
import { createMockRegistry } from "./scripts/create-mock-registry.ts";

/** Status values that mean an act step phase actually ran. */
const STATUSES = new Set<string>(Object.values(ActExecStatus));

/**
 * Act-test-runner records `pre`, `main`, and `post` phases; phases that did not
 * execute have no valid status.
 *
 * @param step Result of a step phase.
 * @returns Whether the phase ran.
 */
function hasRun(step: ActStepExecResult) {
  return STATUSES.has(step.status);
}

/**
 * Summary included in assertion errors so failed workflow tests show the jobs,
 * steps, and failed step output.
 *
 * @param result Result of the workflow run.
 * @returns The summary, one line per job and step.
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

  /** Include act's own output when it fails before scheduling jobs. */
  if (jobs.length === 0) {
    lines.push(result.output);
  }

  return lines.join("\n");
}

/**
 * Finds a step result and includes the full workflow summary when it is
 * missing.
 *
 * @param result Result of the workflow run.
 * @param job ID of the job.
 * @param name Name of the step.
 * @returns The result of the step.
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
 * Assert the workflow result with the run summary attached on failure.
 *
 * @param result Result of the workflow run.
 * @param expected Status the run should have.
 */
function assertStatus(result: ActWorkflowExecResult, expected: ActExecStatus) {
  if (result.status !== expected) {
    throw new Error(
      `Expected the workflow run to have the status ${expected}\n${describeRun(result)}`,
    );
  }
}

/**
 * Extends Vitest's `it` with isolated workflow fixtures:
 *
 * - `registry`: Local Verdaccio npm registry instance for package publishing and
 *   staging.
 * - `consumer`: Local git repository initialized from `fixtures/consumer`, with a
 *   bare remote.
 * - `github`: Mock GitHub REST API server for pull requests, releases, and token
 *   management.
 * - `act`: factory for a fresh `ActRunner` wired to the mock services.
 *
 * Fixtures are isolated per test and automatically torn down after execution.
 *
 * @param base The `it` to extend.
 * @returns The `it` with the fixtures.
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
       * Repository setup publishes the initial package, so it needs the mock
       * registry first.
       */
      .extend("consumer", async ({ registry }, { onCleanup }) => {
        const consumer = await createMockGitRepo({ registry });
        onCleanup(() => {
          consumer.cleanup();
        });

        return consumer;
      })
      /** GitHub releases create tags in the consumer's remote repository. */
      .extend("github", async ({ consumer }, { onCleanup }) => {
        const github = await createMockGitHubServer({
          remoteRepoDir: consumer.remoteRepoDir,
        });
        onCleanup(async () => {
          await github.close();
        });

        return github;
      })
      /** `ActRunner` instances are single-use, so expose a factory. */
      .extend("act", ({ consumer, github, registry }) => () => {
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
