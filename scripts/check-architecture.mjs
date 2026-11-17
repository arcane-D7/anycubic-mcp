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
 *  5. NO KEY MATERIAL — no `-----BEGIN ... PRIVATE KEY-----` block anywhere
 *     except where ARCHITECTURE_EXCEPTIONS says so (see below). The cloud
 *     MQTT identity is operator-supplied by default (resources/mqtt-tls/README).
 *  6. AGNOSTIC PATHS — no absolute `C:\Users\<real name>` path; placeholders
 *     (`<USER_HOME>`, `%APPDATA%`, `${…}`) are the convention.
 *  7. mTLS FOLDER CONTRACT — `resources/mqtt-tls/` exists, contains only its
 *     README, and `.gitignore` keeps extracted files out of git.
 *
 * EXCEPTIONS — every rule that reports a path-bearing violation can be
 * relaxed for one path through `scripts/architecture-exceptions.mjs`. An
 * exception is a decision: it carries a written reason, it is printed on
 * every green run, and an exception that never matches anything fails the
 * check so the list cannot rot.
 *
 * Roots scanned: scripts/, tools/, tests/, docs/, plus the ui/ + resources/
 * spot checks in rules 3 and 7. `vendor/` and `dist/` are frozen/generated and
 * are exempt (except as rule-2 subjects).
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARCHITECTURE_EXCEPTIONS,
  applyArchitectureExceptions,
} from "./architecture-exceptions.mjs";

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

const violations = [];
const fail = (rule, path, message) => {
  violations.push({ rule, path, message });
};

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
    fail(1, `${dir}/`, "the editor/slicer lane belongs to Anycubic-Bridge-Pluggin");
  }
}

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(root, dir))) {
    if (rel(file) === SELF) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (/(^|\/)apps\//.test(spec) || /(^|\/)crates\//.test(spec)) {
        fail(1, rel(file), `imports "${spec}" from the editor/slicer lane`);
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
    fail(2, null, "vendor/server.mjs is missing — the frozen bundle is the build base");
  } else {
    const bundle = readFileSync(bundlePath, "utf8");
    const specs = new Set(
      [...bundle.matchAll(/\.\.\/scripts\/([a-z0-9._-]+\.mjs)/g)].map((m) => m[1]),
    );
    for (const name of specs) {
      if (!existsSync(join(root, "scripts", name))) {
        fail(2, `scripts/${name}`, "the frozen bundle imports it, but it is not in this repo");
      }
    }
  }
  for (const { file, symbol } of WIRING) {
    const p = join(root, file);
    if (!existsSync(p)) {
      fail(2, file, "wired module is missing");
      continue;
    }
    const src = readFileSync(p, "utf8");
    const exported = new RegExp(
      `export\\s+(?:async\\s+)?(?:function|const|let|var)\\s+${symbol}\\b`,
    ).test(src);
    if (!exported) {
      fail(2, file, `no longer exports ${symbol} — build wiring would be dead`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rule 3 — frozen CAD UI                                             */
/* ------------------------------------------------------------------ */

{
  const frozenPath = join(root, FROZEN_UI.file);
  if (!existsSync(frozenPath)) {
    fail(3, FROZEN_UI.file, "missing — cannot verify the frozen surface");
  } else {
    const src = readFileSync(frozenPath, "utf8");
    const actual = sha256(src);
    if (actual !== FROZEN_UI.baselineSha256) {
      fail(3, FROZEN_UI.file, `changed (sha256 ${actual}) — ${FROZEN_UI.note}`);
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
        fail(3, FROZEN_UI.file, `drives undocumented API action "${action}"`);
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
      fail(4, r, "banned duplicate-on-purpose marker");
    }

    if (PRIVATE_KEY_RE.test(src)) {
      fail(5, r, "contains a PRIVATE KEY block — relax only through ARCHITECTURE_EXCEPTIONS");
    }

    for (const m of src.matchAll(USER_PATH_RE)) {
      const name = m[1];
      const placeholder =
        name.startsWith("<") ||
        name.startsWith("%") ||
        name.startsWith("$") ||
        name.startsWith("{");
      if (!placeholder && !NON_IDENTIFYING_PROFILES.has(name)) {
        fail(6, r, `absolute path with a real user name ("${name}")`);
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
    fail(7, null, "resources/mqtt-tls/ is missing — scripts/anycubic-cloud.mjs resolves that path");
  } else {
    // Rule 7 guards GIT, not the operator's disk: locally extracted identity
    // sitting in the folder is fine, committed identity is not. Hence
    // `git ls-files` — what is tracked is what would leak.
    const listed = spawnSync("git", ["ls-files", "resources/mqtt-tls"], {
      cwd: root,
      encoding: "utf8",
    });
    const tracked = listed.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((p) => p.replace(/^resources\/mqtt-tls\//, ""))
      .sort();
    for (const f of tracked.filter((f) => f !== "README.md")) {
      // One violation per file, so an exception can target a single name.
      fail(7, `resources/mqtt-tls/${f}`, "only README.md may be committed");
    }
    const ignore = readFileSync(join(root, ".gitignore"), "utf8");
    if (!/^resources\/mqtt-tls\/\*/m.test(ignore)) {
      fail(7, ".gitignore", ".gitignore no longer ignores resources/mqtt-tls/*");
    }
  }
}

// Apply the programmable exceptions, with the anti-rot guarantees: an
// exception that matches nothing fails, a duplicate fails, and every applied
// exception is printed with its written reason.
const { remaining, applied, unused, duplicates } = applyArchitectureExceptions(
  violations,
  ARCHITECTURE_EXCEPTIONS,
);

for (const exception of duplicates) {
  console.error(
    `[exceptions] DUPLICATE rule ${exception.rule} for ${exception.pathPrefix ?? exception.path} — keep one entry`,
  );
}
for (const exception of unused) {
  console.error(
    `[exceptions] UNUSED rule ${exception.rule} for ${exception.pathPrefix ?? exception.path} — ` +
      `nothing matched ("${exception.reason}"). Delete the entry or fix the path.`,
  );
}
for (const entry of applied) {
  console.log(
    `[exceptions] rule ${entry.rule} relaxed for ${entry.path} ` +
      `(${entry.violations} violation(s)) — ${entry.reason}`,
  );
}

if (duplicates.length > 0 || unused.length > 0 || remaining.length > 0) {
  console.error("[check-architecture] FAIL");
  for (const v of remaining)
    console.error(`  - [rule ${v.rule}] ${v.path ?? "(repo)"}: ${v.message}`);
  if (duplicates.length > 0) console.error(`  - ${duplicates.length} duplicate exception(s)`);
  if (unused.length > 0) console.error(`  - ${unused.length} unused exception(s)`);
  process.exit(1);
}
console.log(
  "[check-architecture] OK — lane isolation, wiring, frozen UI, key material, paths." +
    (applied.length > 0 ? ` ${applied.length} documented exception(s) applied.` : ""),
);
