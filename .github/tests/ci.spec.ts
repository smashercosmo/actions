import { ActExecStatus } from "act-test-runner";
import fs from "node:fs";
import { describe, expect, it as base } from "vitest";

import { assertStatus, getStep, withWorkflowFixtures } from "./context";
import {
  FEATURE_BRANCH_NAME,
  MAIN_BRANCH_NAME,
  RELEASE_BRANCH_NAME,
} from "./scripts/actrc";
import {
  addChangeIntent,
  applyChangeIntents,
  mergeBranch,
} from "./scripts/change-intents";
import { createMockPullRequest } from "./scripts/create-mock-pull-request";
import { createMockPush } from "./scripts/create-mock-push";
import { git } from "./scripts/exec";
import { CI_WORKFLOW } from "./workflows";

/**
 * Test runner instance equipped with isolated workflow fixtures (`context.ts`).
 * Each test receives a dedicated mock consumer repository, GitHub API server,
 * npm registry, and an `act` runner. Vitest's `signal` aborts act executions on
 * test timeout.
 */
const it = withWorkflowFixtures(base);

/**
 * Tests for the reusable CI workflow (`.github/workflows/ci.yml`).
 *
 * The workflow consists of two jobs:
 *
 * - `changeset`: Enforces that pull requests include a change intent (`pnpm
 *   change`). Runs only on pull requests, skipping direct pushes and Dependabot
 *   PRs.
 * - `check`: Executes standard consumer workspace checks (`pnpm build`, `pnpm
 *   lint`, `pnpm format --check`, `pnpm test`).
 *
 * Each test sets up git state in the mock consumer repository, triggers the
 * workflow with act using simulated GitHub events (pull request or push), and
 * validates job statuses and step outputs.
 */
describe("ci.yml", () => {
  it("should fail a pull request that doesn't add a change intent", async ({
    act,
    consumer,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    /** Creates a feature branch with a commit but no change intent. */
    git(repo, ["switch", "-c", FEATURE_BRANCH_NAME]);
    git(repo, ["commit", "--allow-empty", "-m", "feat: add a feature"]);

    const result = await act()
      .withWorkflow({ body: CI_WORKFLOW })
      .withEvent(
        "pull_request",
        createMockPullRequest({
          repo,
          branch: FEATURE_BRANCH_NAME,
          number: 10,
        }),
      )
      .run({ signal });

    const step = getStep(result, "changeset", "Require a change intent");

    assertStatus(result, ActExecStatus.FAILED);
    expect(step.status).toBe(ActExecStatus.FAILED);
    expect(step.output).toContain(
      "This pull request doesn't add a change intent.",
    );
    /**
     * Verifies `check` still succeeds: change intent validation is isolated to
     * `changeset`.
     */
    expect(result.jobs["check"]?.status).toBe(ActExecStatus.SUCCESS);
  });

  it("should pass a pull request that adds a change intent", async ({
    act,
    consumer,
    registry,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    await addChangeIntent({
      repo,
      registry,
      branch: FEATURE_BRANCH_NAME,
      bump: "minor",
      summary: "Add a feature.",
    });

    const result = await act()
      .withWorkflow({ body: CI_WORKFLOW })
      .withEvent(
        "pull_request",
        createMockPullRequest({
          repo,
          branch: FEATURE_BRANCH_NAME,
          number: 10,
        }),
      )
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    expect(
      getStep(result, "changeset", "Require a change intent").output,
    ).toContain("Change intents added:");
    /**
     * Verifies that workspace verification scripts ran in the expected order
     * (the mock scripts echo their names so tests can confirm execution).
     */
    expect(
      ["Build", "Lint and type-check", "Check formatting", "Test"].map(
        (name) => getStep(result, "check", name).output,
      ),
    ).toStrictEqual([
      expect.stringContaining("consumer: build"),
      expect.stringContaining("consumer: lint"),
      expect.stringContaining("consumer: format --check"),
      expect.stringContaining("consumer: test"),
    ]);
  });

  it("should pass the release pull request without a change intent", async ({
    act,
    consumer,
    registry,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    /**
     * Simulates a release PR: a feature with a change intent was merged into
     * `main`, and the release branch applied the intent (deleting the intent
     * file and updating `.changeset/ledger.yaml`). The modified ledger
     * indicates no new intent is required.
     */
    await addChangeIntent({
      repo,
      registry,
      branch: FEATURE_BRANCH_NAME,
      bump: "minor",
      summary: "Add a feature.",
    });
    mergeBranch({ repo, branch: FEATURE_BRANCH_NAME });
    await applyChangeIntents({
      repo,
      registry,
      branch: RELEASE_BRANCH_NAME,
    });

    const result = await act()
      .withWorkflow({ body: CI_WORKFLOW })
      .withEvent(
        "pull_request",
        createMockPullRequest({
          repo,
          branch: RELEASE_BRANCH_NAME,
          number: 11,
        }),
      )
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    expect(
      getStep(result, "changeset", "Require a change intent").output,
    ).toContain("Release PR, no change intent needed");
  });

  it("should fail the release pull request while the base branch has change intents it doesn't apply", async ({
    act,
    consumer,
    registry,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    await addChangeIntent({
      repo,
      registry,
      branch: FEATURE_BRANCH_NAME,
      bump: "minor",
      summary: "Add a feature.",
    });
    mergeBranch({ repo, branch: FEATURE_BRANCH_NAME });
    await applyChangeIntents({
      repo,
      registry,
      branch: RELEASE_BRANCH_NAME,
    });
    /**
     * A fix with its own intent lands on `main` after the release PR was built,
     * so the merge commit of the release PR has that intent pending
     */
    await addChangeIntent({
      repo,
      registry,
      branch: MAIN_BRANCH_NAME,
      bump: "patch",
      summary: "Fix a bug.",
    });

    const result = await act()
      .withWorkflow({ body: CI_WORKFLOW })
      .withEvent(
        "pull_request",
        createMockPullRequest({
          repo,
          branch: RELEASE_BRANCH_NAME,
          number: 11,
        }),
      )
      .run({ signal });

    const step = getStep(result, "changeset", "Require a change intent");

    assertStatus(result, ActExecStatus.FAILED);
    expect(step.status).toBe(ActExecStatus.FAILED);
    expect(step.output).toContain(
      "The base branch has change intents this release PR doesn't apply yet",
    );
    expect(result.jobs["check"]?.status).toBe(ActExecStatus.SUCCESS);
  });

  it("should not require a change intent from Dependabot", async ({
    act,
    consumer,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    /** Identical PR branch to the first test, but authored by Dependabot. */
    git(repo, ["switch", "-c", FEATURE_BRANCH_NAME]);
    git(repo, ["commit", "--allow-empty", "-m", "chore: bump an action"]);

    const result = await act()
      .withWorkflow({ body: CI_WORKFLOW })
      .withEvent(
        "pull_request",
        createMockPullRequest({
          repo,
          branch: FEATURE_BRANCH_NAME,
          number: 12,
          author: "dependabot[bot]",
        }),
      )
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    /**
     * The `changeset` job was skipped (act omits skipped jobs from
     * `result.jobs`).
     */
    expect(result.jobs).not.toHaveProperty("changeset");
    expect(result.jobs["check"]?.status).toBe(ActExecStatus.SUCCESS);
  });

  it("should not require a change intent on a push", async ({
    act,
    consumer,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    /**
     * Direct commit on `main` without a change intent; `changeset` job is
     * skipped on push events.
     */
    git(repo, ["commit", "--allow-empty", "-m", "feat: add a feature"]);

    const result = await act()
      .withWorkflow({ body: CI_WORKFLOW })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    /** Skipped because push events do not require change intents. */
    expect(result.jobs).not.toHaveProperty("changeset");
    expect(result.jobs["check"]?.status).toBe(ActExecStatus.SUCCESS);
  });

  it("should fail when the build changes files that are committed", async ({
    act,
    consumer,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    /**
     * Simulates uncommitted build artifacts: modifying `package.json` so the
     * build writes new content to `built.txt`, conflicting with the committed
     * version.
     */
    const manifest = fs.readFileSync(`${repo}/package.json`, "utf8");
    fs.writeFileSync(
      `${repo}/package.json`,
      manifest.replace("echo 'consumer: build'", "echo 'new' > built.txt"),
    );
    fs.writeFileSync(`${repo}/built.txt`, "old\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "feat: add a feature"]);

    const result = await act()
      .withWorkflow({ body: CI_WORKFLOW })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    const step = getStep(
      result,
      "check",
      "Check that the build leaves no changes",
    );

    assertStatus(result, ActExecStatus.FAILED);
    expect(step.status).toBe(ActExecStatus.FAILED);
    expect(step.output).toContain("The build changed these files.");
    /** Verifies `git status --porcelain` detects the modified file. */
    expect(step.output).toContain(" M built.txt");
  });
});
