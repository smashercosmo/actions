import { ActExecStatus } from "act-test-runner";
import fs from "node:fs";
import { describe, expect, it as base } from "vitest";

import { assertStatus, getStep, withWorkflowFixtures } from "./context.ts";
import {
  FEATURE_BRANCH_NAME,
  MAIN_BRANCH_NAME,
  RELEASE_BRANCH_NAME,
} from "./scripts/actrc.ts";
import {
  addChangeIntent,
  applyChangeIntents,
  mergeBranch,
} from "./scripts/change-intents.ts";
import { createMockPullRequest } from "./scripts/create-mock-pull-request.ts";
import { createMockPush } from "./scripts/create-mock-push.ts";
import { git } from "./scripts/exec.ts";
import { CI_WORKFLOW } from "./workflows.ts";

/**
 * Each test gets isolated workflow fixtures and an act runner tied to Vitest's
 * abort signal.
 */
const it = withWorkflowFixtures(base);

/**
 * Reusable CI workflow scenarios: change-intent enforcement plus the standard
 * workspace check job.
 */
describe("ci.yml", () => {
  it("should fail a pull request that doesn't add a change intent", async ({
    act,
    consumer,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
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
     * Change-intent validation is isolated to the `changeset` job; ordinary
     * checks should still pass.
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
    /** Mock scripts echo their names, giving the test an execution-order check. */
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
     * A release PR applies intents and updates the ledger, so it does not need
     * to add a fresh intent.
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
     * A later intent on `main` means this release PR is stale and must wait for
     * the release workflow to rebuild it.
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
    /** Act omits skipped jobs from `result.jobs`. */
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
    git(repo, ["commit", "--allow-empty", "-m", "feat: add a feature"]);

    const result = await act()
      .withWorkflow({ body: CI_WORKFLOW })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
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
     * Make the build rewrite a committed file so the clean-tree check can catch
     * stale build output.
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
    expect(step.output).toContain(" M built.txt");
  });
});
