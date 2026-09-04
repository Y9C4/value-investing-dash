import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Python service. Nothing here is ours to lint, but the virtualenv
    // ships JupyterLab's minified bundles, and ESLint happily reported 60,000
    // problems in them — which is the same as reporting none, because nobody
    // reads that output.
    "api/**",
  ]),
]);

export default eslintConfig;
