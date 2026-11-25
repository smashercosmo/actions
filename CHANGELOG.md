# actions

## 0.5.0

### Minor Changes

- Deploy the docs of the released version to GitHub Pages from `release.yml`, with the new reusable `pages.yml` workflow.

  - **Breaking:** the job that calls `release.yml` has to allow `pages: write`, even without `docs`, as GitHub checks the permissions of skipped jobs too.
  - `release.yml` has the new `docs`, `docs-build-command` and `docs-path` inputs. With `docs: true`, every run builds the docs site from the tag of the released version and deploys it to GitHub Pages. Nothing is deployed while a version waits for npm.
  - `pages.yml` builds a static site with a command and deploys it to GitHub Pages. Call it directly to deploy a site some other way, e.g. by hand.
  - `create-github-release` and `release.yml` output the `tag` of the current version once its release exists.

## 0.4.0

### Minor Changes

- `create-release-pr` creates the release commit through the GitHub API instead of pushing it, so GitHub signs it and the release PR can be merged under a ruleset that requires signed commits.

  - **Breaking:** the `app-slug` input of `create-release-pr` is gone. GitHub makes the bot of the GitHub App the author of the commit.

- Make releases safer to retry and harder to break, and remove the `cache` and `draft` inputs.

  - **Breaking:** `ci.yml` and `release.yml` no longer have the `cache` input, and nothing is cached anymore, neither the pnpm store nor the Playwright browsers.
  - **Breaking:** `create-github-release` publishes releases right away, which creates their tags, instead of drafting them, and the `draft` input is gone. With the new `npm` input, it releases a public package only once its version is on npm, and `npm-wait-minutes` makes it wait for that.
  - **Breaking:** `release.yml` publishes the GitHub release of the current version on every run, once it's on npm with `npm`, instead of drafting it after the merge of the release PR. The run of the merge waits for the approval of the staged versions for up to `npm-approval-timeout` minutes (new input, 10 by default). A version approved later is released by the next run. The releases are created with `GITHUB_TOKEN`, so they don't trigger other workflows.
  - `release.yml` runs one at a time: runs wait in a queue instead of canceling each other, so a push right after the merge of the release PR can't cancel the run that releases it. The calling workflow must not set a concurrency group.
  - `release.yml` decides what to do with the new `plan-release` action instead of a shell script. The action is internal to the workflow.
  - `create-release-pr` fails, without pushing anything, when the current version of a package isn't on npm yet, instead of opening a release PR that would release that version a second time.
  - `require-change-intent` fails the release PR while the base branch has change intents the PR doesn't apply yet. The ruleset of the main branch needs "Require branches to be up to date before merging" for the check to hold.
  - `create-github-release` skips a version whose `v<version>` tag exists already, instead of listing every release of the repository. It doesn't recognize drafts left from earlier versions, which can be deleted.
  - Tests that run the reusable workflows on your machine with act (`pnpm test:act`).

## 0.3.0

### Minor Changes

- Add the reusable `ci.yml` and `release.yml` workflows.

## 0.2.0

### Minor Changes

- Add the `require-change-intent` action, which fails a pull request that doesn't add a change intent.

## 0.1.0

### Minor Changes

- Add the `create-token`, `create-release-pr` and `create-github-release` actions, extracted from nano-skeleton.
