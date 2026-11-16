import { ACTIONS_REF, ACTIONS_REPOSITORY } from "./scripts/actrc.ts";

/** Reusable workflow path as an external consumer repository would write it. */
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

function getReleaseWorkflow({
  npm = false,
  includePrivate = false,
  npmApprovalTimeout = 0,
}: {
  npm?: boolean;
  includePrivate?: boolean;
  npmApprovalTimeout?: number;
} = {}) {
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
          npm-approval-timeout: ${npmApprovalTimeout}
        secrets:
          app-private-key: \${{ secrets.RELEASE_BOT_PRIVATE_KEY }}
  `;
}

export { CI_WORKFLOW, getReleaseWorkflow };
