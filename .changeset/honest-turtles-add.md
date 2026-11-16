---
"actions": minor
---

Make releases safer to retry and harder to break, and remove the `cache` and `draft` inputs.

- **Breaking:** `ci.yml` and `release.yml` no longer have the `cache` input, and nothing is cached anymore, neither the pnpm store nor the Playwright browsers.
- **Breaking:** `create-github-release` always creates draft releases, and the `draft` input is gone. The tag is created once the draft is published.
- `release.yml` runs one at a time: runs wait in a queue instead of canceling each other, so a push right after the merge of the release PR can't cancel the run that releases it. The calling workflow must not set a concurrency group.
- `release.yml` decides what to do with the new `plan-release` action instead of a shell script. The action is internal to the workflow.
- `create-release-pr` fails, without pushing anything, when the current version of a package isn't on npm yet, instead of opening a release PR that would release that version a second time.
- `require-change-intent` fails the release PR while the base branch has change intents the PR doesn't apply yet. The ruleset of the main branch needs "Require branches to be up to date before merging" for the check to hold.
- `create-github-release` looks up an existing release by its tag, drafts included, instead of listing every release of the repository.
- Docs: the client ID of the GitHub App has to be a repository or organization variable.
- Tests that run the reusable workflows on your machine with act (`pnpm test:act`).
