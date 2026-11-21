import { ActExecStatus } from "act-test-runner";
import { describe, expect, it as base } from "vitest";

import type { Registry } from "./scripts/exec.ts";

import { assertStatus, getStep, withWorkflowFixtures } from "./context.ts";
import {
  CONSUMER_PACKAGE,
  CONSUMER_PACKAGE_DIR,
  MAIN_BRANCH_NAME,
  RELEASE_BRANCH_NAME,
} from "./scripts/actrc.ts";
import {
  addChangeIntent,
  applyChangeIntents,
  mergeBranch,
} from "./scripts/change-intents.ts";
import { createMockPush } from "./scripts/create-mock-push.ts";
import { editManifest, failScript } from "./scripts/edit-manifest.ts";
import { git } from "./scripts/exec.ts";
import { getReleaseWorkflow } from "./workflows.ts";

const it = withWorkflowFixtures(base);

/**
 * Builds and merges the release PR, leaving only the merge commit unpushed.
 *
 * @param options The options.
 * @param options.repo Path of the consumer repository.
 * @param options.registry The mock npm registry.
 * @param options.summary Summary of the change intent.
 * @returns The push event of the change intent the release PR consumed.
 */
async function prepareReleaseMerge({
  repo,
  registry,
  summary,
}: {
  repo: string;
  registry: Registry;
  summary: string;
}) {
  await addChangeIntent({
    repo,
    registry,
    branch: MAIN_BRANCH_NAME,
    bump: "minor",
    summary,
  });
  const intentEvent = createMockPush({ repo });
  await applyChangeIntents({ repo, registry, branch: RELEASE_BRANCH_NAME });
  mergeBranch({ repo, branch: RELEASE_BRANCH_NAME });
  /** The next release PR should be recreated from the new `main`. */
  git(repo, ["branch", "-D", RELEASE_BRANCH_NAME]);

  return intentEvent;
}

/**
 * Release recovery scenarios: queued pushes, reruns, and publish failures.
 *
 * Act ignores concurrency groups, so these tests assert repository/npm/GitHub
 * state rather than queue behavior.
 *
 * Important pnpm behavior: staged versions are not public, so `pnpm version -r`
 * keeps the current version until approval.
 */
describe("release.yml recovery", () => {
  it(
    "won't build the next release PR before the merged release ran, and builds it and releases the version once that's re-run and approved",
    {
      /** Four workflow runs take longer than the default timeout. */
      timeout: 600_000,
    },
    async ({ act, consumer, github, registry, signal }) => {
      const repo = consumer.localRepoDir;
      /** 1.1.0 is merged, but its workflow run has not released it yet. */
      await prepareReleaseMerge({ repo, registry, summary: "Add a feature." });
      const mergeEvent = createMockPush({ repo });
      await addChangeIntent({
        repo,
        registry,
        branch: MAIN_BRANCH_NAME,
        bump: "patch",
        summary: "Fix a bug.",
      });
      const intentEvent = createMockPush({ repo });

      const prResult = await act()
        .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
        .withEvent("push", intentEvent)
        .run({ signal });

      assertStatus(prResult, ActExecStatus.FAILED);
      expect(
        getStep(prResult, "release-pr", "Open or update release PR").output,
      ).toContain(`${CONSUMER_PACKAGE}@1.1.0 isn't on npm yet`);
      expect({ pulls: github.pulls, releases: github.releases }).toStrictEqual({
        pulls: [],
        releases: [],
      });

      /** Rerun the merge event from its original SHA, before the later fix. */
      git(repo, ["reset", "--hard", mergeEvent.after]);
      const releaseResult = await act()
        .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
        .withEvent("push", mergeEvent)
        .run({ signal });

      assertStatus(releaseResult, ActExecStatus.SUCCESS);
      expect({
        staged: await registry.getStagedVersions(),
        releases: github.releases,
      }).toStrictEqual({
        staged: [`${CONSUMER_PACKAGE}@1.1.0`],
        releases: [],
      });

      /** Staged is not enough; the version must be public on npm. */
      git(repo, ["reset", "--hard", intentEvent.after]);
      const stagedResult = await act()
        .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
        .withEvent("push", intentEvent)
        .run({ signal });

      assertStatus(stagedResult, ActExecStatus.FAILED);
      expect({ pulls: github.pulls, releases: github.releases }).toStrictEqual({
        pulls: [],
        releases: [],
      });

      /**
       * After approval, the next run can both release 1.1.0 and build the next
       * release PR.
       */
      await registry.approve(`${CONSUMER_PACKAGE}@1.1.0`);
      const approvedResult = await act()
        .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
        .withEvent("push", intentEvent)
        .run({ signal });

      assertStatus(approvedResult, ActExecStatus.SUCCESS);
      expect({
        pulls: github.pulls.map(({ title, body }) => ({ title, body })),
        releases: github.releases.map(({ tag_name: tag, body }) => ({
          tag,
          body,
        })),
      }).toStrictEqual({
        pulls: [
          {
            title: "chore: release acme-lib@1.1.1",
            body: expect.stringContaining("- `acme-lib`: 1.1.0 → 1.1.1"),
          },
        ],
        releases: [
          { tag: "v1.1.0", body: "### Minor Changes\n\n- Add a feature." },
        ],
      });
    },
  );

  it("stages the release commit after main moved on past it", async ({
    act,
    consumer,
    registry,
    signal,
  }) => {
    const repo = consumer.localRepoDir;
    await prepareReleaseMerge({ repo, registry, summary: "Add a feature." });
    const event = createMockPush({ repo });

    /**
     * Simulate `main` moving after this run starts; the publish job should keep
     * using the run's original `github.sha`.
     */
    git(repo, ["commit", "--allow-empty", "-m", "docs: fix a typo"]);
    git(repo, ["push", "origin", MAIN_BRANCH_NAME]);
    git(repo, ["reset", "--hard", event.after]);

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
      .withEvent("push", event)
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    await expect(registry.getStagedVersions()).resolves.toStrictEqual([
      `${CONSUMER_PACKAGE}@1.1.0`,
    ]);
  });

  it("doesn't reopen a merged release PR from a push that waited in the queue", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    const repo = consumer.localRepoDir;
    const intentEvent = await prepareReleaseMerge({
      repo,
      registry,
      summary: "Add a feature.",
    });
    createMockPush({ repo });

    /**
     * The intent push's run starts only after the release PR merged. Its own
     * commit still has the consumed intent, so `plan` picks `pr`.
     */
    git(repo, ["reset", "--hard", intentEvent.after]);

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow() })
      .withEvent("push", intentEvent)
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    expect(
      getStep(result, "release-pr", "Open or update release PR").output,
    ).toContain(
      "No packages need to be released. Skipping release PR creation.",
    );
    expect(github.pulls).toStrictEqual([]);
    expect(git(consumer.remoteRepoDir, ["branch", "--list"])).toBe(
      `* ${MAIN_BRANCH_NAME}`,
    );
  });

  it("neither stages nor releases when CI fails on the release commit", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    const repo = consumer.localRepoDir;
    editManifest({ repo, dir: "", edit: failScript("test") });
    await prepareReleaseMerge({ repo, registry, summary: "Add a feature." });

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.FAILED);
    expect({
      staged: await registry.getStagedVersions(),
      releases: github.releases,
    }).toStrictEqual({ staged: [], releases: [] });
  });

  it("doesn't release when the publish job fails", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    const repo = consumer.localRepoDir;
    /** Package builds happen only in the publish job; CI runs root scripts. */
    editManifest({
      repo,
      dir: CONSUMER_PACKAGE_DIR,
      edit: failScript("build"),
    });
    await prepareReleaseMerge({ repo, registry, summary: "Add a feature." });

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.FAILED);
    expect(getStep(result, "check", "Test").status).toBe(ActExecStatus.SUCCESS);
    expect({
      staged: await registry.getStagedVersions(),
      releases: github.releases,
    }).toStrictEqual({ staged: [], releases: [] });
  });
});
