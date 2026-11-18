#!/usr/bin/env node
/**
 * anycubic-cli.mjs — the `anycubic` command line.
 *
 * Every subcommand is a thin resolver over the MCP tool registry: it boots the
 * real server over stdio (the same transport scripts/mcp-call.mjs uses), asks
 * which tools the running build actually registers, calls one of them, and
 * renders the reply for a human. No tool logic is reimplemented here.
 *
 *   anycubic tools                    every registered tool, one line each
 *   anycubic call <tool> [json-args]  generic escape hatch
 *   anycubic printers                 account printer list, LAN fallback
 *   anycubic status <printer>         live LAN status (printer_status)
 *   anycubic account status           token presence + metadata, never the token
 *
 * Output is human-readable by default, `--json` prints the raw tool result and
 * `--quiet` prints data only. Exit codes: 0 ok, 1 tool error, 2 usage error.
 *
 * Security: token-ish keys and JWT-shaped strings are redacted from every
 * payload before it is rendered, in both output modes. The registry listing is
 * the one exception — it carries schemas, not values, and redacting a key
 * would rename a field such as `include_token` in an input schema.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT = Object.freeze({ OK: 0, TOOL_ERROR: 1, USAGE: 2 });

const WIDTH = 80;
const REDACTED = "[redacted]";

// --------------------------------------------------------------------------
// Errors
// --------------------------------------------------------------------------

/** A bad invocation: reported on stderr, exit 2, never reaches the server. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
    this.exitCode = EXIT.USAGE;
  }
}

/** A failure of the server or of the tool itself: exit 1. */
class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ToolError";
    this.exitCode = EXIT.TOOL_ERROR;
  }
}

// --------------------------------------------------------------------------
// Usage and help
// --------------------------------------------------------------------------

const OPTIONS_HELP = `options:
  --json     print the raw tool result as JSON (secrets redacted)
  --quiet    print data only — no headers, counts or hints
  -h, --help show help; with a command, that command's help`;

const USAGE = `anycubic — human subcommands over the Anycubic MCP tool registry

usage:
  anycubic tools                    list registered tools
  anycubic call <tool> [json-args]  call any tool (escape hatch)
  anycubic printers                 account printers, LAN fallback
  anycubic status <printer>         live printer status
  anycubic account status           cloud token metadata (never the token)
  anycubic help [command]           show help

${OPTIONS_HELP}

printer reference:
  <dev_id>@<ip>   both at once, e.g. anycubic status <DEV_ID>@<LAN_IP>
  <ip> --id <dev_id>
  <dev_id> --ip <ip>

exit codes:
  0  ok          1  tool error          2  usage error

The CLI drives the real MCP server over stdio; it does not reimplement tool
logic, and it never prints a token or credential.`;

const HELP = {
  tools: `usage: anycubic tools [--json] [--quiet]

List every tool the server registers: one line per tool, name then a short
description.

  --json   print the registry entries, including each input schema
  --quiet  print tool names only, one per line`,
  call: `usage: anycubic call <tool> [json-args] [--json]

Call one tool with a JSON object argument (default {}). This is the escape
hatch for the tools that have no subcommand yet. The reply is rendered as
readable lines; --json prints it verbatim.

A tool error prints the tool's own message on stderr and exits 1. Secrets in
the reply are redacted in both modes.`,
  printers: `usage: anycubic printers [--lan] [--online|--offline] [--region en|cn] [--timeout ms] [--json]

List printers. The tool is resolved against the live registry: the account list
(account_devices) when it exists, otherwise LAN discovery (discover_printers).

  --lan             force LAN discovery instead of the account list
  --online          account list only: show online printers
  --offline         account list only: show offline printers
  --region en|cn    account region (default: the tool's own default)
  --timeout ms      tool timeout; 30000 max for the account list, 15000 for LAN`,
  status: `usage: anycubic status <printer> [--id <dev_id>] [--ip <ip>] [--mqtt-port n] [--timeout ms] [--json]

Read a printer's live LAN status (printer_status): identity, state, progress,
temperatures. No access code is needed for the signed /info handshake.

  <printer>        <dev_id>@<ip>, or an IP with --id, or a dev_id with --ip
  --mqtt-port n    LAN MQTT port (default 9883)
  --timeout ms     how long to wait for the report (500..20000)

A printer that does not answer still prints its report, and exits 1.`,
  account: `usage: anycubic account status [--json]

Show the stored cloud token metadata: whether one is stored, whose it is
(email / sub), when it expires and when it was captured. The token itself is
never printed and is redacted even if a tool returns it.

Exit 0 with "token: not stored" when there is no token — that is data, not a
failure.`,
};

const SYNTAX = {
  tools: "usage: anycubic tools [--json] [--quiet]",
  call: "usage: anycubic call <tool> [json-args] [--json]",
  printers: "usage: anycubic printers [--lan] [--online|--offline] [--json]",
  status: "usage: anycubic status <printer> [--json]",
  "account status": "usage: anycubic account status [--json]",
};

/** Help text for a command (or the whole usage when the name is unknown). */
export function helpFor(command) {
  if (!command) return USAGE;
  if (command === "account" || command === "account status") return HELP.account;
  return HELP[command] ?? USAGE;
}

function syntaxFor(command) {
  return SYNTAX[command] ?? "run `anycubic --help` for the command list";
}

// --------------------------------------------------------------------------
// Redaction — nothing token-shaped leaves this process
// --------------------------------------------------------------------------

const SECRET_KEY_RE =
  /(token|secret|password|passwd|credential|authorization|cookie|api[-_]?key|private[-_]?key|access[-_]?code|jwt)/i;
const JWT_VALUE_RE = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./;

/** Deep copy of a payload with secret-named keys and JWT-shaped strings masked. */
export function redact(value, seen = new WeakSet()) {
  if (typeof value === "string") return JWT_VALUE_RE.test(value) ? REDACTED : value;
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SECRET_KEY_RE.test(key) ? REDACTED : redact(inner, seen);
    }
    seen.delete(value);
    return out;
  }
  return value;
}

// --------------------------------------------------------------------------
// Argument parsing (all validation happens here, before any spawn)
// --------------------------------------------------------------------------

const DEV_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const HOST_RE = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,62})$/;

function isIpLiteral(value) {
  const parts = String(value).split(".");
  return (
    parts.length === 4 &&
    parts.every(
      (part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && part === String(Number(part)),
    )
  );
}

function validateHost(raw, name) {
  const host = String(raw ?? "").trim();
  if (!host || !HOST_RE.test(host)) {
    throw new UsageError(`${name} expects a host or IPv4 address (got "${raw}")`);
  }
  return host;
}

const VALUE_OPTIONS = {
  "--id": { key: "dev_id", type: "string" },
  "--ip": { key: "dev_ip", type: "host" },
  "--mqtt-port": { key: "mqtt_port", type: "integer", min: 1, max: 65535 },
  "--timeout": { key: "timeout_ms", type: "integer", min: 1, max: 600000 },
  "--region": { key: "region", type: "region" },
};

const BOOLEAN_OPTIONS = {
  "--lan": "lan",
  "--online": "online",
  "--offline": "offline",
};

const ALLOWED_OPTIONS = {
  tools: [],
  call: [],
  printers: ["--lan", "--online", "--offline", "--region", "--timeout"],
  status: ["--id", "--ip", "--mqtt-port", "--timeout"],
  "account status": [],
};

function coerceValue(raw, spec, name) {
  switch (spec.type) {
    case "integer": {
      const number = Number(raw);
      if (!Number.isInteger(number) || number < spec.min || number > spec.max) {
        throw new UsageError(`${name} expects an integer ${spec.min}..${spec.max} (got "${raw}")`);
      }
      return number;
    }
    case "region":
      if (raw !== "en" && raw !== "cn") {
        throw new UsageError(`${name} expects "en" or "cn" (got "${raw}")`);
      }
      return raw;
    case "host":
      return validateHost(raw, name);
    default: {
      const value = String(raw ?? "").trim();
      if (!value) throw new UsageError(`${name} needs a non-empty value`);
      return value;
    }
  }
}

function parseOptions(tokens, command) {
  const allowed = ALLOWED_OPTIONS[command] ?? [];
  const values = {};
  const positionals = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("-") || token === "-") {
      positionals.push(token);
      continue;
    }
    if (!allowed.includes(token)) {
      throw new UsageError(`unknown option ${token} for \`${command}\`\n${syntaxFor(command)}`);
    }
    if (token in BOOLEAN_OPTIONS) {
      values[BOOLEAN_OPTIONS[token]] = true;
      continue;
    }
    const spec = VALUE_OPTIONS[token];
    const raw = tokens[index + 1];
    if (raw === undefined || raw.startsWith("--")) {
      throw new UsageError(`${token} needs a value\n${syntaxFor(command)}`);
    }
    values[spec.key] = coerceValue(raw, spec, token);
    index += 1;
  }
  return { values, positionals };
}

/** Parse `json-args` for `call`; must be a JSON object. */
export function parseJsonArgs(raw) {
  if (raw === undefined) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`json-args is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(
      `json-args must be a JSON object (got ${Array.isArray(parsed) ? "array" : typeof parsed})`,
    );
  }
  return parsed;
}

/**
 * Resolve a printer reference into the dev_id/dev_ip pair printer_status needs.
 * Accepted: `<dev_id>@<ip>`, `<ip> --id <dev_id>`, `<dev_id> --ip <ip>`.
 */
export function parsePrinterRef(ref, flags = {}) {
  const value = String(ref ?? "").trim();
  if (!value) throw new UsageError("status needs a printer reference");
  const at = value.lastIndexOf("@");
  let devId = flags.dev_id;
  let devIp = flags.dev_ip;

  if (at > 0 && at < value.length - 1) {
    const inlineId = value.slice(0, at);
    const inlineIp = value.slice(at + 1);
    if (devId && devId !== inlineId) {
      throw new UsageError(`--id "${devId}" contradicts the reference "${value}"`);
    }
    if (devIp && devIp !== inlineIp) {
      throw new UsageError(`--ip "${devIp}" contradicts the reference "${value}"`);
    }
    devId = inlineId;
    devIp = inlineIp;
  } else if (isIpLiteral(value)) {
    if (devIp && devIp !== value) {
      throw new UsageError(`--ip "${devIp}" contradicts the reference "${value}"`);
    }
    devIp = value;
  } else if (devIp) {
    devId = value;
  } else {
    throw new UsageError(
      `cannot tell what "${value}" is: use <dev_id>@<ip>, an IP with --id, or a dev_id with --ip`,
    );
  }

  if (!devIp) {
    throw new UsageError(`status needs the printer address: anycubic status ${devId}@<LAN_IP>`);
  }
  if (!devId) {
    throw new UsageError(
      `status needs the printer id: anycubic status <dev_id>@${devIp} (or --id)`,
    );
  }
  if (!DEV_ID_RE.test(devId)) {
    throw new UsageError(`"${devId}" is not a printer id (letters, digits, dot, dash, underscore)`);
  }
  return { dev_id: devId, dev_ip: validateHost(devIp, "--ip") };
}

/**
 * Turn argv into an execution plan. Every pure validation lives here so a bad
 * invocation fails before the server is spawned; only registry-dependent
 * resolution (does this build have the tool?) happens later.
 */
export function parseCli(argv) {
  const globals = { json: false, quiet: false, help: false };
  const tokens = [];
  for (const token of argv) {
    if (token === "--json") globals.json = true;
    else if (token === "--quiet") globals.quiet = true;
    else if (token === "--help" || token === "-h") globals.help = true;
    else tokens.push(token);
  }

  const [command, ...rest] = tokens;
  const plan = {
    command: command ?? null,
    json: globals.json,
    quiet: globals.quiet,
    help: globals.help,
    helpTarget: null,
    tool: null,
    args: null,
    printer: null,
    values: {},
    positionals: [],
  };
  if (!command) return plan;

  if (command === "help") {
    if (rest.length > 1) throw new UsageError("help takes at most one command name");
    plan.command = "help";
    plan.helpTarget = rest[0] ?? null;
    if (plan.helpTarget && !HELP[plan.helpTarget] && plan.helpTarget !== "account") {
      throw new UsageError(`unknown command "${plan.helpTarget}"\nrun \`anycubic --help\``);
    }
    return plan;
  }

  if (command === "account") {
    const sub = rest[0];
    if (sub === undefined || sub.startsWith("-")) {
      if (globals.help) {
        plan.command = "account";
        return plan;
      }
      throw new UsageError("account needs a subcommand: anycubic account status");
    }
    if (sub !== "status")
      throw new UsageError(`unknown account subcommand "${sub}" (expected: status)`);
    plan.command = "account status";
    const parsed = parseOptions(rest.slice(1), "account status");
    if (parsed.positionals.length) {
      throw new UsageError(`account status takes no arguments (got "${parsed.positionals[0]}")`);
    }
    plan.values = parsed.values;
    return plan;
  }

  if (!(command in ALLOWED_OPTIONS)) {
    throw new UsageError(
      `unknown command "${command}"\nrun \`anycubic --help\` for the command list`,
    );
  }
  plan.command = command;
  if (globals.help) {
    plan.helpTarget = command;
    return plan;
  }

  const parsed = parseOptions(rest, command);
  plan.values = parsed.values;
  plan.positionals = parsed.positionals;

  if (command === "tools") {
    if (parsed.positionals.length) {
      throw new UsageError(`tools takes no arguments (got "${parsed.positionals[0]}")`);
    }
    return plan;
  }

  if (command === "call") {
    const [tool, argsJson, extra] = parsed.positionals;
    if (!tool) throw new UsageError("call needs a tool name: anycubic call <tool> [json-args]");
    if (extra !== undefined) {
      throw new UsageError(`call takes at most two arguments: <tool> [json-args] (got "${extra}")`);
    }
    if (!/^[a-z0-9_]+$/.test(tool)) {
      throw new UsageError(`"${tool}" is not a tool name (lowercase letters, digits, underscores)`);
    }
    plan.tool = tool;
    plan.args = parseJsonArgs(argsJson);
    return plan;
  }

  if (command === "printers") {
    if (parsed.positionals.length) {
      throw new UsageError(`printers takes no arguments (got "${parsed.positionals[0]}")`);
    }
    if (parsed.values.online && parsed.values.offline) {
      throw new UsageError("--online and --offline are mutually exclusive");
    }
    if ((parsed.values.online || parsed.values.offline) && parsed.values.lan) {
      throw new UsageError(
        "--online/--offline filter the account list and cannot be combined with --lan",
      );
    }
    if (parsed.values.timeout_ms !== undefined) {
      const lan = Boolean(parsed.values.lan);
      const min = lan ? 100 : 500;
      const max = lan ? 15000 : 30000;
      if (parsed.values.timeout_ms < min || parsed.values.timeout_ms > max) {
        throw new UsageError(
          `--timeout for ${lan ? "LAN discovery" : "the account list"} is ${min}..${max} ms`,
        );
      }
    }
    return plan;
  }

  // status
  const [ref, extra] = parsed.positionals;
  if (!ref) {
    throw new UsageError(
      "status needs a printer: anycubic status <dev_id>@<ip> [--id <dev_id>] [--ip <ip>]",
    );
  }
  if (extra !== undefined) throw new UsageError(`status takes one printer (got "${extra}" too)`);
  if (
    parsed.values.timeout_ms !== undefined &&
    (parsed.values.timeout_ms < 500 || parsed.values.timeout_ms > 20000)
  ) {
    throw new UsageError("--timeout for status is 500..20000 ms");
  }
  plan.printer = parsePrinterRef(ref, {
    dev_id: parsed.values.dev_id,
    dev_ip: parsed.values.dev_ip,
  });
  return plan;
}

// --------------------------------------------------------------------------
// Registry resolution — the CLI asks the running server what it has
// --------------------------------------------------------------------------

export const PRINTER_LIST_CANDIDATES = ["account_devices", "discover_printers"];
export const PRINTER_STATUS_CANDIDATES = ["printer_status"];
export const ACCOUNT_STATUS_CANDIDATES = ["account_token_status"];

/** First candidate the live registry actually registers, or null. */
export function resolveTool(candidates, available) {
  const names = new Set(available);
  return candidates.find((name) => names.has(name)) ?? null;
}

function levenshtein(a, b) {
  const left = [...a];
  const right = [...b];
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[right.length];
}

/** Closest registered tool names to a misspelling (up to three). */
export function suggestTools(name, available) {
  const limit = Math.max(2, Math.floor(name.length / 3));
  return available
    .map((candidate) => ({ candidate, distance: levenshtein(name, candidate) }))
    .filter((entry) => entry.distance <= limit)
    .sort(
      (left, right) =>
        left.distance - right.distance || left.candidate.localeCompare(right.candidate),
    )
    .slice(0, 3)
    .map((entry) => entry.candidate);
}

function requireTool(candidates, registry, label) {
  const names = registry.map((tool) => String(tool?.name ?? ""));
  const name = resolveTool(candidates, names);
  if (!name) {
    throw new ToolError(
      `${label}: this server build registers none of ${candidates.join(", ")} — the capability is absent`,
    );
  }
  return name;
}

async function listRegistry(runtime) {
  const listed = await runtime.listTools();
  const tools = Array.isArray(listed) ? listed : (listed?.tools ?? []);
  if (!tools.length) throw new ToolError("the MCP server registered no tools");
  return tools;
}

// --------------------------------------------------------------------------
// Rendering helpers
// --------------------------------------------------------------------------

function visibleLength(text) {
  return String(text).length;
}

function truncate(text, max) {
  const value = String(text ?? "");
  if (max <= 1) return value.slice(0, Math.max(max, 0));
  return visibleLength(value) <= max ? value : `${value.slice(0, max - 1)}…`;
}

function oneLine(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function cellText(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Fixed-width table that never exceeds `maxWidth`: cells are truncated to their
 * column cap, then the widest column is shrunk until the row fits.
 */
export function formatTable(rows, columns, { maxWidth = WIDTH } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return "";
  const header = columns.map((column) => column.label ?? column.key.toUpperCase());
  const lines = [
    header,
    ...rows.map((row) =>
      columns.map((column) => cellText(column.get ? column.get(row) : row[column.key])),
    ),
  ];
  const widths = header.map((_, index) =>
    Math.max(...lines.map((line) => visibleLength(line[index] ?? "")), 4),
  );
  let total = widths.reduce((sum, width) => sum + width, 0) + 2 * (widths.length - 1);
  while (total > maxWidth) {
    let widest = 0;
    for (let index = 1; index < widths.length; index += 1) {
      if (widths[index] > widths[widest]) widest = index;
    }
    if (widths[widest] <= 4) break;
    widths[widest] -= 1;
    total -= 1;
  }
  return lines
    .map((line) =>
      line
        .map((cell, index) => truncate(cell ?? "", widths[index]).padEnd(widths[index]))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

function isFlatRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.values(value);
  return (
    entries.length > 0 && entries.every((entry) => entry === null || typeof entry !== "object")
  );
}

function wrapBlock(text, pad, maxWidth) {
  const room = Math.max(maxWidth - pad.length, 20);
  return String(text)
    .split(/\r?\n/)
    .flatMap((line) => {
      const words = line.split(/\s+/).filter(Boolean);
      if (!words.length) return [pad];
      const out = [];
      let current = "";
      for (const word of words) {
        if (!current) current = word;
        else if (current.length + 1 + word.length <= room) current += ` ${word}`;
        else {
          out.push(current);
          current = word;
        }
      }
      if (current) out.push(current);
      return out.map((entry) => `${pad}${entry}`);
    })
    .join("\n");
}

/**
 * Readable rendering of an arbitrary tool payload: flat objects become tables,
 * nested objects become labelled blocks, everything is depth- and item-capped.
 */
export function renderTree(value, options = {}) {
  const { indent = 0, depth = 0, maxDepth = 5, maxItems = 25, maxWidth = WIDTH } = options;
  const pad = " ".repeat(indent);
  if (value === null || value === undefined) return `${pad}-`;
  if (typeof value === "string") return wrapBlock(value, pad, maxWidth);
  if (typeof value !== "object") return `${pad}${String(value)}`;

  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}(empty)`;
    if (value.every(isFlatRecord)) {
      const keys = [];
      for (const item of value)
        for (const key of Object.keys(item)) if (!keys.includes(key)) keys.push(key);
      const table = formatTable(
        value,
        keys.map((key) => ({ key, label: key.toUpperCase(), maxWidth: 24 })),
        { maxWidth: Math.max(maxWidth - indent, 30) },
      );
      return table
        .split("\n")
        .map((line) => `${pad}${line}`)
        .join("\n");
    }
    const lines = [];
    value.slice(0, maxItems).forEach((item, index) => {
      if (item && typeof item === "object") {
        lines.push(`${pad}[${index}]`);
        lines.push(renderTree(item, { ...options, indent: indent + 2, depth: depth + 1 }));
      } else {
        lines.push(`${pad}[${index}] ${String(item)}`);
      }
    });
    if (value.length > maxItems) lines.push(`${pad}… ${value.length - maxItems} more`);
    return lines.join("\n");
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return `${pad}(empty)`;
  if (depth >= maxDepth) return `${pad}{…}`;
  const lines = [];
  for (const [key, inner] of entries.slice(0, maxItems)) {
    if (inner && typeof inner === "object") {
      lines.push(`${pad}${key}:`);
      lines.push(renderTree(inner, { ...options, indent: indent + 2, depth: depth + 1 }));
      continue;
    }
    if (typeof inner === "string" && /[\r\n]/.test(inner)) {
      lines.push(`${pad}${key}:`);
      lines.push(renderTree(inner, { ...options, indent: indent + 2, depth: depth + 1 }));
      continue;
    }
    const rendered = inner === null || inner === undefined ? "-" : String(inner);
    const line = `${pad}${key}: ${rendered}`;
    if (visibleLength(line) <= maxWidth) {
      lines.push(line.trimEnd());
      continue;
    }
    lines.push(`${pad}${key}:`);
    lines.push(wrapBlock(rendered, `${pad}  `, maxWidth));
  }
  if (entries.length > maxItems) lines.push(`${pad}… ${entries.length - maxItems} more`);
  return lines.join("\n");
}

/** Tool list for humans: aligned names plus a one-line description each. */
export function renderTools(entries, { maxWidth = WIDTH } = {}) {
  const rows = entries ?? [];
  if (!rows.length) return "no tools registered";
  const nameWidth = Math.min(Math.max(...rows.map((entry) => visibleLength(entry.name)), 4), 40);
  const room = Math.max(maxWidth - nameWidth - 2, 16);
  const lines = rows.map((entry) => {
    const description = oneLine(entry.description) || "-";
    return `${truncate(entry.name, nameWidth).padEnd(nameWidth)}  ${truncate(description, room)}`.trimEnd();
  });
  lines.push("");
  lines.push(`${rows.length} tool${rows.length === 1 ? "" : "s"}`);
  return lines.join("\n");
}

/** Boolean-ish printer flag: true/false when the value says so, else null. */
export function normalizeOnline(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : null;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "1", "online", "connected", "on"].includes(text)) return true;
    if (["false", "0", "offline", "disconnected", "off"].includes(text)) return false;
  }
  return null;
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? undefined;
}

/** One printer row, whichever shape the list tool returned. */
export function normalizeDeviceRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    name: firstString(row.name, row.printerName, row.deviceName),
    model: firstString(row.model, row.modelId, row.machine_type, row.machineType, row.type),
    id: firstString(row.key, row.dev_id, row.deviceId, row.id, row.printer_id),
    ip: firstString(row.ip, row.host),
    firmware: firstString(row.firmware, row.version),
    reached: firstString(row.reached),
    online: normalizeOnline(row.online ?? row.deviceStatus ?? row.status ?? row.device_state),
  };
}

/** Printer list: account columns for account_devices, LAN columns otherwise. */
export function renderPrinters(data, { source = "", quiet = false } = {}) {
  if (data && typeof data === "object" && !Array.isArray(data) && data.ok === false) {
    return String(data.error ?? "the tool reported failure");
  }
  const list = Array.isArray(data) ? data : (data?.devices ?? data?.printers);
  if (!Array.isArray(list)) return renderTree(data);
  const printers = list.map(normalizeDeviceRow).filter(Boolean);
  const lines = [];
  if (!printers.length) {
    if (!quiet)
      lines.push(
        source === "discover_printers"
          ? "no printers answered on the LAN"
          : "no printers on the account",
      );
    return lines.join("\n");
  }
  const lan = source === "discover_printers";
  if (!quiet) {
    lines.push(
      `${printers.length} printer${printers.length === 1 ? "" : "s"} (${lan ? "LAN" : "account"})`,
    );
  }
  lines.push(
    lan
      ? formatTable(printers, [
          { key: "ip", label: "IP", maxWidth: 15 },
          { key: "id", label: "DEV_ID", maxWidth: 20 },
          { key: "firmware", label: "FIRMWARE", maxWidth: 12 },
          { key: "reached", label: "VIA", maxWidth: 6 },
          { key: "online", label: "ONLINE", maxWidth: 6 },
        ])
      : formatTable(printers, [
          { key: "name", label: "NAME", maxWidth: 24 },
          { key: "model", label: "MODEL", maxWidth: 18 },
          { key: "id", label: "ID", maxWidth: 18 },
          { key: "online", label: "ONLINE", maxWidth: 6 },
        ]),
  );
  return lines.join("\n");
}

function temperature(actual, target) {
  if (typeof actual !== "number") return null;
  return typeof target === "number" && target > 0 ? `${actual} / ${target} °C` : `${actual} °C`;
}

const STATUS_KNOWN = new Set([
  "online",
  "dev_id",
  "gcode_state",
  "state",
  "mc_percent",
  "speed_lvl",
  "wifi_signal",
  "bed_temper",
  "bed_target_temper",
  "nozzle_temper",
  "nozzle_target_temper",
  "printing_start_time",
  "error",
  "raw",
]);

/** Live status view: identity and state first, then the measurements. */
export function renderStatus(data, { quiet = false } = {}) {
  const status =
    data && typeof data === "object" && data.status && typeof data.status === "object"
      ? data.status
      : (data ?? {});
  const online = status.online === true;
  const lines = [
    `${"printer".padEnd(8)} ${status.dev_id ?? "-"}  ${online ? "online" : "offline"}`,
  ];
  const state = status.gcode_state ?? status.state;
  if (typeof state === "string") lines.push(`${"state".padEnd(8)} ${state}`);
  if (typeof status.mc_percent === "number")
    lines.push(`${"progress".padEnd(8)} ${status.mc_percent}%`);
  const nozzle = temperature(status.nozzle_temper, status.nozzle_target_temper);
  if (nozzle) lines.push(`${"nozzle".padEnd(8)} ${nozzle}`);
  const bed = temperature(status.bed_temper, status.bed_target_temper);
  if (bed) lines.push(`${"bed".padEnd(8)} ${bed}`);
  if (typeof status.speed_lvl === "number")
    lines.push(`${"speed".padEnd(8)} level ${status.speed_lvl}`);
  if (typeof status.wifi_signal === "number")
    lines.push(`${"wifi".padEnd(8)} ${status.wifi_signal} dBm`);
  if (typeof status.printing_start_time === "string" && status.printing_start_time) {
    lines.push(`${"started".padEnd(8)} ${status.printing_start_time}`);
  }
  if (typeof status.error === "string" && status.error)
    lines.push(`${"error".padEnd(8)} ${status.error}`);
  // Anything else the server adds shows up instead of being silently dropped.
  for (const [key, value] of Object.entries(status)) {
    if (STATUS_KNOWN.has(key)) continue;
    if (value === null || typeof value === "object") continue;
    lines.push(`${key.padEnd(8)} ${String(value)}`);
  }
  return quiet ? lines[0] : lines.join("\n");
}

/** Token presence + metadata. The token value is never rendered. */
export function renderAccountStatus(data, { quiet = false } = {}) {
  const record = data && typeof data === "object" ? data : {};
  const stored = record.stored === true;
  const rows = [["token", stored ? "stored" : "not stored"]];
  if (record.email) rows.push(["email", record.email]);
  if (record.sub) rows.push(["sub", record.sub]);
  if (record.expires_at) rows.push(["expires", record.expires_at]);
  if (record.captured_at) rows.push(["captured", record.captured_at]);
  if (record.source) rows.push(["source", record.source]);
  if (record.region) rows.push(["region", record.region]);
  const lines = rows.map(([label, value]) => `${label.padEnd(8)} ${value}`);
  if (!stored && !quiet) {
    lines.push("");
    lines.push("no token: capture one with the account_capture_token tool, then retry");
  }
  return lines.join("\n");
}

/** A tool reply flattened to the payload a renderer should see. */
export function unwrapReply(reply) {
  if (!reply || typeof reply !== "object") return {};
  if (reply.structuredContent !== undefined && reply.structuredContent !== null) {
    return reply.structuredContent;
  }
  const text = Array.isArray(reply.content)
    ? reply.content
        .map((chunk) => (typeof chunk?.text === "string" ? chunk.text : ""))
        .filter(Boolean)
        .join("\n")
    : "";
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorText(reply) {
  const text = Array.isArray(reply?.content)
    ? reply.content
        .map((chunk) => (typeof chunk?.text === "string" ? chunk.text : ""))
        .filter(Boolean)
        .join("\n")
    : "";
  return text || "the tool reported an error without a message";
}

// --------------------------------------------------------------------------
// Transport — the real server, exactly like scripts/mcp-call.mjs
// --------------------------------------------------------------------------

/** Boot dist/server.mjs over stdio and return the three calls the CLI needs. */
export async function connectStdio() {
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
  ]);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./mcp-entry.mjs", import.meta.url))],
    stderr: "pipe",
  });
  // The server logs to stderr. Keep stdout data-only; surface the log on demand.
  if (process.env.ANYCUBIC_CLI_DEBUG && transport.stderr) {
    transport.stderr.on("data", (chunk) => process.stderr.write(chunk));
  }
  const client = new Client({ name: "anycubic-cli", version: "1.0.0" });
  await client.connect(transport);
  return {
    listTools: async () => (await client.listTools())?.tools ?? [],
    callTool: (name, args) => client.callTool({ name, arguments: args }),
    close: () => client.close().catch(() => {}),
  };
}

// --------------------------------------------------------------------------
// Command execution
// --------------------------------------------------------------------------

async function withRuntime(connect, run) {
  let runtime;
  try {
    runtime = await connect();
  } catch (error) {
    throw new ToolError(`cannot start the MCP server: ${error?.message ?? error}`);
  }
  try {
    return await run(runtime);
  } finally {
    try {
      await runtime?.close?.();
    } catch {
      // A close failure must not mask the command result.
    }
  }
}

async function callAndUnwrap(runtime, name, args) {
  let reply;
  try {
    reply = await runtime.callTool(name, args);
  } catch (error) {
    throw new ToolError(`${name}: ${error?.message ?? error}`);
  }
  if (reply?.isError) throw new ToolError(`${name}: ${errorText(reply)}`);
  return unwrapReply(reply);
}

async function runTools(runtime, plan, io) {
  const registry = await listRegistry(runtime);
  if (plan.json) {
    // Raw registry entries: schemas, not values. Redacting here would rename a
    // field such as `include_token` inside an input schema.
    io.out(JSON.stringify(registry, null, 2));
    return EXIT.OK;
  }
  const entries = registry
    .map((tool) => ({
      name: String(tool?.name ?? ""),
      description: String(tool?.description ?? ""),
    }))
    .filter((entry) => entry.name)
    .sort((left, right) => left.name.localeCompare(right.name));
  io.out(plan.quiet ? entries.map((entry) => entry.name).join("\n") : renderTools(entries));
  return EXIT.OK;
}

async function runCall(runtime, plan, io) {
  const registry = await listRegistry(runtime);
  const names = registry.map((tool) => String(tool?.name ?? "")).filter(Boolean);
  if (!names.includes(plan.tool)) {
    const guesses = suggestTools(plan.tool, names);
    const hint = guesses.length ? ` — did you mean ${guesses.join(", ")}?` : "";
    throw new UsageError(`unknown tool "${plan.tool}" (${names.length} registered)${hint}`);
  }
  const data = await callAndUnwrap(runtime, plan.tool, plan.args);
  emit(io, plan, data, (safe) => (typeof safe === "string" ? safe : renderTree(safe)));
  return EXIT.OK;
}

async function runPrinters(runtime, plan, io) {
  const registry = await listRegistry(runtime);
  const candidates = plan.values.lan ? ["discover_printers"] : PRINTER_LIST_CANDIDATES;
  const tool = requireTool(candidates, registry, "printers");
  const args = {};
  if (tool === "account_devices") {
    if (plan.values.online) args.device_status = true;
    if (plan.values.offline) args.device_status = false;
    if (plan.values.region) args.region = plan.values.region;
  }
  if (plan.values.timeout_ms !== undefined) args.timeout_ms = plan.values.timeout_ms;

  let data;
  try {
    data = await callAndUnwrap(runtime, tool, args);
    if (data && typeof data === "object" && !Array.isArray(data) && data.ok === false) {
      throw new ToolError(`${tool}: ${data.error ?? "the tool reported failure"}`);
    }
  } catch (error) {
    if (tool === "account_devices") {
      throw new ToolError(
        `${error.message}\nhint: \`anycubic printers --lan\` lists printers on the LAN`,
      );
    }
    throw error;
  }
  emit(io, plan, data, (safe) => renderPrinters(safe, { source: tool, quiet: plan.quiet }));
  return EXIT.OK;
}

async function runStatus(runtime, plan, io) {
  const registry = await listRegistry(runtime);
  const tool = requireTool(PRINTER_STATUS_CANDIDATES, registry, "status");
  const args = { dev_id: plan.printer.dev_id, dev_ip: plan.printer.dev_ip };
  if (plan.values.mqtt_port !== undefined) args.mqtt_port = plan.values.mqtt_port;
  if (plan.values.timeout_ms !== undefined) args.timeout_ms = plan.values.timeout_ms;

  const data = await callAndUnwrap(runtime, tool, args);
  emit(io, plan, data, (safe) => renderStatus(safe, { quiet: plan.quiet }));

  const status = data && typeof data === "object" ? (data.status ?? data) : {};
  if (status?.online === true) return EXIT.OK;
  io.warn(`printer offline: ${status?.error ?? "no report from the printer"}`);
  return EXIT.TOOL_ERROR;
}

async function runAccountStatus(runtime, plan, io) {
  const registry = await listRegistry(runtime);
  const tool = requireTool(ACCOUNT_STATUS_CANDIDATES, registry, "account status");
  // Explicitly false: the token value is not needed to show its metadata.
  const data = await callAndUnwrap(runtime, tool, { include_token: false });
  if (data && typeof data === "object" && data.ok === false && data.error) {
    throw new ToolError(`${tool}: ${data.error}`);
  }
  emit(io, plan, data, (safe) => renderAccountStatus(safe, { quiet: plan.quiet }));
  return EXIT.OK;
}

/** Redact, then render either raw JSON or the caller's human view. */
function emit(io, plan, data, human) {
  const safe = redact(data);
  if (plan.json) {
    io.out(JSON.stringify(safe, null, 2));
    return;
  }
  const text = typeof safe === "string" ? safe : human(safe);
  if (text) io.out(text);
}

/**
 * Run the CLI and return the exit code. `deps` exists so tests can inject a
 * fake transport; production calls it with nothing and spawns the server.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const {
    connect = connectStdio,
    out = (text) => process.stdout.write(text),
    err = (text) => process.stderr.write(text),
  } = deps;
  const withNewline = (text) => (String(text).endsWith("\n") ? String(text) : `${text}\n`);
  const io = {
    out: (text) => out(withNewline(text)),
    warn: (text) => err(withNewline(text)),
  };

  let plan;
  try {
    plan = parseCli(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      io.warn(error.message);
      return EXIT.USAGE;
    }
    throw error;
  }

  if (!plan.command && !plan.help) {
    io.warn(USAGE);
    return EXIT.USAGE;
  }
  if (!plan.command && plan.help) {
    io.out(USAGE);
    return EXIT.OK;
  }
  if (plan.command === "help") {
    io.out(helpFor(plan.helpTarget));
    return EXIT.OK;
  }
  if (plan.help || plan.command === "account") {
    io.out(helpFor(plan.helpTarget ?? plan.command));
    return EXIT.OK;
  }

  try {
    return await withRuntime(connect, (runtime) => {
      switch (plan.command) {
        case "tools":
          return runTools(runtime, plan, io);
        case "call":
          return runCall(runtime, plan, io);
        case "printers":
          return runPrinters(runtime, plan, io);
        case "status":
          return runStatus(runtime, plan, io);
        case "account status":
          return runAccountStatus(runtime, plan, io);
        default:
          throw new UsageError(`unknown command "${plan.command}"`);
      }
    });
  } catch (error) {
    const code =
      error instanceof UsageError || error instanceof ToolError ? error.exitCode : EXIT.TOOL_ERROR;
    io.warn(error?.message ?? String(error));
    return code;
  }
}

// --------------------------------------------------------------------------
// Entry point (only when executed directly, never when imported by a test)
// --------------------------------------------------------------------------

const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`anycubic: ${error?.stack ?? error}\n`);
      process.exitCode = EXIT.TOOL_ERROR;
    });
}
