---
"actions": minor
---

Deploy the docs of the released version to GitHub Pages from `release.yml`, with the new reusable `pages.yml` workflow.

- **Breaking:** the job that calls `release.yml` has to allow `pages: write`, even without `docs`, as GitHub checks the permissions of skipped jobs too.
- `release.yml` has the new `docs`, `docs-build-command` and `docs-path` inputs. With `docs: true`, every run builds the docs site from the tag of the released version and deploys it to GitHub Pages. Nothing is deployed while a version waits for npm.
- `pages.yml` builds a static site with a command and deploys it to GitHub Pages. Call it directly to deploy a site some other way, e.g. by hand.
- `create-github-release` and `release.yml` output the `tag` of the current version once its release exists.
