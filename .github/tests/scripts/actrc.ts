import { generateKeyPairSync } from "node:crypto";

/**
 * Shared `act` test configuration: fake repositories, tokens, GitHub App
 * identity, runner flags, and environment variables.
 */

/**
 * Runner image with the tools these workflows expect, including Node 24, git,
 * and jq.
 */
const ACT_IMAGE = "catthehacker/ubuntu:act-latest";

const ACTIONS_REPOSITORY = "smashercosmo/actions";
const ACTIONS_REF = "local";

const CONSUMER_OWNER = "acme";
const CONSUMER_REPO = "consumer";
const CONSUMER_REPOSITORY = `${CONSUMER_OWNER}/${CONSUMER_REPO}`;
/**
 * Canonical URL used by actions under test. Git rewrites it to the local bare
 * repository in `getEnv`, so tests never push to github.com.
 */
const CONSUMER_URL = `https://github.com/${CONSUMER_REPOSITORY}`;

const CONSUMER_PACKAGE = "acme-lib";
const CONSUMER_PACKAGE_DIR = "packages/lib";

const MAIN_BRANCH_NAME = "main";
const FEATURE_BRANCH_NAME = "feature";
const RELEASE_BRANCH_NAME = "release";

/**
 * Fake GitHub App identity used to verify bot-authored commits and elevated
 * release PR permissions.
 */
const RELEASE_BOT_CLIENT_ID = "Iv23liMockClientId00";
const RELEASE_BOT_SLUG = "release-bot";
const RELEASE_BOT_USER_ID = 12_345_678;
const RELEASE_BOT_INSTALLATION_ID = 87_654_321;

const GITHUB_TOKEN = "ghs_mockGithubToken";
/**
 * Keep this distinct from `GITHUB_TOKEN` so tests can assert which credential a
 * workflow used.
 */
const INSTALLATION_TOKEN = "ghs_mockInstallationToken";

/**
 * Use a real key so `create-token` exercises JWT signing, not only string
 * plumbing.
 */
const RELEASE_BOT_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
}).privateKey;

/**
 * Public actions must be fetched from github.com without the fake token we use
 * in tests.
 */
const THIRD_PARTY_ACTIONS = ["actions/checkout", "pnpm/setup"];

/** Builds the `act` flags that connect workflow containers to local fixtures. */
function getAdditionalArgs({
  localRepoDir,
  remoteDir,
  npmrcFile,
  localRepositories,
}: {
  localRepoDir: string;
  remoteDir: string;
  npmrcFile: string;
  localRepositories: readonly string[];
}) {
  return [
    ["-P", `ubuntu-latest=${ACT_IMAGE}`],
    /** Reuse the local image when it is already present. */
    ["--pull=false"],
    /**
     * Run real checkout steps instead of `act`'s file-copy shortcut, because PR
     * merge commits and parent history are part of the behavior under test.
     */
    ["--no-skip-checkout"],
    /** Let cached actions keep tests usable when the network is unavailable. */
    ["--action-offline-mode"],
    /**
     * Public actions should be downloaded from github.com, not the mocked host
     * configured for the consumer repository.
     */
    ...THIRD_PARTY_ACTIONS.map((repository) => [
      "--replace-ghe-action-with-github-com",
      repository,
    ]),
    /** The isolated test repositories do not share dependency caches. */
    ["--no-cache-server"],
    ["--directory", localRepoDir],
    [
      "--container-options",
      [
        /**
         * Mount the fake remote repository at the same path inside Docker so
         * rewritten Git URLs resolve there.
         */
        `-v ${remoteDir}:${remoteDir}`,
        /** Give in-container pnpm the token for the mock Verdaccio registry. */
        `-v ${npmrcFile}:/root/.npmrc`,
        /** Let Linux containers reach mock services running on the host. */
        "--add-host=host.docker.internal:host-gateway",
      ].join(" "),
    ],
    /** Resolve `smashercosmo/actions/...@local` to staged local action copies. */
    ...localRepositories.map((localRepository) => [
      "--local-repository",
      localRepository,
    ]),
  ].flat();
}

/**
 * Environment passed into workflow containers so Git, GitHub API calls, and
 * pnpm all use local test services.
 */
function getEnv({
  remoteDir,
  githubApiPort,
  registryPort,
}: {
  remoteDir: string;
  githubApiPort: number;
  registryPort: number;
}) {
  /**
   * Redirect the consumer repository URL to the local bare repository and trust
   * host-owned files that Docker accesses as root.
   */
  const gitConfig = [
    [`url.${remoteDir}/${CONSUMER_REPO}.insteadOf`, CONSUMER_URL],
    /**
     * Prevents git from throwing "fatal: detected dubious ownership in
     * repository" errors when root inside Docker accesses files created by your
     * user on the host.
     */
    ["safe.directory", "*"],
  ] as const;

  return {
    values: {
      /**
       * Git reads config from numbered env pairs, avoiding a generated
       * `.gitconfig` file inside the container.
       */
      GIT_CONFIG_COUNT: String(gitConfig.length),
      ...Object.fromEntries(
        gitConfig.flatMap(([key, value], index) => [
          [`GIT_CONFIG_KEY_${index}`, key],
          [`GIT_CONFIG_VALUE_${index}`, value],
        ]),
      ),
      /** Route GitHub REST calls to the mock server on the host. */
      GITHUB_API_URL: `http://host.docker.internal:${githubApiPort}`,
      GITHUB_REPOSITORY: CONSUMER_REPOSITORY,
      /** Route package installs and publishes to the mock registry. */
      pnpm_config_registry: `http://host.docker.internal:${registryPort}/`,
    },
  };
}

/** Secrets exposed to workflow expressions during `act` runs. */
function getSecrets() {
  return {
    values: {
      /**
       * Prevent `act` from falling back to a real GitHub credential from the
       * developer machine.
       */
      GITHUB_TOKEN,
      RELEASE_BOT_PRIVATE_KEY,
    },
  };
}

/** Repository variables exposed to workflow expressions. */
function getVariables() {
  return {
    values: {
      RELEASE_BOT_CLIENT_ID,
    },
  };
}

export {
  ACTIONS_REF,
  ACTIONS_REPOSITORY,
  ACT_IMAGE,
  CONSUMER_OWNER,
  CONSUMER_PACKAGE,
  CONSUMER_PACKAGE_DIR,
  CONSUMER_REPO,
  CONSUMER_REPOSITORY,
  CONSUMER_URL,
  FEATURE_BRANCH_NAME,
  GITHUB_TOKEN,
  INSTALLATION_TOKEN,
  MAIN_BRANCH_NAME,
  RELEASE_BOT_CLIENT_ID,
  RELEASE_BOT_INSTALLATION_ID,
  RELEASE_BOT_SLUG,
  RELEASE_BOT_USER_ID,
  RELEASE_BRANCH_NAME,
  getAdditionalArgs,
  getEnv,
  getSecrets,
  getVariables,
};
