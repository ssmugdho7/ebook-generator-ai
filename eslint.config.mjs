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
    // Generated artifacts:
    "scripts/.cover-bundle.js",
    "scripts/cover-previews/**",
    "src/lib/generated-icons.ts",
    // Python backend: its virtualenv ships bundled JS (Playwright's trace
    // viewer) that would otherwise drown the report in thousands of findings.
    "backend/**",
  ]),
]);

export default eslintConfig;
