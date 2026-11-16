---
"actions": minor
---

Make releases safer to retry and harder to break, and remove the `cache` and `draft` inputs.

- **Breaking:** `ci.yml` and `release.yml` no longer have the `cache` input, and nothing is cached anymore, neither the pnpm store nor the Playwright browsers.
- **Breaking:** `create-github-release` publishes releases right away, which creates their tags, instead of drafting them, and the `draft` input is gone. With the new `npm` input, it releases a public package only once its version is on npm, and `npm-wait-minutes` makes it wait for that.
- **Breaking:** `release.yml` publishes the GitHub release of the current version on every run, once it's on npm with `npm`, instead of drafting it after the merge of the release PR. The run of the merge waits for the approval of the staged versions for up to `npm-approval-timeout` minutes (new input, 10 by default). A version approved later is released by the next run. The releases are created with `GITHUB_TOKEN`, so they don't trigger other workflows.
- `release.yml` runs one at a time: runs wait in a queue instead of canceling each other, so a push right after the merge of the release PR can't cancel the run that releases it. The calling workflow must not set a concurrency group.
- `release.yml` decides what to do with the new `plan-release` action instead of a shell script. The action is internal to the workflow.
- `create-release-pr` fails, without pushing anything, when the current version of a package isn't on npm yet, instead of opening a release PR that would release that version a second time.
- `require-change-intent` fails the release PR while the base branch has change intents the PR doesn't apply yet. The ruleset of the main branch needs "Require branches to be up to date before merging" for the check to hold.
- `create-github-release` skips a version whose `v<version>` tag exists already, instead of listing every release of the repository. It doesn't recognize drafts left from earlier versions, which can be deleted.
- Docs: the client ID of the GitHub App has to be a repository or organization variable.
- Tests that run the reusable workflows on your machine with act (`pnpm test:act`).
