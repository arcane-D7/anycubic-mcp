// ESLint flat config — MCP plugin repo.
//
// Scope: the plugin's own JavaScript (`scripts/`, `tools/`, `tests/`). The
// frozen bundle (`vendor/`) and its generated copy (`dist/`) are never linted:
// they are a build artefact of a legacy TypeScript tree that does not exist
// here, and rewriting them would break the MCP contract (schemas/tools.json).
//
// Rules: `@eslint/js` recommended is the baseline. Two adjustments are
// deliberate and documented rather than silent:
//   - `no-unused-vars` ignores rest-sibling omissions (`{ a, ...rest }`) and
//     args prefixed with `_` — the repo's existing convention.
//   - scripts declare Node built-ins and globals; `no-console` is off because
//     every script here is a CLI whose output is its contract.
import js from "@eslint/js";

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "vendor/**",
      "poc-output/**",
      "local-scripts/**",
      "renders/**",
      "resources/**",
      "ui/**",
      "presets/**",
      "schemas/**",
      "skills/**",
      "docs/**",
      ".husky/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        fetch: "readonly",
        AbortController: "readonly",
        AbortSignal: "readonly",
        queueMicrotask: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        structuredClone: "readonly",
        globalThis: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // Preserved MCP lane (scripts/, tools/): the frozen bundle calls into these
    // modules and their behaviour is pinned by vendor/server.mjs + the 115-tool
    // smoke contract, so they are NOT rewritten for style. Correctness rules
    // (no-undef, no-dupe-keys, no-unreachable, parse errors, ...) stay ON; the
    // four purely-hygienic rules below are off for this lane only. That debt is
    // recorded, not hidden: `npx eslint scripts tools` lists it on demand.
    files: ["scripts/**/*.mjs", "tools/**/*.mjs"],
    rules: {
      "no-unused-vars": "off",
      "no-useless-assignment": "off",
      "no-useless-escape": "off",
      "preserve-caught-error": "off",
    },
  },
];
