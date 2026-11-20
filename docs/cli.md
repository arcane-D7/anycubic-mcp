# The `anycubic` CLI — human subcommands over the MCP tool registry

Date: 2026-11-18. One implementation: `scripts/anycubic-cli.mjs`. Tests:
`tests/anycubic-cli.test.mjs`.

The CLI is a first-class surface of this MCP adapter, not a wrapper script that
grew: the package, the CLI and the server share one name and one tool registry.
Every subcommand boots the real server over stdio (the same transport
`scripts/mcp-call.mjs` uses), asks which tools the running build registers, then
calls one of them. **No tool logic is reimplemented here** — when a tool changes,
the CLI follows automatically.

## Install

Prerequisite: Node >= 22 and `pnpm install` in this repository. `dist/server.mjs`
is built on demand by `scripts/mcp-entry.mjs`, so a fresh clone works.

Without installing anything:

```bash
node scripts/anycubic-cli.mjs tools
```

Once `package.json` carries the bin entry (`"bin": { "anycubic": "scripts/anycubic-cli.mjs" }`):

```bash
pnpm install                 # links the bin into node_modules/.bin
pnpm exec anycubic tools     # inside the repo
pnpm link --global           # optional: `anycubic` on PATH everywhere
```

## Usage

```bash
anycubic tools                          # every registered tool, one line each
anycubic call printer_status '{"dev_id":"<DEV_ID>","dev_ip":"<LAN_IP>"}'
anycubic printers                       # printers on the account
anycubic printers --lan                 # LAN discovery instead
anycubic printers --online --json       # machine-readable, online printers only
anycubic status <DEV_ID>@<LAN_IP>       # live LAN status
anycubic account status                 # token metadata — never the token
```

### Subcommand → tool mapping

The tool for each subcommand is resolved against the live registry at runtime
(`listTools`), never assumed. Candidates are tried in order; a build that
registers none of them fails closed with exit 1 instead of calling a name that
may not exist.

| Subcommand         | Tool (resolved from the registry)               | Notes                                                |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------- |
| `tools`            | MCP `listTools`                                 | The registry itself, not a tool                      |
| `call <tool>`      | `<tool>`                                        | Generic escape hatch; validated against the registry |
| `printers`         | `account_devices`, else `discover_printers`     | `--lan` forces `discover_printers` only              |
| `status <printer>` | `printer_status`                                | `dev_id` + `dev_ip`; no access code needed           |
| `account status`   | `account_token_status` (`include_token: false`) | Metadata only                                        |

`status` needs both halves of a printer identity. Three shapes are accepted:

```bash
anycubic status <DEV_ID>@<LAN_IP>
anycubic status <LAN_IP> --id <DEV_ID>
anycubic status <DEV_ID> --ip <LAN_IP>
```

`printers` falls back to LAN discovery only when the account tool is **absent**,
never when it fails: an auth error must surface as an auth error, not as a slow
254-host scan. The failure message points at `anycubic printers --lan`.

### Flags

| Flag                     | Applies to           | Meaning                                       |
| ------------------------ | -------------------- | --------------------------------------------- |
| `--json`                 | all                  | Print the raw tool result as JSON             |
| `--quiet`                | all                  | Data only: no headers, counts or hints        |
| `--lan`                  | `printers`           | Force LAN discovery                           |
| `--online` / `--offline` | `printers`           | Filter the account list (`device_status`)     |
| `--region en\|cn`        | `printers`           | Cloud region for the account list             |
| `--timeout <ms>`         | `printers`, `status` | Tool timeout (caps below)                     |
| `--id`, `--ip`           | `status`             | The printer identity halves                   |
| `--mqtt-port <n>`        | `status`             | LAN MQTT port (default 9883)                  |
| `-h`, `--help`           | all                  | Help; `anycubic <cmd> --help` for one command |

Timeout caps mirror the tools' own schemas: `status` 500–20000 ms, account list
500–30000 ms, LAN discovery 100–15000 ms. Out-of-range values fail before the
server is spawned.

## Output modes

Human by default: aligned tables and labelled lines, kept to 80 columns.
`--json` prints the tool result verbatim (parsed from `structuredContent` or from
the JSON text content), so `jq` can consume it. `--quiet` keeps the data and
drops the chrome, e.g. `tools --quiet` is one tool name per line:

```bash
anycubic tools --quiet | grep '^printer_'
```

`tools --json` prints the registry entries including each input schema — the
only output that is not redacted, because it carries schemas rather than values
and redacting a field name would rename `include_token` inside a schema.

## Exit codes

| Code | Meaning                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------- |
| 0    | Success. `account status` with no stored token is still 0 — that is data                                                  |
| 1    | Tool error: the tool reported failure, the server did not start, the build lacks the tool, or the printer did not answer  |
| 2    | Usage error: unknown command/option, bad JSON arguments, missing printer reference, out-of-range value, unknown tool name |

A printer that does not answer still prints its report and exits 1, so a
monitoring loop can tell "offline" from "the CLI was called wrong".

Examples:

```bash
anycubic tools --quiet >/dev/null || echo "server won't start"
anycubic printers --json | jq -r '.devices[] | select(.online) | .name'
anycubic status <DEV_ID>@<LAN_IP> --json | jq -r '.status.mc_percent'
```

## Security

- **Tokens and credentials are never printed.** Every payload is redacted before
  rendering, in human and `--json` mode alike: any key matching
  `token|secret|password|credential|authorization|cookie|api_key|private_key|access_code|jwt`
  becomes `[redacted]`, and JWT-shaped strings are masked wherever they appear.
  This is defence in depth: the cloud tools no longer return the session token
  at all unless asked (`include_token: true`), and the CLI never asks.
- `account status` asks for `include_token: false` and shows metadata only
  (stored, email, sub, expiry, capture time, source, region). The redaction above
  is the second line of defence, not the first.
- No access code is read from argv — it would land in shell history. The LAN
  status path needs none; `ANYCUBIC_*` env belongs to the server, not the CLI.
- The server's stderr is hidden so stdout is data only; set `ANYCUBIC_CLI_DEBUG=1`
  to see the server log on stderr.
- Docs and code stay agnostic: `<DEV_ID>`, `<LAN_IP>` placeholders only.

## What the tests cover

`node --test tests/anycubic-cli.test.mjs` runs offline. The transport is injected,
so no process is spawned and no network is touched:

- usage, help and `exit 2` paths, including "no service is spawned for a bad
  invocation";
- argument validation: arity, unknown options, JSON shape, printer references,
  port/timeout ranges, mutually exclusive filters;
- registry-driven resolution: `printers` picks `account_devices` or falls back to
  `discover_printers`, `--lan` forces LAN, a build without the tool exits 1;
- output formatting in human and `--json` mode, 80-column tables, redaction
  (including a token returned by a tool and a schema property that must survive),
  offline status exiting 1, empty printer lists.

Live-only (needs a real account or LAN printer, so it is not in the unit suite):
`printers` against the cloud, `status` against a printer, and `account status`
against the operator's token store. These were exercised manually on
2026-11-20: `tools` lists 119 tools (endpoint catalog + ACE tools added);
2026-11-18: `tools` listed 115 tools, `printers` listed one account printer,
`account status` read the stored token metadata, and
`call account_token_status '{"include_token":true}'` printed `token: [redacted]`
with zero JWT-shaped strings in the output.
