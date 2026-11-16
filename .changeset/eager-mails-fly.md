---
"actions": minor
---

`create-release-pr` creates the release commit through the GitHub API instead of pushing it, so GitHub signs it and the release PR can be merged under a ruleset that requires signed commits.

- **Breaking:** the `app-slug` input of `create-release-pr` is gone. GitHub makes the bot of the GitHub App the author of the commit.
