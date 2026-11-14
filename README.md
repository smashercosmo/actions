# actions

GitHub Actions for releasing pnpm workspaces: a release PR built from pending
change intents, draft GitHub releases built from the changelogs, the GitHub App
token both of them need, and a check that every pull request adds an intent.

| Action                                             | Description                                                                       |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| [`create-token`](./create-token)                   | Creates a GitHub App installation token and revokes it when the job ends.         |
| [`create-release-pr`](./create-release-pr)         | Applies pending change intents and opens or updates a release PR.                 |
| [`create-github-release`](./create-github-release) | Creates a GitHub release from `CHANGELOG.md` for every unreleased public package. |
| [`require-change-intent`](./require-change-intent) | Fails a pull request that doesn't add a change intent.                            |

And reusable workflows that put them together:

| Workflow                                         | Description                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| [`ci.yml`](./.github/workflows/ci.yml)           | Requires a change intent, then builds, lints, checks the formatting and tests.   |
| [`release.yml`](./.github/workflows/release.yml) | Opens the release PR, then stages the packages on npm and drafts their releases. |

## Usage

Pin the actions and workflows to the commit hash of a
[release](https://github.com/smashercosmo/actions/releases), not to a branch
or a tag: the hash is the only reference that can't be moved to other code
later. Dependabot's
`github-actions` ecosystem keeps the hashes up to date.

### create-token

Creates an installation token of a GitHub App for the repository the workflow
runs in, limited to that repository and to the permissions asked for. The token
is masked in the logs and revoked in the action's post step.

```yaml
- id: app-token
  uses: smashercosmo/actions/create-token@<commit hash>
  with:
    client-id: ${{ vars.RELEASE_BOT_CLIENT_ID }}
    private-key: ${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
    permission-contents: write
    permission-pull-requests: write
```

| Input                      | Required | Description                             |
| -------------------------- | -------- | --------------------------------------- |
| `client-id`                | yes      | Client ID of the GitHub App.            |
| `private-key`              | yes      | Private key of the GitHub App.          |
| `permission-contents`      | no       | `read` or `write`. `read` when not set. |
| `permission-pull-requests` | no       | `read` or `write`. `read` when not set. |

| Output     | Description                    |
| ---------- | ------------------------------ |
| `token`    | The installation access token. |
| `app-slug` | Slug of the GitHub App.        |

### create-release-pr

Runs `pnpm version -r`, which applies the pending change intents: it bumps the
versions, writes the changelogs and removes the intents. The result is
committed as the GitHub App's bot user, force-pushed to the release branch and
opened as a pull request, or the open one is updated. Does nothing when the
pending intents only decline a release (`pnpm change --bump none`).

The repository has to be checked out, and pnpm and the dependencies installed,
before the action runs. Use a GitHub App token, as pull requests opened with
`GITHUB_TOKEN` don't trigger other workflows.

```yaml
- uses: smashercosmo/actions/create-release-pr@<commit hash>
  with:
    token: ${{ steps.app-token.outputs.token }}
    app-slug: ${{ steps.app-token.outputs.app-slug }}
    format-command: pnpm exec oxfmt
```

| Input            | Required | Description                                                                                                                             |
| ---------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `token`          | yes      | GitHub App installation token with `contents` and `pull-requests` write permissions.                                                    |
| `app-slug`       | yes      | Slug of the GitHub App, used as the commit author.                                                                                      |
| `base`           | no       | Branch the release PR targets. `main` by default.                                                                                       |
| `branch`         | no       | Branch the release PR is opened from, `release` by default. Force-pushed on every run, so it must not be used for anything else.        |
| `format-command` | no       | Command that formats the files `pnpm version` changed. The files are appended to it as arguments. Nothing is formatted when it's empty. |

| Output      | Description                                                                |
| ----------- | -------------------------------------------------------------------------- |
| `pr-number` | Number of the opened or updated release PR. Not set when no PR was needed. |

### create-github-release

Creates a `v<version>` release for the public package of the workspace, unless
a release with that tag, draft or not, already exists. The release notes are
the section of that version in the package's `CHANGELOG.md`, and the tag points
to the commit that set the version in its `package.json`.

The repository has to be checked out with its full history (`fetch-depth: 0`),
and pnpm has to be installed. Fails for a workspace with more than one package to
release, as `v<version>` tags would clash there.

```yaml
- uses: smashercosmo/actions/create-github-release@<commit hash>
  with:
    token: ${{ github.token }}
    draft: true
```

| Input             | Required | Description                                                                                                                                      |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `token`           | yes      | GitHub token with `contents` write permission.                                                                                                   |
| `draft`           | no       | Create draft releases, `false` by default. The tag is created once a draft is published.                                                         |
| `include-private` | no       | Also release private packages that have a version, `false` by default. For a repository that is versioned and tagged but never published to npm. |

### require-change-intent

Fails when the pull request doesn't add a change intent to `.changeset/`
(`pnpm change`, or `pnpm change --bump none` for a change that needs no
release). The release PR passes without one: it's the only pull request that
changes `.changeset/ledger.yaml`.

Runs on `pull_request` events only, with the merge commit of the pull request
checked out with `fetch-depth: 2`, which is the default checkout of the event
plus its parents. Make it a required status check of the base branch.

```yaml
- uses: actions/checkout@<commit hash>
  with:
    persist-credentials: false
    fetch-depth: 2

- uses: smashercosmo/actions/require-change-intent@<commit hash>
```

### ci.yml

A `changeset` job that runs `require-change-intent` on pull requests (except
Dependabot's), and a `check` job that runs `pnpm change status`, `pnpm build`,
`pnpm lint`, `pnpm format --check` and `pnpm test`, if the workspace has a
`test` script. The build must not change or add any file that isn't ignored,
e.g. committed build output that is out of date.

Sets its own concurrency group: one run per pull request, a new push cancels
the old run. The calling workflow must not set one.

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
      cache: true
      playwright-browsers: chromium webkit firefox
```

| Input                 | Required | Description                                                                                                                                                                     |
| --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cache`               | no       | Cache the pnpm store and the Playwright browsers between runs, `false` by default.                                                                                              |
| `playwright-browsers` | no       | Playwright browsers to install before the tests, separated by spaces. Installed with the Playwright version of the first workspace package that depends on it. None by default. |

The checks report as `ci / changeset` and `ci / check` (the calling job, then
the job of the workflow). Use these names for the required status checks of
the main branch ruleset.

### release.yml

On every push to main:

- pending change intents → opens or updates the release PR with
  `create-release-pr`, formatted with `pnpm format`.
- the release PR was just merged, or the workflow was run manually → with
  `npm: true`, runs `ci.yml` on the commit, builds `./packages/*` and stages
  them on npm with `pnpm stage publish -r`. Then drafts the GitHub releases
  with `create-github-release`.

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

The calling job sets the most the jobs of the workflow can get, and every job
asks only for what it needs. Allow `id-token: write` even without `npm`:
GitHub checks the permissions of every job when the run starts, skipped ones
included.

The repository needs a `release` environment that has the GitHub App's private
key. With `npm`, the npm trusted publisher of every package names the calling
workflow (e.g. `release.yml`), not this one, and the `release` environment.

The GitHub App's client ID has to be a repository or organization variable,
not a variable of the `release` environment: the calling job reads it, and a
job that calls a reusable workflow can't have an environment. The private key
can be a secret of the environment, as secrets passed by name are resolved in
the job of the workflow that sets the environment.

| Input                 | Required | Description                                                                          |
| --------------------- | -------- | ------------------------------------------------------------------------------------ |
| `app-client-id`       | yes      | Client ID of the GitHub App that opens the release PR.                               |
| `npm`                 | no       | Stage the packages on npm, after running `ci.yml` on the commit. `false` by default. |
| `include-private`     | no       | Also draft releases for private packages that have a version, `false` by default.    |
| `cache`               | no       | Cache the pnpm store between runs, `false` by default. Passed on to `ci.yml`.        |
| `playwright-browsers` | no       | Passed on to `ci.yml`, see there. Only used with `npm`.                              |

| Secret            | Required | Description                                              |
| ----------------- | -------- | -------------------------------------------------------- |
| `app-private-key` | yes      | Private key of the GitHub App that opens the release PR. |

## Development

Requirements: pnpm (see `packageManager` in `package.json` for the exact
version). pnpm installs the Node.js version from `devEngines.runtime` itself.

```bash
# Install dependencies
pnpm install

# Bundle every action into its dist folder
pnpm build

# Lint and type-check
pnpm lint

# Format the code
pnpm format
```

GitHub runs an action straight from this repository, without installing
anything. So every action is bundled together with its dependencies into its
own `dist` folder, and those folders are committed. Run `pnpm build` after
changing the sources or the dependencies and commit the result with the
change: CI fails when `dist` doesn't match the sources.

To add an action, create a folder with its `action.yml` and sources, and add
its entry files to `tsdown.config.ts`.

## Releases

Every pull request has to add a change intent to `.changeset/`:

```bash
# Describes the change and how it bumps the version
pnpm change

# For a change that needs no release
pnpm change --bump none
```

The release workflow turns the pending intents into a release PR with the new
version and the changelog. Merging it drafts a GitHub release, and publishing
the draft creates the `v<version>` tag. Nothing is published to npm: pin the
actions to the commit hash of a release.

The workflow needs a GitHub App that is installed on this repository with
`contents` and `pull-requests` write permissions, and a `release` environment
with the app's client ID in the `RELEASE_BOT_CLIENT_ID` variable and its
private key in the `RELEASE_BOT_PRIVATE_KEY` secret.

## License

[MIT](./LICENSE) © Vladislav Shkodin
