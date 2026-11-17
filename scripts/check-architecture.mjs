#!/usr/bin/env node
/**
 * check-architecture.mjs — SOLID/DRY + split-integrity gate for the MCP plugin.
 *
 * This repository is the standalone MCP half of the Anycubic Bridge split. It
 * owns the frozen server bundle (`vendor/server.mjs`), the extension modules
 * under `scripts/`, the CAD workspace UI (`ui/cad.html`) and the tool schemas.
 * The editor/slicer lane (apps/editor, crates/) lives in the other repository
 * and MUST NOT be referenced from here.
 *
 * Rules:
 *
 *  1. LANE ISOLATION — no `apps/` or `crates/` import specifier anywhere in
 *     scripts/, tools/ or tests/, and neither directory may reappear at the
 *     root. The MCP must be installable on its own.
 *  2. WIRING INTEGRITY — every `../scripts/<file>.mjs` the frozen bundle
 *     imports must exist, and every `register*` symbol the build wires into it
 *     must be exported by that module. A dropped script must fail here, not as
 *     a MODULE_NOT_FOUND at tool-call time.
 *  3. FROZEN CAD UI — `ui/cad.html` is a fixed read-only asset: its SHA-256
 *     must equal the recorded baseline and it may only drive the recorded
 *     `/api/<action>` set.
 *  4. BANNED MARKER — `// DESIGN: duplicated on purpose` is not an excuse.
 *  5. NO KEY MATERIAL — no `-----BEGIN ... PRIVATE KEY-----` block anywhere.
 *     The cloud MQTT identity is operator-supplied (resources/mqtt-tls/README).
 *  6. AGNOSTIC PATHS — no absolute `C:\Users\<real name>` path; placeholders
 *     (`<USER_HOME>`, `%APPDATA%`, `${…}`) are the convention.
 *  7. mTLS FOLDER CONTRACT — `resources/mqtt-tls/` exists, contains only its
 *     README, and `.gitignore` keeps extracted files out of git.
 *
 * Roots scanned: scripts/, tools/, tests/, docs/, plus the ui/ + resources/
 * spot checks in rules 3 and 7. `vendor/` and `dist/` are frozen/generated and
 * are exempt (except as rule-2 subjects).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SCAN_DIRS = ["scripts", "tools", "tests", "docs"];
const SELF = "scripts/check-architecture.mjs";

// Rule 3 — frozen legacy CAD workspace UI (same baseline as the slicer repo).
const FROZEN_UI = {
  file: "ui/cad.html",
  label: "CAD workspace UI (ui/cad.html)",
  baselineSha256: "dfe0ce838d4549ae6fb66b5ec85a94c228b23e1192d4984b66b875babc2db1a9",
  note: "read-only surface served by cad_open_workspace; bump this baseline deliberately",
};

// The exact set of API actions ui/cad.html is allowed to drive.
const FROZEN_UI_ACTIONS = new Set([
  "objects",
  "remove",
  "add",
  "transform",
  "arrange",
  "boolean",
  "import",
  "parametric",
  "ai_prompt",
  "clear",
  "mesh_edit",
  "mesh_sub_delete",
  "mesh_bridge",
  "mesh_add_edge",
  "mesh_fill",
  "mesh_update",
  "select_faces",
  "texture",
  "heightmap",
  "image_to_heightfield",
  "export",
]);

// Rule 2 — symbols the build wires into the bundle, and where they live.
const WIRING = [
  { file: "scripts/cad-bool-tool.mjs", symbol: "registerCadBoolTool" },
  { file: "scripts/cad-parametric-tool.mjs", symbol: "registerCadParametricTool" },
  { file: "scripts/cad-ai-tool.mjs", symbol: "registerCadAiTool" },
  { file: "scripts/slicer-tools.mjs", symbol: "registerSlicerTools" },
  { file: "scripts/presets-tools.mjs", symbol: "registerPresetTools" },
  { file: "scripts/printer-agent-tools.mjs", symbol: "registerAgentTools" },
];

const BANNED_MARKER = "// DESIGN: duplicated on purpose";
const IMPORT_RE = /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/g;
const USER_PATH_RE = /C:[\\/]+Users[\\/]+([A-Za-z0-9._-]+)/g;
const PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
// Windows' own profile directories are not operator identity.
const NON_IDENTIFYING_PROFILES = new Set(["Public", "Default", "All Users", "Default User"]);

const failures = [];

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "node_modules" || entry === "dist" || entry === "target") continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(mjs|cjs|js|ts|tsx|md|html|ps1|json)$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (p) => relative(root, p).replace(/\\/g, "/");

/* ------------------------------------------------------------------ */
/* Rule 1 — lane isolation                                            */
/* ------------------------------------------------------------------ */

for (const dir of ["apps", "crates"]) {
  if (existsSync(join(root, dir))) {
    failures.push(
      `[rule 1] ${dir}/ exists in the MCP repo — the editor/slicer lane belongs to Anycubic-Bridge-Pluggin`,
    );
  }
}

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(root, dir))) {
    if (rel(file) === SELF) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (/(^|\/)apps\//.test(spec) || /(^|\/)crates\//.test(spec)) {
        failures.push(`[rule 1] ${rel(file)} imports "${spec}" from the editor/slicer lane`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rule 2 — wiring integrity                                          */
/* ------------------------------------------------------------------ */

{
  const bundlePath = join(root, "vendor", "server.mjs");
  if (!existsSync(bundlePath)) {
    failures.push("[rule 2] vendor/server.mjs is missing — the frozen bundle is the build base");
  } else {
    const bundle = readFileSync(bundlePath, "utf8");
    const specs = new Set(
      [...bundle.matchAll(/\.\.\/scripts\/([a-z0-9._-]+\.mjs)/g)].map((m) => m[1]),
    );
    for (const name of specs) {
      if (!existsSync(join(root, "scripts", name))) {
        failures.push(
          `[rule 2] vendor/server.mjs imports scripts/${name}, which does not exist in this repo`,
        );
      }
    }
  }
  for (const { file, symbol } of WIRING) {
    const p = join(root, file);
    if (!existsSync(p)) {
      failures.push(`[rule 2] wired module ${file} is missing`);
      continue;
    }
    const src = readFileSync(p, "utf8");
    const exported = new RegExp(
      `export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${symbol}\\b`,
    ).test(src);
    if (!exported) {
      failures.push(`[rule 2] ${file} no longer exports ${symbol} — build wiring would be dead`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rule 3 — frozen CAD UI                                             */
/* ------------------------------------------------------------------ */

{
  const frozenPath = join(root, FROZEN_UI.file);
  if (!existsSync(frozenPath)) {
    failures.push(`[rule 3] ${FROZEN_UI.file} missing — cannot verify the frozen surface`);
  } else {
    const src = readFileSync(frozenPath, "utf8");
    const actual = sha256(src);
    if (actual !== FROZEN_UI.baselineSha256) {
      failures.push(`[rule 3] ${FROZEN_UI.label} changed (sha256 ${actual}) — ${FROZEN_UI.note}`);
    }
    const actions = new Set();
    for (const matches of [
      src.matchAll(/\bapi\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']/g),
      src.matchAll(/\/api\/([a-zA-Z_][a-zA-Z0-9_]*)/g),
    ]) {
      for (const m of matches) actions.add(m[1]);
    }
    for (const action of actions) {
      if (!FROZEN_UI_ACTIONS.has(action)) {
        failures.push(`[rule 3] ${FROZEN_UI.label} drives undocumented API action "${action}"`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rules 4-6 — markers, key material, agnostic paths                  */
/* ------------------------------------------------------------------ */

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(root, dir))) {
    const r = rel(file);
    const src = readFileSync(file, "utf8");

    if (src.includes(BANNED_MARKER) && r !== SELF) {
      failures.push(`[rule 4] ${r}: banned duplicate-on-purpose marker`);
    }

    if (PRIVATE_KEY_RE.test(src)) {
      failures.push(
        `[rule 5] ${r}: contains a PRIVATE KEY block — the cloud MQTT identity is operator-supplied, never committed`,
      );
    }

    for (const m of src.matchAll(USER_PATH_RE)) {
      const name = m[1];
      const placeholder =
        name.startsWith("<") ||
        name.startsWith("%") ||
        name.startsWith("$") ||
        name.startsWith("{");
      if (!placeholder && !NON_IDENTIFYING_PROFILES.has(name)) {
        failures.push(`[rule 6] ${r}: absolute path with a real user name ("${name}")`);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rule 7 — mTLS folder contract                                      */
/* ------------------------------------------------------------------ */

{
  const tlsDir = join(root, "resources", "mqtt-tls");
  if (!existsSync(tlsDir)) {
    failures.push(
      "[rule 7] resources/mqtt-tls/ is missing — scripts/anycubic-cloud.mjs resolves that path",
    );
  } else {
    const entries = readdirSync(tlsDir).sort();
    const unexpected = entries.filter((f) => f !== "README.md");
    if (unexpected.length) {
      failures.push(
        `[rule 7] resources/mqtt-tls/ contains ${unexpected.join(", ")} — only README.md may be committed`,
      );
    }
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    if (!/^resources\/mqtt-tls\/\*/m.test(ignore)) {
      failures.push("[rule 7] .gitignore no longer ignores resources/mqtt-tls/*");
    }
  }
}

if (failures.length) {
  console.error("[check-architecture] FAIL");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("[check-architecture] OK — lane isolation, wiring, frozen UI, key material, paths.");
