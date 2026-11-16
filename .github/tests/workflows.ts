import { ACTIONS_REF, ACTIONS_REPOSITORY } from "./scripts/actrc";

/**
 * Path to our reusable workflows folder, formatted the way an external
 * "consumer" repository would reference it (e.g.
 * `smashercosmo/actions/.github/workflows`).
 */
const WORKFLOWS = `${ACTIONS_REPOSITORY}/.github/workflows`;

/**
 * A sample `ci.yml` file that an external repository would put in its
 * `.github/workflows/`.
 *
 * All it does is call our reusable `ci.yml` workflow using `uses: ...`. In our
 * tests, we don't save this to a file on disk; we pass this string directly to
 * `act` via `withWorkflow({ body: CI_WORKFLOW })` to test how `ci.yml` runs.
 */
const CI_WORKFLOW = String.raw`
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
      uses: ${WORKFLOWS}/ci.yml@${ACTIONS_REF}
`;

/**
 * A sample `release.yml` file that an external repository would use to trigger
 * releases.
 *
 * It calls our reusable `release.yml` workflow.
 *
 * - When `npm: true` is passed, the workflow will run CI checks and publish
 *   packages to our fake npm registry before drafting a GitHub release.
 * - `includePrivate: true` passes `include-private`, so private packages get
 *   GitHub releases too, like a repository that is versioned and tagged but
 *   never published.
 * - The `\${{` is escaped so JavaScript doesn't treat it as template
 *   interpolation, allowing GitHub Actions expressions like `${{
 *   vars.RELEASE_BOT_CLIENT_ID }}` to pass through untouched. `act` fills in
 *   those variables using our test configs in `actrc.ts`.
 */
function getReleaseWorkflow({
  npm = false,
  includePrivate = false,
}: { npm?: boolean; includePrivate?: boolean } = {}) {
  return String.raw`
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
        uses: ${WORKFLOWS}/release.yml@${ACTIONS_REF}
        with:
          app-client-id: \${{ vars.RELEASE_BOT_CLIENT_ID }}
          npm: ${npm}
          include-private: ${includePrivate}
        secrets:
          app-private-key: \${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
  `;
}

export { CI_WORKFLOW, getReleaseWorkflow };
