import baseConfig from "@smashercosmo/configs/oxlint";
import { defineConfig } from "oxlint";

export default defineConfig({
  ...baseConfig,
  env: { node: true },
  rules: {
    ...baseConfig.rules,
    /** We don't need for our GitHub Actions to be commonjs compatible */
    "node/no-top-level-await": "off",
    /** It's totally fine to use sync methods in GitHub Actions */
    "node/no-sync": "off",
  },
  options: {
    typeAware: true,
  },
});
