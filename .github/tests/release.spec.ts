import { ActExecStatus } from "act-test-runner";
import { describe, expect, it as base } from "vitest";

import { assertStatus, getStep, withWorkflowFixtures } from "./context";
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
} from "./scripts/actrc";
import {
  addChangeIntent,
  applyChangeIntents,
  mergeBranch,
} from "./scripts/change-intents";
import { createMockPush } from "./scripts/create-mock-push";
import { git } from "./scripts/exec";
import { getReleaseWorkflow } from "./workflows";

/**
 * In the fixture, the package starts at version 1.0.0. Adding a `minor` bump
 * change intent targets release version 1.1.0.
 */
const RELEASE_PR_TITLE = "chore: release acme-lib@1.1.0";

/**
 * Test runner instance equipped with isolated workflow fixtures (`context.ts`).
 * Each test receives a dedicated mock consumer repository, GitHub API server,
 * npm registry, and an `act` runner. Vitest's `signal` aborts act executions on
 * test timeout.
 */
const it = withWorkflowFixtures(base);

/**
 * Test suite for the reusable release workflow
 * (`.github/workflows/release.yml`).
 *
 * The workflow routes execution based on repository state:
 *
 * 1. Pending change intents exist (`.changeset/*.md`) -> Opens or updates an
 *    automated release PR.
 * 2. Release PR merged (`.changeset/ledger.yaml` modified) -> Stages packages on
 *    npm and drafts a GitHub release.
 * 3. No release changes -> Exits without performing actions.
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
     * Verifies that the GitHub App installation token was requested with
     * minimal required permissions (`contents: write`, `pull_requests: write`)
     * and revoked upon completion.
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
     * Verifies the release branch on the remote: contains a single commit by
     * the bot updating package.json and CHANGELOG.md, with the change intent
     * deleted and ledger updated.
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
    /**
     * Confirms GitHub releases are only drafted after the release PR is merged
     * into main.
     */
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
     * Pre-populates the mock server with an open release PR from an earlier
     * push to verify it gets updated in-place with the latest version bump and
     * changelog.
     */
    github.pulls.push({
      number: 1,
      title: "chore: release acme-lib@1.0.1",
      body: "The release PR of an earlier push",
      head: RELEASE_BRANCH_NAME,
      base: MAIN_BRANCH_NAME,
    });

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow() })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    /** Confirms the existing PR was updated rather than opening a duplicate PR. */
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
    /**
     * An intent with `--bump none` records changes without triggering a
     * release. The workflow detects that no packages require version bumps and
     * skips PR creation.
     */
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
    /** Confirms no release branch was pushed to the remote repository. */
    expect(git(consumer.remoteRepoDir, ["branch", "--list"])).toBe(
      `* ${MAIN_BRANCH_NAME}`,
    );
  });

  it("should draft a GitHub release when the release pull request is merged", async ({
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
     * Pushes the change intent commit to `main` so the subsequent release merge
     * commit has a clean base matching the repository history on GitHub.
     */
    createMockPush({ repo });

    /**
     * Applies change intents on the release branch and merges it into `main`.
     * The push of this merge commit modifies `.changeset/ledger.yaml`,
     * signaling a merged release.
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
        /**
         * Verifies the release tag targets the commit that bumped the version
         * on the release branch, rather than the merge commit on `main`.
         */
        target_commitish: releaseCommit,
        name: "v1.1.0",
        body: expect.stringContaining("Add a feature."),
        draft: true,
      },
    ]);
    /**
     * Drafting GitHub releases requires only standard `github.token`; confirms
     * no GitHub App tokens or PR requests were issued.
     */
    expect(github.pulls).toStrictEqual([]);
    expect(github.tokenRequests).toStrictEqual([]);
    expect(github.requests.map(({ token }) => token)).toStrictEqual(
      github.requests.map(() => GITHUB_TOKEN),
    );
  });

  it("should stage the package on npm before it drafts the GitHub release, with `npm`", async ({
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
    /** Simulates a merged release PR using the same sequence as above. */
    createMockPush({ repo });
    await applyChangeIntents({ repo, registry, branch: RELEASE_BRANCH_NAME });
    mergeBranch({ repo, branch: RELEASE_BRANCH_NAME });

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow({ npm: true }) })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    /**
     * When `npm: true`, the reusable workflow executes CI checks on the release
     * commit before publishing packages.
     */
    expect(getStep(result, "check", "Test").output).toContain("consumer: test");
    /**
     * Verifies the new version was uploaded to the Verdaccio staging area
     * awaiting approval, while the public registry continues to serve only the
     * baseline version (1.0.0).
     */
    await expect(registry.getStagedVersions()).resolves.toStrictEqual([
      `${CONSUMER_PACKAGE}@1.1.0`,
    ]);
    await expect(registry.getVersions(CONSUMER_PACKAGE)).resolves.toStrictEqual(
      ["1.0.0"],
    );
    expect(github.releases).toMatchObject([
      { tag_name: "v1.1.0", draft: true },
    ]);
  });

  it("should do nothing on a push without change intents or a release", async ({
    act,
    consumer,
    github,
    signal,
  }) => {
    expect.hasAssertions();

    const repo = consumer.localRepoDir;
    /**
     * Regular commit on `main` with neither change intents nor ledger
     * modifications.
     */
    git(repo, ["commit", "--allow-empty", "-m", "docs: fix a typo"]);

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow() })
      .withEvent("push", createMockPush({ repo }))
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    /**
     * Confirms no GitHub API requests were issued (no PRs, releases, or
     * tokens).
     */
    expect(github.requests).toStrictEqual([]);
  });

  it("should skip a release that exists already when it's run manually", async ({
    act,
    consumer,
    github,
    signal,
  }) => {
    expect.hasAssertions();

    createMockPush({ repo: consumer.localRepoDir });
    /**
     * Simulates a package already at 1.0.0 where the corresponding GitHub
     * release tag already exists. Manual triggers (`workflow_dispatch`) attempt
     * releases directly (e.g. retrying failed runs) and must gracefully skip
     * existing releases.
     */
    github.releases.push({
      tag_name: "v1.0.0",
      target_commitish: MAIN_BRANCH_NAME,
      name: "v1.0.0",
      body: "The first release",
      draft: false,
    });

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow() })
      .withEvent("workflow_dispatch", {})
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    expect(
      getStep(result, "release", "Create draft GitHub releases").output,
    ).toContain("Release v1.0.0 already exists, skipping");
    expect(github.releases).toHaveLength(1);
  });

  it("should skip a release that exists already as a draft when it's run manually", async ({
    act,
    consumer,
    github,
    signal,
  }) => {
    expect.hasAssertions();

    createMockPush({ repo: consumer.localRepoDir });
    /**
     * A draft doesn't create its tag until it's published, so GitHub accepts
     * another draft with the same tag. The draft has to be found by the release
     * lookup, otherwise the retry would leave a duplicate
     */
    github.releases.push({
      tag_name: "v1.0.0",
      target_commitish: MAIN_BRANCH_NAME,
      name: "v1.0.0",
      body: "The first release",
      draft: true,
    });

    const result = await act()
      .withWorkflow({ body: getReleaseWorkflow() })
      .withEvent("workflow_dispatch", {})
      .run({ signal });

    assertStatus(result, ActExecStatus.SUCCESS);
    expect(
      getStep(result, "release", "Create draft GitHub releases").output,
    ).toContain("Release v1.0.0 already exists as a draft, skipping");
    expect(github.releases).toHaveLength(1);
  });
});
