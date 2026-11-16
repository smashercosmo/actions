# Shared helpers

Helpers for the actions in this repository. This directory is not an action: it has no `action.yml` and is never run on its own. An action imports what it needs, and the runner runs both as they are (see [Development](../README.md#development)).

The helpers stand in for the `@actions/core`, `@actions/exec`, `@actions/github` and `@octokit/auth-app` packages and for zod, covering only what the actions here use.

## Why not the packages

GitHub runs an action straight from this repository, without installing its dependencies. With packages from npm, every action had to be bundled together with them and the bundle committed: `@actions/core` and `@actions/github` alone brought an HTTP client along that added about 670 kB to every bundle, even to an action that never makes a request.

The helpers use nothing but Node.js built-ins, so the actions have no runtime dependencies and need no bundle: the runner runs their TypeScript as it is, and the code that runs is the code that's reviewed.

## Usage

Import from the module you need, through the `#shared/*` alias in the `imports` field of `package.json` (the lint rules don't allow `../` imports). Imports name the `.ts` file, as Node.js runs the TypeScript as it is and doesn't map `.js` imports to `.ts` files.

```ts
import { createAppJwt } from "#shared/app-jwt.ts";
import { getInput, info, setFailed, setOutput } from "#shared/core.ts";
import { exec, getExecOutput } from "#shared/exec.ts";
import { hasFileChanged, hasTag, isCommit, listFiles } from "#shared/git.ts";
import { createGitHubClient, getRepository } from "#shared/github.ts";
import { array, number, object, parse, string, url } from "#shared/schema.ts";
```

`git` runs Git through `exec`, and `github` validates responses with `schema`. Otherwise the modules don't depend on each other.

## `core`

Reads the action's inputs and talks to the runner.

| Function                              | Description                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `getInput(name, { required })`        | Returns the input with whitespace trimmed, or an empty string if it isn't set. Throws if `required` and empty.         |
| `getBooleanInput(name, { required })` | Returns the input as a boolean. Accepts `true`, `True`, `TRUE`, `false`, `False`, `FALSE` and throws on anything else. |
| `setOutput(name, value)`              | Sets an output of the action. Accepts a string, a number or a boolean.                                                 |
| `saveState(name, value)`              | Saves a value for the action's `post` step.                                                                            |
| `getState(name)`                      | Returns a value saved with `saveState`, or an empty string.                                                            |
| `setSecret(secret)`                   | Makes the runner mask the value in the logs.                                                                           |
| `info(message)`                       | Prints a message to the log.                                                                                           |
| `debug(message)`                      | Prints a message that is shown only when step debug logging is enabled.                                                |
| `warning(message)`                    | Prints a message and adds it to the run as a warning annotation.                                                       |
| `setFailed(message)`                  | Adds the message to the run as an error annotation and sets the exit code to 1.                                        |

```ts
try {
  const token = getInput("token", { required: true });

  setSecret(token);
  setOutput("pr-number", 42);
} catch (error) {
  setFailed(error instanceof Error ? error.message : String(error));
}
```

Differences from `@actions/core`:

- `getInput` treats a required input that contains only whitespace as missing.
- `setOutput` and `saveState` throw if the runner didn't provide `GITHUB_OUTPUT` or `GITHUB_STATE`, rather than falling back to the deprecated `::set-output` and `::save-state` commands.
- Messages are strings, and annotations have no properties such as a file or a line.

## `exec`

Runs commands.

| Function                                    | Description                                                |
| ------------------------------------------- | ---------------------------------------------------------- |
| `exec(commandLine, args, options)`          | Runs a command and returns its exit code.                  |
| `getExecOutput(commandLine, args, options)` | Runs a command and returns `{ exitCode, stdout, stderr }`. |

| Option             | Description                                        |
| ------------------ | -------------------------------------------------- |
| `silent`           | Don't print the command and its output to the log. |
| `ignoreReturnCode` | Return a non-zero exit code rather than throw.     |
| `input`            | Data to write to the command's stdin.              |

```ts
exec("git", ["switch", "-C", branch]);

const { stdout } = getExecOutput("git", ["rev-parse", "HEAD"], {
  silent: true,
});
```

The command is run directly, not in a shell, so `args` are passed as they are and need no escaping.

`commandLine` can include arguments, which come before `args`. This is what lets an action run a command it got as an input, such as `pnpm exec oxfmt`. Arguments are separated by spaces, double quotes keep the spaces inside them, and `\"` inside the quotes is a literal quote.

Both functions throw if the command can't be started, exits with a non-zero code (unless `ignoreReturnCode` is set), or is terminated by a signal.

Both are synchronous: they wait for the command to finish, which is all the actions need, as none runs commands side by side. Unless `silent` is set, the command is printed to the log before it runs, and its output once it has finished, stdout first, then stderr. A command that prints more than 1 MB is stopped and fails (Node.js's `maxBuffer`), far more than any command of the actions prints.

Differences from `@actions/exec`:

- Only the three options above are supported.
- The functions are synchronous, and the output appears in the log once the command has finished, not as it's printed.
- Stdin is closed when there's no `input`, so a command that reads it doesn't wait forever.
- A command terminated by a signal always throws, even with `ignoreReturnCode`.
- The log shows the command as it was given, not the full path to it.
- Windows runners aren't supported: commands that are `.cmd` files there, such as `pnpm`, aren't found.

## `git`

Asks Git about the repository in the current directory. Each function wraps a single Git command and gives it a name that says what it's for.

| Function                              | Description                                                                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `isCommit(rev)`                       | Tells whether `rev` names a commit that exists locally. For a commit that may be missing, e.g. after a force-push or in a shallow clone. |
| `hasTag(tag)`                         | Tells whether the tag exists locally. A checkout has to fetch the tags first.                                                            |
| `getEmptyTreeId()`                    | Returns the ID of the empty tree, which stands in for the parent of the first commit.                                                    |
| `listFiles(rev, directory)`           | Lists what's directly in `directory` in the commit `rev`, regardless of the working tree.                                                |
| `hasFileChanged(from, to, file)`      | Tells whether `file` differs between two commits.                                                                                        |
| `listAddedFiles(from, to, pathspecs)` | Lists the files added between two commits that match the pathspecs.                                                                      |
| `listStagedFiles()`                   | Lists the files staged for the next commit, except the deleted ones.                                                                     |
| `findLastCommitChanging(text, file)`  | Finds the most recent commit that added or removed `text` in `file`, or returns `undefined`.                                             |

```ts
if (hasFileChanged("HEAD^1", "HEAD", ".changeset/ledger.yaml")) {
  info("The ledger has changed");
}

const intents = listAddedFiles("HEAD^1", "HEAD", [".changeset/*.md"]);
```

The functions that list paths run Git with `-z`, so paths with spaces, line breaks or non-ASCII characters come back as they are.

`hasFileChanged`, `listAddedFiles` and `listStagedFiles` compare with Git's rename detection on, its default: a file added with the same content as one deleted counts as a rename, not an addition.

The functions throw if Git fails, e.g. on a commit that doesn't exist, except `isCommit` and `hasTag`, which answer `false` then.

## `github`

Makes requests to the GitHub API.

| Function                                   | Description                                                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `getRepository()`                          | Returns the `{ owner, repo }` of the repository the workflow runs in, from `GITHUB_REPOSITORY`. |
| `createGitHubClient({ token, userAgent })` | Returns a client with `request` for the REST API.                                               |

```ts
const { owner, repo } = getRepository();
const github = createGitHubClient({ token, userAgent: "create-release-pr" });

const PullRequestSchema = object({ number: number(), html_url: url() });

const pulls = await github.request(
  {
    method: "GET",
    path: `/repos/${owner}/${repo}/pulls`,
    searchParams: { head: `${owner}:${branch}`, state: "open" },
  },
  array(PullRequestSchema),
);

const created = await github.request(
  {
    method: "POST",
    path: `/repos/${owner}/${repo}/pulls`,
    body: { title, head: branch, base },
  },
  PullRequestSchema,
);
```

`request` accepts `GET`, `POST`, `PATCH` and `DELETE`. The schema (see [`schema`](#schema)) is where the type of the result comes from: the response is validated against it, and a response that doesn't match throws. Leave the schema out for an endpoint that responds with no content:

```ts
await github.request({ method: "DELETE", path: "/installation/token" });
```

`request` throws if the response isn't a success.

The API is looked for at `GITHUB_API_URL`, which the runner sets, falling back to GitHub.com.

Differences from `@actions/github`:

- There are no methods per endpoint and no response types from Octokit: the path and the schema are written out.
- Requests don't go through a proxy, which only matters on self-hosted runners behind one.
- There's no `context` apart from `getRepository`.

## `schema`

Checks that a value from outside the action, such as an API response or the JSON output of a command, has the shape the action expects, and types it. It replaces zod, a runtime dependency the actions can't have.

| Function                            | Accepts                                                                                |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `string()`, `number()`, `boolean()` | A value of that type.                                                                  |
| `url()`                             | A string that is an absolute URL.                                                      |
| `array(item)`                       | An array of which every item matches `item`.                                           |
| `object(shape)`                     | An object with the properties of `shape`. Other properties are left out of the result. |
| `optional(schema)`                  | `undefined`, e.g. a missing property, as well.                                         |

`parse(schema, value, label)` checks a value and returns it typed, or throws an error that starts with `label` and tells where the value is wrong:

```ts
const PackagesSchema = array(
  object({ name: string(), version: optional(string()) }),
);

const packages = parse(PackagesSchema, JSON.parse(stdout), "`pnpm ls --json`");
// `pnpm ls --json` returned an unexpected value: expected a string at [0].name, got a number
```

The error tells the type of a wrong value but not the value itself, which may be a secret, such as a token in an API response.

`Infer<typeof schema>` is the type of what a schema returns, and `Input<typeof schema>` the type of the values it accepts. They differ e.g. for an `optional` property of an `object`, which may be missing from what the schema accepts but is always in what it returns, as `undefined`. `Input` exists for types only, there's nothing of it at runtime.

`Input` is what lets a type test check a schema against the type of what it's for, e.g. that everything GitHub documents an endpoint to respond with is accepted. `GitHubResponse<"GET /users/{username}">` (from `github-response.ts`, types only) is that documented type, as `JSON.parse` returns it:

```ts
expectTypeOf<GitHubResponse<"GET /users/{username}">>().toExtend<
  Input<typeof UserSchema>
>();
```

See [Checks against GitHub and pnpm](#checks-against-github-and-pnpm) for where the actions do this.

Differences from zod:

- `parse` stops at the first problem instead of collecting all of them.
- There are no defaults, refinements or transforms: the checks the actions need are the ones above.

## `app-jwt`

`createAppJwt({ clientId, privateKey })` creates the JSON Web Token that authenticates as a GitHub App itself, for the requests that come before an installation token exists, such as creating one:

```ts
const github = createGitHubClient({
  token: createAppJwt({ clientId, privateKey }),
  userAgent: "create-token",
});
```

The token is signed with the private key of the app (RS256) and is valid for 10 minutes, the most GitHub accepts. It's issued 30 seconds in the past, as GitHub rejects a token issued in the future and the clock of the runner can be ahead of GitHub's.

The private key can be in either format GitHub has generated keys in (PKCS#1 or PKCS#8), and its line breaks can be escaped as `\n`, as they are in a key stored as a single line.

Differences from `@octokit/auth-app`:

- It creates the app token only, not installation or user tokens.
- It doesn't retry when GitHub rejects the token because the clocks differ by more than 30 seconds. `@octokit/auth-app` retries only inside its own Octokit request hook, which the actions here never used.

## Tests

```bash
pnpm test
```

Each module has a `*.spec.ts` file next to it. The tests need only Node.js, Git and pnpm: commands are real processes, files and Git repositories are created in a temporary directory, and `fetch` is replaced, so no request leaves the machine.

## Checks against GitHub and pnpm

The schemas of the actions are in a `schemas.ts` next to each action. They're written by hand, so tests check them against the real thing, and fail when GitHub or pnpm change what they answer with:

| What                           | Checked against                                             | How                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| GitHub REST API responses      | GitHub's OpenAPI description (`@octokit/types`)             | Type tests (`schemas.spec-d.ts`): everything GitHub documents an endpoint to respond with has to be accepted by the schema. |
| `pnpm version -r --json`       | pnpm's `PlannedRelease` type (`@pnpm/releasing.versioning`) | Type tests: what pnpm prints has to be accepted, and what the schema returns has to match pnpm's types.                     |
| `pnpm ls -r --depth -1 --json` | The real pnpm                                               | Runs pnpm on a copy of the workflow tests' fixture workspace and parses its output.                                         |
| Git                            | The real Git                                                | The tests of `git.ts` run Git on temporary repositories.                                                                    |

Vitest runs the type tests too (its `typecheck` option), reporting each type error as a failed test, and `pnpm lint:types` type-checks them like the rest of the code. The packages with the types are dev dependencies, which the tests import but the actions never do.
