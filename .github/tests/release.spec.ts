import { ActExecStatus } from "act-test-runner";
import { describe, expect, it as base, vi } from "vitest";

import { assertStatus, getStep, withWorkflowFixtures } from "./context.ts";
import {
  CONSUMER_PACKAGE,
  CONSUMER_PACKAGE_DIR,
  CONSUMER_REPO,
  GITHUB_TOKEN,
  INSTALLATION_TOKEN,
  MAIN_BRANCH_NAME,
  RELEASE_BOT_SLUG,
  RELEASE_BOT_USER_ID,
  RELEASE_BRANCH_NAME,
} from "./scripts/actrc.ts";
import {
  addChangeIntent,
  applyChangeIntents,
  mergeBranch,
} from "./scripts/change-intents.ts";
import { createMockPush } from "./scripts/create-mock-push.ts";
import { editManifest } from "./scripts/edit-manifest.ts";
import { git } from "./scripts/exec.ts";
import { getReleaseWorkflow } from "./workflows.ts";

/** The fixture starts at 1.0.0; a minor version bump targets 1.1.0. */
const RELEASE_PR_TITLE = "chore: release acme-lib@1.1.0";

/**
 * Each test gets isolated workflow fixtures and an act runner tied to Vitest's
 * abort signal.
 */
const it = withWorkflowFixtures(base);

/**
 * Main release workflow scenarios: opening release PRs, publishing after merge,
 * npm staging, and no-op pushes.
 */
describe("release.yml", () => {
  it("should open the release pull request when change intents are pending", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    await addChangeIntent({
      repo,
      registry,
      branch: MAIN_BRANCH_NAME,
      bump: "minor",
      summary: "Add a feature.",
    });

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow() })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);

    /**
     * The release PR path should request only the permissions it needs and
     * revoke the installation token in the post step.
     */
    expect({
      tokenRequests: github.tokenRequests,
      revokedTokens: github.revokedTokens,
    }).toStrictEqual({
      tokenRequests: [
        {
          repositories: [CONSUMER_REPO],
          permissions: { contents: "write", pull_requests: "write" },
        },
      ],
      revokedTokens: [INSTALLATION_TOKEN],
    });

    /**
     * The remote release branch should contain one bot-authored release commit
     * with the intent applied.
     */
    const remote = consumer.remoteRepoDir;
    const bot = `${RELEASE_BOT_SLUG}[bot]`;

    expect({
      parent: git(remote, ["rev-parse", `${RELEASE_BRANCH_NAME}^`]),
      commit: git(remote, [
        "log",
        "-1",
        "--format=%an <%ae> %s",
        RELEASE_BRANCH_NAME,
      ]),
      version: git(remote, [
        "show",
        `${RELEASE_BRANCH_NAME}:${CONSUMER_PACKAGE_DIR}/package.json`,
      ]),
      changelog: git(remote, [
        "show",
        `${RELEASE_BRANCH_NAME}:${CONSUMER_PACKAGE_DIR}/CHANGELOG.md`,
      ]),
      intents: git(remote, [
        "ls-tree",
        "--name-only",
        RELEASE_BRANCH_NAME,
        ".changeset/",
      ]),
    }).toStrictEqual({
      parent: git(remote, ["rev-parse", MAIN_BRANCH_NAME]),
      commit: `${bot} <${RELEASE_BOT_USER_ID}+${bot}@users.noreply.github.com> ${RELEASE_PR_TITLE}`,
      version: expect.stringContaining(`"version": "1.1.0"`),
      changelog: expect.stringContaining("## 1.1.0"),
      intents: ".changeset/ledger.yaml",
    });

    expect(github.pulls).toStrictEqual([
      {
        number: 1,
        title: RELEASE_PR_TITLE,
        body: expect.stringContaining("- `acme-lib`: 1.0.0 → 1.1.0"),
        head: RELEASE_BRANCH_NAME,
        base: MAIN_BRANCH_NAME,
      },
    ]);
    /** No new GitHub release is created until the release PR merges. */
    expect(github.releases).toStrictEqual([]);
  });

  it("should update the release pull request when it's open already", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    await addChangeIntent({
      repo,
      registry,
      branch: MAIN_BRANCH_NAME,
      bump: "minor",
      summary: "Add a feature.",
    });
    /**
     * Preload an older release PR and its branch to verify the action updates
     * both in place.
     */
    github.pulls.push({
      number: 1,
      title: "chore: release acme-lib@1.0.1",
      body: "The release PR of an earlier push",
      head: RELEASE_BRANCH_NAME,
      base: MAIN_BRANCH_NAME,
    });
    git(repo, ["switch", "-c", RELEASE_BRANCH_NAME]);
    git(repo, [
      "commit",
      "--allow-empty",
      "-m",
      "chore: release acme-lib@1.0.1",
    ]);
    git(repo, ["push", "origin", RELEASE_BRANCH_NAME]);
    git(repo, ["switch", MAIN_BRANCH_NAME]);

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow() })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);

    /** The old release commit is replaced, not built upon. */
    const remote = consumer.remoteRepoDir;

    expect({
      parent: git(remote, ["rev-parse", `${RELEASE_BRANCH_NAME}^`]),
      subject: git(remote, ["log", "-1", "--format=%s", RELEASE_BRANCH_NAME]),
    }).toStrictEqual({
      parent: git(remote, ["rev-parse", MAIN_BRANCH_NAME]),
      subject: RELEASE_PR_TITLE,
    });
    expect(github.pulls).toStrictEqual([
      {
        number: 1,
        title: RELEASE_PR_TITLE,
        body: expect.stringContaining("- `acme-lib`: 1.0.0 → 1.1.0"),
        head: RELEASE_BRANCH_NAME,
        base: MAIN_BRANCH_NAME,
      },
    ]);
  });

  it("should not open a pull request when the change intents decline a release", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    /** `--bump none` records the change but produces an empty release plan. */
    await addChangeIntent({
      repo,
      registry,
      branch: MAIN_BRANCH_NAME,
      bump: "none",
      summary: "Fix a typo in the docs.",
    });

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow() })
      .withEvent("push", createMockPush({ repo }))
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

  it("should publish a GitHub release when the release pull request is merged", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    await addChangeIntent({
      repo,
      registry,
      branch: MAIN_BRANCH_NAME,
      bump: "minor",
      summary: "Add a feature.",
    });
    /** Push the intent first so the later release merge matches remote history. */
    createMockPush({ repo });

    /**
     * The release merge changes the ledger, which is how the workflow detects
     * that publishing should run.
     */
    const releaseCommit = await applyChangeIntents({
      repo,
      registry,
      branch: RELEASE_BRANCH_NAME,
    });
    mergeBranch({ repo, branch: RELEASE_BRANCH_NAME });

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow() })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    expect(github.releases).toStrictEqual([
      {
        tag_name: "v1.1.0",
        /** Tags should point at the version-bump commit, not the merge commit. */
        target_commitish: releaseCommit,
        name: "v1.1.0",
        body: expect.stringContaining("Add a feature."),
      },
    ]);
    /**
     * Publishing releases uses `github.token`, not the GitHub App token used
     * for release PRs.
     */
    expect(github.pulls).toStrictEqual([]);
    expect(github.tokenRequests).toStrictEqual([]);
    expect(github.requests.map(({ token }) => token)).toStrictEqual(
      github.requests.map(() => GITHUB_TOKEN),
    );
  });

  it("should stage the package on npm and not publish its GitHub release before it's approved, with `npm`", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    await addChangeIntent({
      repo,
      registry,
      branch: MAIN_BRANCH_NAME,
      bump: "minor",
      summary: "Add a feature.",
    });
    createMockPush({ repo });
    await applyChangeIntents({ repo, registry, branch: RELEASE_BRANCH_NAME });
    mergeBranch({ repo, branch: RELEASE_BRANCH_NAME });

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    /** With `npm: true`, CI is rerun on the exact release commit before publish. */
    expect(getStep(result, "check", "Test").output).toContain("consumer: test");
    /** Staged versions are not public yet, so the GitHub release waits. */
    await expect(registry.getStagedVersions()).resolves.toStrictEqual([
      `${CONSUMER_PACKAGE}@1.1.0`,
    ]);
    await expect(registry.getVersions(CONSUMER_PACKAGE)).resolves.toStrictEqual(
      ["1.0.0"],
    );
    expect(github.releases).toStrictEqual([]);
    expect(
      getStep(result, "release", "Create GitHub releases").output,
    ).toContain(`${CONSUMER_PACKAGE}@1.1.0 isn't on npm yet`);
  });

  it("should publish the GitHub release once the staged version is approved while the run waits, with `npm`", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    await addChangeIntent({
      repo,
      registry,
      branch: MAIN_BRANCH_NAME,
      bump: "minor",
      summary: "Add a feature.",
    });
    createMockPush({ repo });
    await applyChangeIntents({ repo, registry, branch: RELEASE_BRANCH_NAME });
    mergeBranch({ repo, branch: RELEASE_BRANCH_NAME });

    const run = act()
      .withWorkflow({
        body: getReleaseWorkflow({ npm: true, npmApprovalTimeout: 2 }),
      })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    /**
     * Approve after the release job has observed that npm does not have the
     * version yet.
     */
    await vi.waitFor(
      async () => {
        await expect(registry.getStagedVersions()).resolves.toStrictEqual([
          `${CONSUMER_PACKAGE}@1.1.0`,
        ]);
      },
      { timeout: 240_000, interval: 500 },
    );
    await registry.waitForPackumentRequest(CONSUMER_PACKAGE);
    await registry.approve(`${CONSUMER_PACKAGE}@1.1.0`);

    const result = await run;

    assertStatus(result, ActExecStatus.SUCCESS);
    expect(
      getStep(result, "release", "Create GitHub releases").output,
    ).toContain(
      `${CONSUMER_PACKAGE}@1.1.0 isn't on npm yet, checking again in 30 seconds`,
    );
    expect(github.releases).toMatchObject([{ tag_name: "v1.1.0" }]);
  });

  it("should do nothing on a push without change intents or a release", async ({
    act,
    consumer,
    github,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    git(repo, ["commit", "--allow-empty", "-m", "docs: fix a typo"]);

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow() })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    /** The release job still runs, but the existing v1.0.0 tag makes it a no-op. */
    expect(
      getStep(result, "release", "Create GitHub releases").output,
    ).toContain("Release v1.0.0 already exists, skipping");
    expect(github.requests).toStrictEqual([]);
  });

  it("should publish the GitHub release of a private package right away, with `npm` and `includePrivate`", async ({
    act,
    consumer,
    github,
    registry,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    /** Private packages are tagged on GitHub but never waited for on npm. */
    editManifest({
      repo,
      dir: CONSUMER_PACKAGE_DIR,
      edit: (manifest) => ({ ...manifest, private: true }),
    });
    await addChangeIntent({
      repo,
      registry,
      branch: MAIN_BRANCH_NAME,
      bump: "minor",
      summary: "Add a feature.",
    });
    createMockPush({ repo });
    await applyChangeIntents({ repo, registry, branch: RELEASE_BRANCH_NAME });
    mergeBranch({ repo, branch: RELEASE_BRANCH_NAME });

    const result = await act()
      .withWorkflow({
        body: getReleaseWorkflow({ npm: true, includePrivate: true }),
      })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    await expect(registry.getStagedVersions()).resolves.toStrictEqual([]);
    expect(github.releases).toMatchObject([{ tag_name: "v1.1.0" }]);
  });
});
