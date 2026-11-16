import { ActExecStatus } from "act-test-runner";
import { describe, expect, it as base } from "vitest";

import type { Registry } from "./scripts/exec";

import { assertStatus, getStep, withWorkflowFixtures } from "./context";
import {
  CONSUMER_PACKAGE,
  CONSUMER_PACKAGE_DIR,
  MAIN_BRANCH_NAME,
  RELEASE_BRANCH_NAME,
} from "./scripts/actrc";
import {
  addChangeIntent,
  applyChangeIntents,
  mergeBranch,
} from "./scripts/change-intents";
import { createMockPush } from "./scripts/create-mock-push";
import { editManifest, failScript } from "./scripts/edit-manifest";
import { git } from "./scripts/exec";
import { getReleaseWorkflow } from "./workflows";

const it = withWorkflowFixtures(base);

/**
 * Builds a release PR from the pending change intents on `main` and merges it,
 * like a maintainer merging the PR the release bot opened. Every commit before
 * the merge is pushed already, so the merge is the only one left to push
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
  createMockPush({ repo });
  await applyChangeIntents({ repo, registry, branch: RELEASE_BRANCH_NAME });
  mergeBranch({ repo, branch: RELEASE_BRANCH_NAME });
  /** The next release PR starts from the new `main` */
  git(repo, ["branch", "-D", RELEASE_BRANCH_NAME]);
}

/**
 * Edge cases of the release path of release.yml: pushes that land before a
 * merged release is finished, retries, and failures. Each test puts the
 * repository into the state it's about, runs the workflow, and checks the
 * resulting release state (npm staging area, GitHub releases, PRs), not only
 * the status of the run.
 *
 * They record the current behavior, including the gaps, which the comments
 * point out. Concurrency groups aren't covered: act ignores them, see the
 * experiments in the sandbox repository instead. Neither is a release PR merged
 * while change intents are pending: the ruleset of the main branch prevents
 * that merge, see the README.
 *
 * Two pnpm behaviors explain most results. `pnpm version -r` checks the
 * registry: while the current version of a public package isn't published (a
 * staged version doesn't count), the next release keeps that version and adds a
 * second section with the same heading to CHANGELOG.md. And `pnpm stage
 * publish` fails with 409 for a version that's staged already
 */
describe("release.yml recovery", () => {
  it("won't build the next release PR before the merged release ran, and builds it once that's re-run and approved", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    const repo = consumer.localRepoDir;
    /** 1.1.0 is merged, but its workflow run never released it */
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
    expect(github.pulls).toStrictEqual([]);

    /**
     * Re-runs the run of the merge, which releases its own commit, without the
     * fix. act takes that commit from the local checkout
     */
    git(repo, ["reset", "--hard", mergeEvent.after]);
    const releaseResult = await act()
      .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
      .withEvent("push", mergeEvent)
      .run({ signal });

    assertStatus(releaseResult, ActExecStatus.SUCCESS);
    expect({
      staged: await registry.getStagedVersions(),
      releases: github.releases.map(({ tag_name: tag, body }) => ({
        tag,
        body,
      })),
    }).toStrictEqual({
      staged: [`${CONSUMER_PACKAGE}@1.1.0`],
      releases: [
        { tag: "v1.1.0", body: "### Minor Changes\n\n- Add a feature." },
      ],
    });

    /** Staged isn't enough, the version has to be on npm */
    git(repo, ["reset", "--hard", intentEvent.after]);
    const stagedResult = await act()
      .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
      .withEvent("push", intentEvent)
      .run({ signal });

    assertStatus(stagedResult, ActExecStatus.FAILED);
    expect(github.pulls).toStrictEqual([]);

    await registry.approve(`${CONSUMER_PACKAGE}@1.1.0`);
    const approvedResult = await act()
      .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
      .withEvent("push", intentEvent)
      .run({ signal });

    assertStatus(approvedResult, ActExecStatus.SUCCESS);
    expect(
      github.pulls.map(({ title, body }) => ({ title, body })),
    ).toStrictEqual([
      {
        title: "chore: release acme-lib@1.1.1",
        body: expect.stringContaining("- `acme-lib`: 1.1.0 → 1.1.1"),
      },
    ]);
  });

  it("can't retry a release whose draft is missing while its version waits for approval", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    const repo = consumer.localRepoDir;
    await prepareReleaseMerge({ repo, registry, summary: "Add a feature." });

    const pushResult = await act()
      .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(pushResult, ActExecStatus.SUCCESS);
    /** As if the release job had failed after the version was staged */
    github.releases.splice(0);

    const retryResult = await act()
      .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
      .withEvent("workflow_dispatch", {})
      .run({ signal });

    /**
     * Gap: the retry fails at staging, so it never gets to the draft. It works
     * again once the version is approved, as pnpm skips published versions
     */
    assertStatus(retryResult, ActExecStatus.FAILED);
    expect(
      getStep(retryResult, "publish", "Stage packages on npm").output,
    ).toContain(`${CONSUMER_PACKAGE}@1.1.0 is already staged`);
    expect(github.releases).toStrictEqual([]);
  });

  it("stages the release commit after main moved on past it", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    const repo = consumer.localRepoDir;
    await prepareReleaseMerge({ repo, registry, summary: "Add a feature." });
    const event = createMockPush({ repo });

    /**
     * Another push lands on `main` while the release run is on its way to the
     * publish job. The run keeps its own commit (`github.sha`), which act takes
     * from the local checkout, so the local branch goes back to the release
     * merge
     */
    git(repo, ["commit", "--allow-empty", "-m", "docs: fix a typo"]);
    git(repo, ["push", "origin", MAIN_BRANCH_NAME]);
    git(repo, ["reset", "--hard", event.after]);

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
      .withEvent("push", event)
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    expect({
      staged: await registry.getStagedVersions(),
      releases: github.releases.map(({ tag_name: tag }) => tag),
    }).toStrictEqual({
      staged: [`${CONSUMER_PACKAGE}@1.1.0`],
      releases: ["v1.1.0"],
    });
  });

  it("neither stages nor drafts when CI fails on the release commit", async ({
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

  it("doesn't draft when the publish job fails", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    const repo = consumer.localRepoDir;
    /** Only the publish job builds the packages, CI runs the root scripts */
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
