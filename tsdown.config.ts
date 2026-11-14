import { defineConfig } from "tsdown";

/**
 * Every action and its entry files: `main`, and `post` when the action has one.
 * A new action has to be added here
 */
const ACTIONS = {
  "create-github-release": ["index.ts"],
  "create-release-pr": ["index.ts"],
  "create-token": ["index.ts", "post.ts"],
} as const;

/**
 * GitHub runs an action straight from this repository, without installing
 * anything, so every action is bundled together with its dependencies into its
 * own `dist`, which is committed. Not minified, so the code that runs can be
 * read and its changes reviewed
 */
export default defineConfig(
  Object.entries(ACTIONS).map(([action, entries]) => ({
    entry: entries.map((entry) => `./${action}/${entry}`),
    outDir: `./${action}/dist`,
    format: ["esm" as const],
    platform: "node" as const,
    /** The Node version the actions run on, `runs.using` in action.yml */
    target: "node24",
    fixedExtension: false,
    clean: true,
    dts: false,
    deps: {
      alwaysBundle: [/.*/v],
      /** Bundling everything is the point, no need for the hint about it */
      onlyBundle: false as const,
    },
  })),
);
