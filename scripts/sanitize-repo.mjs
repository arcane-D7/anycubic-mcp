#!/usr/bin/env node
/**
 * sanitize-repo.mjs — keep the repository agnostic: no operator machine paths,
 * no account/printer identity, no LAN addresses.
 *
 * Three rule classes:
 *
 *  1. STRUCTURAL (always on). The current user's home directory is derived at
 *     runtime from `os.homedir()`, so this file contains no hardcoded name and
 *     therefore never leaks the identity it is looking for:
 *       C:\Users\<current user>\AppData\Roaming\AnycubicSlicerNext\log -> %APPDATA%/AnycubicSlicerNext/log
 *       C:\Users\<current user>\Documents\Projects\<repo>            -> <REPO_ROOT>
 *       C:\Users\<current user>\AppData\Roaming                      -> <APPDATA>
 *       C:\Users\<current user>\Documents\Anycubic-Control-Exports   -> <EXPORT_ROOT>
 *       C:\Users\<current user>\...                                  -> <USER_HOME>
 *
 *  2. IDENTITY (opt-in, supplied by the environment). A public repo must not
 *     carry anybody's device key, printer cloud id, LAN address, firmware
 *     build or machine enum. Those values are NOT written in this file; set
 *     them for a run when you want the tree checked against your own account:
 *
 *       ANYCUBIC_SANITIZE_DEVICE_KEY     -> <DEVICE_KEY>
 *       ANYCUBIC_SANITIZE_PRINTER_ID     -> <PRINTER_ID>
 *       ANYCUBIC_SANITIZE_LAN_IP         -> <LAN_IP>
 *       ANYCUBIC_SANITIZE_FW_VERSION     -> <FW_VERSION>
 *       ANYCUBIC_SANITIZE_MACHINE_TYPE   -> <MACHINE_TYPE>
 *       ANYCUBIC_SANITIZE_ACE_MODEL_ID   -> <ACE_MODEL_ID>
 *
 *     Unset variables are reported as INACTIVE in the summary — a green run
 *     never implies a check that did not happen.
 *
 *  3. EVIDENCE (always on, docs/evidence only): 32-hex digests and private LAN
 *     addresses in captured payloads are redacted to <MD5> / <LAN_IP>. The
 *     protocol defaults in vendor/ and schemas/ are NOT identity and stay.
 *
 * Modes:
 *   --dry-run  list per-file replacement counts, write nothing, EXIT 1 on hits
 *   --apply    write the replacements, exit 0
 *
 * Usage:
 *   node scripts/sanitize-repo.mjs --dry-run
 *   node scripts/sanitize-repo.mjs --apply
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const MODE_APPLY = process.argv.includes("--apply");
const USR = path.basename(os.homedir());

const EXTS = new Set([
  ".md",
  ".mjs",
  ".js",
  ".cjs",
  ".json",
  ".html",
  ".yml",
  ".yaml",
  ".ps1",
  ".txt",
  ".jsonl",
]);

// Path segments may appear as `\`, `\\` (JS string escapes in source), or `/`.
const SEP = "[\\\\/]+";

// ---- 1. structural rules (portable, no literal identity) -------------------
const EXACT = [
  [
    new RegExp(
      `C:${SEP}Users${SEP}${USR}${SEP}AppData${SEP}Roaming${SEP}AnycubicSlicerNext${SEP}log`,
      "gi",
    ),
    "%APPDATA%/AnycubicSlicerNext/log",
  ],
  [
    new RegExp(
      `C:${SEP}Users${SEP}${USR}${SEP}Documents${SEP}Projects${SEP}(anycubic-mcp|Anycubic-Bridge-Pluggin)`,
      "gi",
    ),
    "<REPO_ROOT_DBL>",
  ],
  [new RegExp(`C:${SEP}Users${SEP}${USR}${SEP}AppData${SEP}Roaming`, "gi"), "<APPDATA_DBL>"],
  [
    new RegExp(`C:${SEP}Users${SEP}${USR}${SEP}Documents${SEP}Anycubic-Control-Exports`, "gi"),
    "<EXPORT_ROOT_DBL>",
  ],
  [new RegExp(`C:${SEP}Users${SEP}${USR}(?=${SEP})`, "gi"), "<USER_HOME_DBL>"],
];

// ---- 2. identity rules (opt-in via environment) ----------------------------
const IDENTITY_SPEC = [
  ["ANYCUBIC_SANITIZE_DEVICE_KEY", "<DEVICE_KEY>"],
  ["ANYCUBIC_SANITIZE_PRINTER_ID", "<PRINTER_ID>"],
  ["ANYCUBIC_SANITIZE_LAN_IP", "<LAN_IP>"],
  ["ANYCUBIC_SANITIZE_FW_VERSION", "<FW_VERSION>"],
  ["ANYCUBIC_SANITIZE_MACHINE_TYPE", "<MACHINE_TYPE>"],
  ["ANYCUBIC_SANITIZE_ACE_MODEL_ID", "<ACE_MODEL_ID>"],
];

const identityRules = [];
const inactive = [];
for (const [envVar, placeholder] of IDENTITY_SPEC) {
  const raw = (process.env[envVar] ?? "").trim();
  if (!raw) {
    inactive.push(envVar);
    continue;
  }
  identityRules.push([new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), placeholder]);
}

// Normalize the double-backslash placeholders back to plain (runtime-safe) ones
// AFTER the main pass, so JS string escapes like "C:\\Users\\<USER>\\..." become
// "C:/Users/<USER>" without breaking the string literal.
const NORMALIZE = [
  [/<REPO_ROOT_DBL>/g, "<REPO_ROOT>"],
  [/<APPDATA_DBL>/g, "<APPDATA>"],
  [/<EXPORT_ROOT_DBL>/g, "<EXPORT_ROOT>"],
  [/<USER_HOME_DBL>/g, "<USER_HOME>"],
];

// ---- 3. evidence-only rules (always on, docs/evidence) ---------------------
const EVIDENCE_ONLY = [
  // Private LAN addresses in captured payloads (RFC1918).
  [/\b(?:192\.168|10|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/g, "<LAN_IP>"],
  // 32-hex digests are device keys / hashed ids in captures.
  [/[0-9a-f]{32}(?=[^0-9a-f]|$)/gi, "<MD5>"],
];

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist", // generated from vendor/server.mjs by scripts/build.mjs
  "vendor", // frozen upstream bundle: already sanitized, never rewritten
  "poc-output",
  "local-scripts",
  "renders",
  "tests", // fixtures are deliberately synthetic; asserted by the suites
  "target",
]);
const SKIP_FILES = new Set([
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "schemas/openapi.json",
  "schemas/tools.json",
  "ui/cad.html",
  "plugin.json",
  ".mcp.json",
  "README.md",
  "AGENTS.md", // documents the convention with literal examples — must stay readable
  "sanitize-repo.mjs",
  "redact-evidence-json.mjs", // contains the placeholder names as lookup strings
]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (EXTS.has(path.extname(entry.name)) && !SKIP_FILES.has(entry.name)) out.push(full);
  }
  return out;
}

function applyRules(text, rules) {
  let changed = 0;
  let out = text;
  for (const [re, to] of rules) {
    const before = out;
    out = out.replace(re, to);
    if (out !== before) changed++;
  }
  return { changed, out };
}

const EVIDENCE_RE = /(docs[\\/]evidence|poc-output)/i;

const files = walk(ROOT);
let total = 0;
const results = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  let { changed, out } = applyRules(text, EXACT);
  const ident = applyRules(out, identityRules);
  out = ident.out;
  changed += ident.changed;
  for (const [re, to] of NORMALIZE) {
    if (out !== (out = out.replace(re, to))) changed++;
  }
  if (EVIDENCE_RE.test(path.relative(ROOT, file))) {
    const ev = applyRules(out, EVIDENCE_ONLY);
    out = ev.out;
    changed += ev.changed;
  }
  if (!changed) continue;
  total += changed;
  results.push({ file: path.relative(ROOT, file), changed });
  if (MODE_APPLY) fs.writeFileSync(file, out);
}

results.sort((a, b) => b.changed - a.changed);
console.log(
  `[sanitize] ${MODE_APPLY ? "APPLIED" : "DRY-RUN"} — ${results.length} files, ${total} substitution groups touched (usr=${USR})`,
);
if (inactive.length) {
  console.log(
    `[sanitize] identity patterns INACTIVE (set the env var to check your own values): ${inactive.join(", ")}`,
  );
}
for (const r of results) console.log(`  ${String(r.changed).padStart(3)}  ${r.file}`);

if (!MODE_APPLY && results.length) {
  console.error(
    "\n[sanitize] FAIL — operator-machine or account identity found in the tree. " +
      "Run `node scripts/sanitize-repo.mjs --apply`, review the diff, and commit the placeholders.",
  );
  process.exit(1);
}
