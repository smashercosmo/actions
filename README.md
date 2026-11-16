# Actions

GitHub Actions for releasing pnpm workspaces.

This repository provides reusable actions and workflows for managing releases. They turn pending change intents into a release PR, create GitHub releases from package changelogs, generate the GitHub App tokens needed by the release process, and ensure that every pull request includes a change intent.

## Available actions

| Action                                             | Description                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [`create-token`](./create-token)                   | Creates a GitHub App installation token and automatically revokes it when the job finishes. |
| [`create-release-pr`](./create-release-pr)         | Applies pending change intents and opens or updates a release PR.                           |
| [`create-github-release`](./create-github-release) | Creates a GitHub release for each unreleased public package, using its `CHANGELOG.md`.      |
| [`require-change-intent`](./require-change-intent) | Fails a pull request if it does not include a change intent.                                |

The repository also provides reusable workflows that combine these actions:

| Workflow                                         | Description                                                                                                                                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ci.yml`](./.github/workflows/ci.yml)           | Checks that pull requests include a change intent, then builds, lints, checks formatting, and runs tests.                                             |
| [`release.yml`](./.github/workflows/release.yml) | Creates or updates the release PR, stages packages on npm after the release PR is merged, and publishes GitHub releases once the versions are on npm. |

## Usage

Always pin actions and reusable workflows to the commit hash of a [release](https://github.com/smashercosmo/actions/releases), rather than to a branch or tag.

A commit hash identifies an exact version of the code and cannot be moved to point to different code later. This makes it a reliable reference for workflows.

Dependabot's `github-actions` ecosystem keeps these pinned commit hashes up to date.

### create-token

Creates a GitHub App installation token for the repository where the workflow is running.

The token is restricted to that repository and receives only the permissions requested by the action. It is automatically masked in workflow logs and revoked when the action's post step runs.

Example:

```yaml
- id: app-token
  uses: smashercosmo/actions/create-token@<commit hash>
  with:
    client-id: ${{ vars.RELEASE_BOT_CLIENT_ID }}
    private-key: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
    permission-contents: write
    permission-pull-requests: write
```

**Inputs**

| Input                      | Required | Description                                                                |
| -------------------------- | -------- | -------------------------------------------------------------------------- |
| `client-id`                | yes      | Client ID of the GitHub App.                                               |
| `private-key`              | yes      | Private key of the GitHub App.                                             |
| `permission-contents`      | no       | Permission for repository contents: `read` or `write`. Defaults to `read`. |
| `permission-pull-requests` | no       | Permission for pull requests: `read` or `write`. Defaults to `read`.       |

**Outputs**

| Output     | Description                           |
| ---------- | ------------------------------------- |
| `token`    | GitHub App installation access token. |
| `app-slug` | Slug of the GitHub App.               |

### create-release-pr

Applies all pending change intents by running `pnpm version -r`.

This updates package versions, generates or updates their changelogs, and removes the processed change intents.

The resulting changes are committed to the release branch through the GitHub API, so GitHub signs the commit as the GitHub App's bot and it shows as verified, e.g. for a ruleset that requires signed commits. The action then opens a release PR or updates the existing one.

If all pending change intents explicitly decline a release (`pnpm change --bump none`), no release PR is created.

**Important:** The action refuses to commit anything if a public package's current version has not yet been published to npm. A staged version does not count as published.

This check prevents `pnpm version` from keeping the existing version and accidentally releasing it a second time.

To resolve this, either:

- Approve the staged version so that it can be published.
- Publish it first by re-running the workflow run triggered when the previous release PR was merged.

After the version has been published, run the action again.

**Requirements**

Before running this action:

- The repository must be checked out.
- pnpm must be installed.
- Project dependencies must be installed.

Use a GitHub App installation token rather than `GITHUB_TOKEN`. Pull requests created using `GITHUB_TOKEN` do not trigger other GitHub Actions workflows.

Example:

```yaml
- uses: smashercosmo/actions/create-release-pr@<commit hash>
  with:
    token: ${{ steps.app-token.outputs.token }}
    format-command: pnpm exec oxfmt
```

**Inputs**

| Input            | Required | Description                                                                                                                                                        |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `token`          | yes      | GitHub App installation token with `contents` and `pull-requests` write permissions.                                                                               |
| `base`           | no       | Branch the release PR targets. Defaults to `main`.                                                                                                                 |
| `branch`         | no       | Branch used for the release PR. Defaults to `release`. This branch is overwritten on every run, so do not use it for anything else.                                |
| `format-command` | no       | Command used to format the files changed by `pnpm version`. The changed file paths are appended to the command as arguments. If empty, no formatting is performed. |

**Outputs**

| Output      | Description                                                                      |
| ----------- | -------------------------------------------------------------------------------- |
| `pr-number` | Number of the opened or updated release PR. Not set if no release PR was needed. |

### create-github-release

Creates and publishes a GitHub release for the current version of each eligible package in the workspace.

Each release is named `v<version>`, and its release notes are taken from the section of that package's `CHANGELOG.md` corresponding to the released version.

Publishing the release creates its Git tag. The tag points to the commit where that package version was set in its `package.json`.

A release is created only if the tag `v<version>` does not exist yet. The tag tells that the version is released already, so the action can run on every push and does nothing for a version that has its release.

With `npm: true`, the release of a public package is created only once its version is on npm. A staged version is not, until someone approves it. The action can wait for that (`npm-wait-minutes`). If the version still isn't on npm when the time is up, the action skips its release with a warning and succeeds, and a later run creates it.

The releases are created with the token passed to the action. Releases created with `GITHUB_TOKEN` do not trigger other workflows, such as one that runs `on: release`.

**Requirements**

- The repository must be checked out with its complete Git history and its tags (`fetch-depth: 0`). The action uses the history to find the commit that introduced each package version, and the tags to tell which versions are released already.
- pnpm must be installed.
- The workspace must not contain more than one package that needs a release. All releases use the tag format `v<version>`, so multiple packages with the same tag would conflict.

Example:

```yaml
- uses: smashercosmo/actions/create-github-release@<commit hash>
  with:
    token: ${{ github.token }}
```

**Inputs**

| Input              | Required | Description                                                                                                                                                                      |
| ------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`            | yes      | GitHub token with `contents` write permission.                                                                                                                                   |
| `include-private`  | no       | Also create releases for private packages that have a version. Defaults to `false`. Useful for repositories that use versioning and Git tags but do not publish packages to npm. |
| `npm`              | no       | Create the release of a public package only once its version is on npm. Defaults to `false`. Private packages are never on npm, so they are released right away.                 |
| `npm-wait-minutes` | no       | How long to wait for package versions to appear on npm, checking every 30 seconds. Defaults to `0`, which checks once. Only used when `npm` is enabled.                          |

### require-change-intent

Checks that a pull request adds a change intent to `.changeset/`.

A change intent is created using `pnpm change`. If a change does not require a release, use `pnpm change --bump none`.

The release PR is exempt from this requirement because it is the only pull request that modifies `.changeset/ledger.yaml`.

The action also checks that the release PR includes all change intents currently present on the base branch.

For example, if a new change intent is merged into `main` after the release PR was created, the release PR no longer includes all pending changes. The check fails until `release.yml` updates the PR on the next push.

**Important:** The main branch ruleset must enable **Require branches to be up to date before merging**.

Without this setting, the release PR could be merged using an earlier successful check, even though new change intents have since been added to the base branch. In that case, the release workflow would not release those changes.

**Requirements**

- The action runs only on `pull_request` events.
- The workflow must check out the pull request's merge commit.
- The checkout must include the merge commit and its parent commits. Use `fetch-depth: 2`, which is the required checkout depth for this action.
- Add the action as a required status check for the base branch.

Example:

```yaml
- uses: actions/checkout@<commit hash>
  with:
    persist-credentials: false
    fetch-depth: 2

- uses: smashercosmo/actions/require-change-intent@<commit hash>
```

### ci.yml

A reusable CI workflow with two jobs:

**`changeset`**

Runs `require-change-intent` on pull requests, except those created by Dependabot.

**`check`**

Runs the following checks:

- `pnpm change status`
- `pnpm build`, if the workspace defines a `build` script.
- `pnpm lint`
- `pnpm format --check`
- `pnpm test`, if the workspace defines a `test` script.

The build must not modify or create files that are not ignored by Git. For example, committed build output must already be up to date.

**Concurrency**

The workflow defines its own concurrency group. Each pull request can have only one CI run executing at a time.

When a new commit is pushed to a pull request, its new CI run cancels the previous run for that pull request. This avoids wasting time on checks for outdated code.

The calling workflow must not define its own concurrency group, as the reusable workflow already handles concurrency.

Example calling workflow:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions: {}

jobs:
  ci:
    permissions:
      contents: read
    uses: smashercosmo/actions/.github/workflows/ci.yml@<commit hash>
    with:
      playwright-browsers: chromium webkit firefox
```

**Inputs**

| Input                 | Required | Description                                                                                                                                                                                         |
| --------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playwright-browsers` | no       | Space-separated list of Playwright browsers to install before running tests. Uses the Playwright version from the first workspace package that depends on it. No browsers are installed by default. |

**Required status checks**

The workflow reports two status checks:

- `ci / changeset`
- `ci / check`

The first part is the calling job name, and the second part is the job name inside the reusable workflow.

Use both names as required status checks in the main branch ruleset.

### release.yml

A reusable workflow that handles the release process.

It is intended to run on every push to `main`. Depending on the changes, it either creates or updates a release PR, prepares a release after that PR is merged, or does nothing. On every run, it also publishes the GitHub release of the current version if there's none yet.

**What happens on each push to `main`**

- **Pending change intents exist:** Opens or updates the release PR using `create-release-pr`. The changed files are formatted with `pnpm format`.
- **A release PR was just merged, or the workflow was started manually:** When `npm: true`, runs `ci.yml` against the commit being released, builds the packages in `./packages/*`, and stages them on npm using `pnpm stage publish -r`.
- **Always:** Publishes the GitHub release of the current version using `create-github-release`, unless it exists already. Publishing it creates the corresponding Git tag.

**Releases and npm approval**

When `npm: true`, a GitHub release is published only once its version is on npm, which happens when someone approves the staged version (`pnpm stage approve`). After staging, the run of the merge waits up to `npm-approval-timeout` minutes for the approval and publishes the release as soon as the version is on npm.

If the approval comes later, the run still succeeds, with a warning. The next run of the workflow publishes the release: the next push to `main`, a re-run, or a manual run. Until the version is on npm, `create-release-pr` refuses to open the next release PR, so a version can't be skipped.

While the run of the merge waits, it holds the concurrency group, so other runs wait in the queue.

The releases are created with `GITHUB_TOKEN`, so they don't trigger other workflows, such as one that runs `on: release`. To run something after a release, add a job to the calling workflow with `needs: release`.

**Important: Do not merge the release PR while pending change intents are present.**

If new change intents are added before the release PR is merged, the workflow will create or update the next release PR instead of preparing the release that was just merged.

The main branch ruleset must prevent this situation. Require the `ci / changeset` status check and enable **Require branches to be up to date before merging**.

Example calling workflow:

```yaml
name: Release

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions: {}

jobs:
  release:
    permissions:
      contents: write
      id-token: write
    uses: smashercosmo/actions/.github/workflows/release.yml@<commit hash>
    with:
      app-client-id: ${{ vars.RELEASE_BOT_CLIENT_ID }}
      npm: true
    secrets:
      app-private-key: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
```

**Concurrency**

The calling workflow defines its own concurrency group. Only one release workflow run executes at a time, while other runs wait for their turn instead of cancelling the currently running run.

The calling workflow must not define an additional concurrency group inside the reusable workflow's caller job configuration.

**Permissions**

The calling job defines the maximum permissions that jobs inside the reusable workflow can receive. Each individual job then requests only the permissions it needs.

Allow `id-token: write` even when `npm` is disabled. GitHub checks the permissions of every job when the workflow run starts, including jobs that will later be skipped.

**GitHub App and npm configuration**

The calling repository must have a GitHub environment named `release`. This environment must contain the GitHub App's private key.

When `npm` is enabled, configure the npm trusted publisher for every package to reference:

- The calling workflow's filename (for example, `release.yml`), not the filename of this reusable workflow.
- The `release` environment.

**GitHub App configuration**

The GitHub App's client ID must be stored as a repository or organization variable, not as a variable in the `release` environment.

The calling job reads this variable, but a job that calls a reusable workflow cannot define its own environment.

The private key can be stored as a secret in the `release` environment. Secrets passed by name are resolved in the job that defines the environment, so the reusable workflow can access the environment's private key.

**Inputs**

| Input                  | Required | Description                                                                                                                                        |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app-client-id`        | yes      | Client ID of the GitHub App used to open the release PR.                                                                                           |
| `npm`                  | no       | Whether to run CI and stage packages on npm, and publish GitHub releases only for versions that are on npm. Defaults to `false`.                   |
| `include-private`      | no       | Whether to also create releases for private packages that have a version. Defaults to `false`.                                                     |
| `playwright-browsers`  | no       | Playwright browsers passed to `ci.yml`. See the CI workflow documentation. Only used when `npm` is enabled.                                        |
| `npm-approval-timeout` | no       | Minutes the run of the merge waits for the staged versions to be approved on npm. Defaults to `10`, at most `20`. Only used when `npm` is enabled. |

**Secrets**

| Secret            | Required | Description                                                |
| ----------------- | -------- | ---------------------------------------------------------- |
| `app-private-key` | yes      | Private key of the GitHub App used to open the release PR. |

## Development

**Requirements**

- pnpm. See the `packageManager` field in `package.json` for the exact version.
- Node.js is installed automatically by pnpm using the version specified in `devEngines.runtime`.

Install dependencies:

```bash
pnpm install
```

Run linting and type checks:

```bash
pnpm lint
```

Format the code:

```bash
pnpm format
```

The actions are written in TypeScript and run as they are, with no build step. The runner starts them with Node.js 24 (`runs.using: node24` in `action.yml`), which strips the types before running the code. The `action.yml` of each action points at its TypeScript entry file, e.g. `main: index.ts`.

This puts a few constraints on the code:

- Imports name the `.ts` file, e.g. `import { info } from "#shared/core.ts"`, as Node.js doesn't map `.js` imports to `.ts` files.
- Only TypeScript that is JavaScript once the types are removed: no `enum`, `namespace` or parameter properties. `erasableSyntaxOnly` in `tsconfig.json` enforces it.
- Imports of types only use `import type`, which `verbatimModuleSyntax` enforces.
- No runtime dependencies. GitHub runs an action straight from this repository, without installing anything, so an action can import Node.js built-ins and the files of this repository (such as [`shared`](./shared)) only. Packages from npm are for the tests and the tooling. The workflow tests run the actions from a copy of the repository without `node_modules`, so an import of an npm package makes them fail.

To add a new action, create a directory containing its `action.yml` and source files.

### Tests

Run the unit tests of the actions and the [shared helpers](./shared), including the checks of the actions' schemas against GitHub's and pnpm's types:

```bash
pnpm test
```

Run the workflow tests:

```bash
pnpm test:act
```

The tests in `.github/tests` execute the reusable workflows, including the actions they call, locally using [act](https://github.com/nektos/act) and [act-test-runner](https://github.com/pshevche/act-test-runner).

**Requirements**

- Docker
- `act` available on `PATH`
- An active network connection

The tests need network access because the jobs download pnpm. On the first run, they also download the `catthehacker/ubuntu:act-latest` image and the third-party actions used by the workflows.

**How the tests work**

Each test runs against a simulated consumer repository that exists only on your machine.

The test environment consists of:

- A consumer repository copied from `.github/tests/fixtures/consumer`, together with a bare Git repository that acts as its remote on github.com.
- A simulated GitHub API that implements the endpoints used by the actions and keeps track of the pull requests and releases they create.
- A local npm registry powered by [Verdaccio](https://www.verdaccio.org), with npm staging enabled.

The workflows are executed in the same way a consumer repository would call them.

`act` does not understand the `$/` references used by this repository. To work around this, the tests create a copy of the working tree where each `$/<path>` reference is replaced with `smashercosmo/actions/<path>@local`.

`act` resolves these references to the local copy, allowing the tests to run the actual workflow and action implementations without publishing them first.

To see the full output from `act`, set:

```bash
ACT_TESTS_VERBOSE=1
```

`act-test-runner` is installed from the tarball:

```text
.github/act-test-runner-2.0.0.tgz
```

## Releases

Every pull request must include a change intent in `.changeset/`.

Create a change intent describing the change and the required version bump:

```bash
pnpm change
```

For a change that does not require a release:

```bash
pnpm change --bump none
```

The release workflow collects pending change intents and creates a release PR containing the updated package versions and changelogs.

When the release PR is merged, the workflow publishes the GitHub release of the new version, which creates its `v<version>` Git tag.

**Nothing is published to npm by this repository's own release process.** Pin the actions and reusable workflows to the commit hash of a release.

**GitHub App setup**

The workflow requires a GitHub App installed on the repository with:

- `contents` write permission.
- `pull-requests` write permission.

The repository must also have a GitHub environment named `release` configured with:

| Setting  | Value                                                     |
| -------- | --------------------------------------------------------- |
| Variable | `RELEASE_BOT_CLIENT_ID` — the GitHub App's client ID.     |
| Secret   | `RELEASE_BOT_PRIVATE_KEY` — the GitHub App's private key. |

## License

[MIT](./LICENSE) © Vladislav Shkodin
