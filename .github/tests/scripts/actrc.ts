import { generateKeyPairSync } from "node:crypto";

/**
 * One central place for all configuration settings used by `act` during tests.
 *
 * Running GitHub Actions locally with `act` requires fake repositories, mock
 * tokens, simulated GitHub App credentials, command-line arguments, and
 * environment variables. This file defines all those values so test files and
 * mock servers stay in sync without duplicating constants everywhere.
 */

/**
 * The Docker container image that acts as the fake GitHub runner machine.
 *
 * This specific image comes pre-installed with the exact tools our GitHub
 * Actions need to run, including Node 24, git, and jq.
 */
const ACT_IMAGE = "catthehacker/ubuntu:act-latest";

/**
 * The repository name of this actions library (`smashercosmo/actions`).
 *
 * In tests, fake workflow files use this name when writing `uses:
 * smashercosmo/actions/...` steps.
 */
const ACTIONS_REPOSITORY = "smashercosmo/actions";

/**
 * The version tag used in test workflows (e.g. `uses:
 * smashercosmo/actions/...@local`).
 *
 * Normally in real workflows, people pin a version like `@v1` or a commit SHA.
 * But in our tests, we use `@local` so `act` knows to run the action code
 * directly from our local computer instead of trying to download it from
 * GitHub.
 */
const ACTIONS_REF = "local";

/**
 * Information about the fake repository used for testing ("consumer").
 *
 * We simulate a real project that uses our GitHub Actions, located in
 * `fixtures/consumer`.
 */
const CONSUMER_OWNER = "acme";
const CONSUMER_REPO = "consumer";
const CONSUMER_REPOSITORY = `${CONSUMER_OWNER}/${CONSUMER_REPO}`;
/**
 * The fake GitHub URL for our test consumer repository.
 *
 * Git commands in our actions will try to connect to this URL, but we secretly
 * redirect all network traffic to a local folder on your computer so tests
 * never touch the real github.com (see `getEnv` and
 * `create-mock-git-repo.ts`).
 */
const CONSUMER_URL = `https://github.com/${CONSUMER_REPOSITORY}`;

/**
 * The npm package inside our fake repository that we use to test version bumps
 * and package publishing.
 */
const CONSUMER_PACKAGE = "acme-lib";
const CONSUMER_PACKAGE_DIR = "packages/lib";

const MAIN_BRANCH_NAME = "main";
/**
 * The branch name used when pretending a developer opened a feature pull
 * request in tests.
 */
const FEATURE_BRANCH_NAME = "feature";
/**
 * The dedicated branch where the release action commits version bumps and
 * changelog updates before merging them into main.
 */
const RELEASE_BRANCH_NAME = "release";

/**
 * Fake credentials for a simulated GitHub App bot.
 *
 * In real life, an automated GitHub App needs an ID, name slug, and user ID to
 * make commits and open pull requests on your behalf (formatted as
 * `<id>+<slug>[bot]@users.noreply.github.com`). We hardcode fake values here so
 * our tests can check that the bot's identity and commits look right.
 */
const RELEASE_BOT_CLIENT_ID = "Iv23liMockClientId00";
const RELEASE_BOT_SLUG = "release-bot";
const RELEASE_BOT_USER_ID = 12_345_678;
const RELEASE_BOT_INSTALLATION_ID = 87_654_321;

/**
 * The fake default `GITHUB_TOKEN` automatically provided by GitHub Actions to
 * every workflow job.
 */
const GITHUB_TOKEN = "ghs_mockGithubToken";
/**
 * A separate fake token representing the elevated permissions of our GitHub
 * App.
 *
 * We give this token a different string than `GITHUB_TOKEN` so our tests can
 * easily verify whether an action used the basic workflow token or correctly
 * switched to the GitHub App token for privileged operations.
 */
const INSTALLATION_TOKEN = "ghs_mockInstallationToken";

/**
 * A temporary RSA private key generated on the fly for each test run.
 *
 * GitHub Apps must authenticate by creating a signed token (JWT) using a
 * private key. We generate a real RSA key pair here so the `create-token`
 * action produces properly formatted JWT tokens without failing syntax checks.
 */
const RELEASE_BOT_PRIVATE_KEY = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
}).privateKey;

/**
 * Public GitHub Actions from the community that our workflows use (like
 * `actions/checkout`).
 *
 * We list them here so `act` knows to download them publicly without attaching
 * our fake test tokens, which GitHub's real servers would reject.
 */
const THIRD_PARTY_ACTIONS = ["actions/checkout", "pnpm/setup"];

/**
 * Builds the list of command-line flags passed to `act` when running a test.
 *
 * Each flag is wrapped in a small array `[flag, value?]` so we can write a
 * comment above each one explaining why it is needed, before flattening them
 * all into one list.
 */
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
    /**
     * Tells `act` to run any job labeled `runs-on: ubuntu-latest` inside our
     * local Docker image rather than downloading huge official GitHub images.
     */
    ["-P", `ubuntu-latest=${ACT_IMAGE}`],
    /**
     * Prevents `act` from trying to re-download the Docker image from Docker
     * Hub before every single test run if we already have it locally.
     */
    ["--pull=false"],
    /**
     * Forces `act` to actually run the `actions/checkout` step using git.
     *
     * By default, `act` takes a shortcut and just copies files directly from
     * your disk, skipping git checkout entirely. But we need real git checkouts
     * to test how GitHub creates and checks out pull request merge commits.
     */
    ["--no-skip-checkout"],
    /**
     * Tells `act` to reuse previously downloaded actions from its local cache
     * if downloading them fails, allowing tests to run reliably even with flaky
     * internet.
     */
    ["--action-offline-mode"],
    /**
     * Tells `act` to clone public community actions directly from github.com
     * without sending our fake `GITHUB_TOKEN`, preventing GitHub from rejecting
     * the request with an authentication error.
     */
    ...THIRD_PARTY_ACTIONS.map((repository) => [
      "--replace-ghe-action-with-github-com",
      repository,
    ]),
    /**
     * Disables `act`'s built-in caching server since our tests run in isolation
     * and do not use cached dependencies.
     */
    ["--no-cache-server"],
    /**
     * Points `act` to the directory containing our fake consumer repository on
     * disk.
     */
    ["--directory", localRepoDir],
    /** Docker settings applied to every workflow container that `act` spins up. */
    [
      "--container-options",
      [
        /**
         * Shares the fake bare git repository folder on your computer with the
         * Docker container at the exact same file path, so git commands inside
         * Docker find it where they expect.
         */
        `-v ${remoteDir}:${remoteDir}`,
        /**
         * Mounts our test `.npmrc` file directly into `/root/.npmrc` inside the
         * container. This gives `pnpm` the authorization token it needs to talk
         * to our fake Verdaccio package registry.
         */
        `-v ${npmrcFile}:/root/.npmrc`,
        /**
         * Maps the name `host.docker.internal` to the host computer running the
         * test.
         *
         * On Linux, Docker containers cannot talk to services running on the
         * host machine unless this flag is passed. Without it, the
         * containerized action cannot connect to our mock GitHub server or mock
         * npm registry.
         */
        "--add-host=host.docker.internal:host-gateway",
      ].join(" "),
    ],
    /**
     * Tells `act` that whenever a workflow step says `uses:
     * smashercosmo/actions/...@local`, it should look inside our locally staged
     * folder instead of looking on the internet (see `stage-actions-repo.ts`).
     */
    ...localRepositories.map((localRepository) => [
      "--local-repository",
      localRepository,
    ]),
  ].flat();
}

/**
 * Environment variables given to the Docker runner container.
 *
 * These variables trick git, Octokit, and pnpm into talking to our local test
 * servers instead of real external servers on the internet.
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
   * Git configuration rules sent to the container:
   *
   * 1. Whenever git tries to connect to `https://github.com/acme/consumer`,
   *    redirect it locally to our bare git repository folder instead.
   * 2. Mark all directories as "safe" so git does not complain about file
   *    ownership differences between your host user and the container's root
   *    user.
   */
  const gitConfig = [
    [`url.${remoteDir}/${CONSUMER_REPO}.insteadOf`, CONSUMER_URL],
    [
      `url.${remoteDir}/${CONSUMER_REPO}.insteadOf`,
      `https://x-access-token:${INSTALLATION_TOKEN}@github.com/${CONSUMER_REPOSITORY}`,
    ],
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
       * Git lets you define configuration rules via environment variables
       * instead of writing a `.gitconfig` file. `GIT_CONFIG_COUNT` tells git
       * how many key/value pairs to read (`GIT_CONFIG_KEY_0`,
       * `GIT_CONFIG_VALUE_0`, etc.).
       */
      GIT_CONFIG_COUNT: String(gitConfig.length),
      ...Object.fromEntries(
        gitConfig.flatMap(([key, value], index) => [
          [`GIT_CONFIG_KEY_${index}`, key],
          [`GIT_CONFIG_VALUE_${index}`, value],
        ]),
      ),
      /**
       * Tells GitHub tools (like Octokit and the `gh` CLI) to send all API
       * requests to our fake GitHub server running on the host machine.
       */
      GITHUB_API_URL: `http://host.docker.internal:${githubApiPort}`,
      /** The same for GraphQL requests, see `create-github-release` */
      GITHUB_GRAPHQL_URL: `http://host.docker.internal:${githubApiPort}/graphql`,
      /**
       * Tells GitHub Actions which repository it is supposed to be operating on
       * (`acme/consumer`).
       */
      GITHUB_REPOSITORY: CONSUMER_REPOSITORY,
      /**
       * Tells `pnpm` inside Docker to download and publish packages from our
       * fake local Verdaccio registry instead of npmjs.org.
       */
      pnpm_config_registry: `http://host.docker.internal:${registryPort}/`,
    },
  };
}

/**
 * Secret tokens available to workflow steps via `${{ secrets.NAME }}` or `${{
 * github.token }}`.
 */
function getSecrets() {
  return {
    values: {
      /**
       * Forces `act` to use our fake test token instead of accidentally picking
       * up your real personal GitHub CLI login from your computer.
       */
      GITHUB_TOKEN,
      RELEASE_BOT_PRIVATE_KEY,
    },
  };
}

/** Repository variables available to workflow steps via `${{ vars.NAME }}`. */
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
