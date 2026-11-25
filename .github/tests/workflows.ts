import { ACTIONS_REF, ACTIONS_REPOSITORY } from "./scripts/actrc.ts";

const WORKFLOWS = `${ACTIONS_REPOSITORY}/.github/workflows`;

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
 * Name of the step of the `tag` job, which prints the `tag` output of the
 * release workflow as `The tag is '<tag>'`.
 */
const PRINT_TAG_STEP = "Print the tag";

function getReleaseWorkflow({
  npm = false,
  includePrivate = false,
  npmApprovalTimeout = 0,
  docs = false,
}: {
  npm?: boolean;
  includePrivate?: boolean;
  npmApprovalTimeout?: number;
  docs?: boolean;
} = {}) {
  /**
   * Not `String.raw`: it would keep the backslashes that stop `${{` from being
   * interpolated, and the expressions would evaluate to `\<value>`.
   */
  return `
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
          pages: write
        uses: ${WORKFLOWS}/release.yml@${ACTIONS_REF}
        with:
          app-client-id: \${{ vars.RELEASE_BOT_CLIENT_ID }}
          npm: ${npm}
          include-private: ${includePrivate}
          npm-approval-timeout: ${npmApprovalTimeout}
          docs: ${docs}
        secrets:
          app-private-key: \${{ secrets.RELEASE_BOT_PRIVATE_KEY }}

      # Reads the output of the release workflow, as a job of the calling
      # workflow that runs after the release would.
      tag:
        needs: release
        runs-on: ubuntu-latest
        steps:
          - name: ${PRINT_TAG_STEP}
            env:
              TAG: \${{ needs.release.outputs.tag }}
            run: echo "The tag is '$TAG'"
  `;
}

export { CI_WORKFLOW, PRINT_TAG_STEP, getReleaseWorkflow };
