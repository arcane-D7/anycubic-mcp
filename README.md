# Anycubic Slicer Next Control — MCP plugin

A local [MCP](https://modelcontextprotocol.io) server that drives **Anycubic Slicer Next**,
Anycubic printers (LAN and cloud account) and a local CAD workspace on Windows. **115 tools**,
exposed over stdio, with a read-only-by-default posture: every write path is gated by an
explicit confirmation and a validated payload.

Everything runs on the operator's machine. There is no hosted service, no telemetry upload and
no bundled printer credentials.

## What it can do

| Area               | Tools (examples)                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| Slicer control     | `inspect_slicer`, `slicer_preflight`, `slicer_slice`, `slicer_export_3mf`, `slicer_profiles`        |
| Printer / LAN MQTT | `printer_lan_handshake`, `printer_lan_read`, `printer_command_send`, `printer_monitor`              |
| Cloud account      | `account_login`, `account_cloud_projects`, `account_print`, `account_print_history`                 |
| Job control        | `start_print`, `print_pause`, `print_resume`, `print_stop`, `set_temperature`, `set_speed_mode`     |
| CAD workspace      | `cad_open_workspace`, `cad_generate_parametric`, `cad_generate_from_prompt`, `cad_v2_boolean`       |
| Consumables        | `spool_register`, `spool_resolve`, `ace_dry`, `ace_auto_feed`, `slot_bind`                          |
| Read-only reads    | `printer_read_all`, `printer_property_catalog`, `printer_capability_catalog`, `printer_diagnostics` |

The full contract is `schemas/tools.json` (also emitted as `schemas/openapi.json`).

## Install as an MCP plugin

Requirements: **Node.js ≥ 22** on Windows, plus a local Anycubic Slicer Next install for the
slicer-driving tools.

```bash
pnpm install
pnpm run build      # vendor/server.mjs -> dist/server.mjs (+ CAD + slicer wiring)
```

`scripts/mcp-entry.mjs` is the entry point. It resolves `dist/server.mjs` relative to itself
(so any working directory works) and runs the build automatically if the bundle is missing.

Register it with an MCP client (`.mcp.json` already contains this shape):

```json
{
  "mcpServers": {
    "anycubic-slicer-next": {
      "command": "node",
      "args": ["<repo>/scripts/mcp-entry.mjs"],
      "env": {
        "ANYCUBIC_ACCESS_CODE": "${env:ANYCUBIC_ACCESS_CODE:}",
        "ANYCUBIC_PRINTER_IPS": "${env:ANYCUBIC_PRINTER_IPS:}",
        "ANYCUBIC_CLOUD_TOKEN": "${env:ANYCUBIC_CLOUD_TOKEN:}",
        "ANYCUBIC_CLOUD_REGION": "${env:ANYCUBIC_CLOUD_REGION:}"
      }
    }
  }
}
```

`plugin.json` is the plugin manifest (name, skills folder, interface copy). `.codex-plugin/plugin.json`
is the same manifest in the Codex plugin layout.

### CLI

The same 115 tools are reachable without any MCP client: `npx anycubic <command>`
(after `pnpm link --global`, the plain `anycubic` command works everywhere).
`anycubic tools`, `anycubic printers [--lan]`, `anycubic status <printer>`,
`anycubic account status`, and the generic `anycubic call <tool> '{...}'`.
Human output by default, `--json` for scripts, `--quiet` for data only; exit codes
0/1/2 (ok / tool error / usage). Token-shaped values are redacted in every mode.
Full reference: `docs/cli.md`.

### Environment variables

| Variable                | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `ANYCUBIC_PRINTER_IPS`  | Comma-separated LAN addresses of printers to talk to directly      |
| `ANYCUBIC_ACCESS_CODE`  | LAN access code for those printers                                 |
| `ANYCUBIC_CLOUD_TOKEN`  | Slicer `access_token` for the cloud lanes (or use the DPAPI store) |
| `ANYCUBIC_CLOUD_REGION` | Cloud region (`en` / `cn`)                                         |

### Cloud auth on Slicer Next 2.0.0.3+

Slicer Next 2.0.0.3 no longer returns a workbench session token from
`/v3/public/loginWithAccessToken` — it answers `code 0, "Failed to get user
info"` for every token. The session exchange is still attempted **first** (older
slicers need it); when the server refuses it at the application level the
**account JWT itself becomes the `XX-Token`**, which the `/v2/*` endpoints
accept. Printer discovery therefore reads `GET /v2/printer/printersStatus` and
keeps `/work/printer/getPrinters` as a fallback. The fallback is never silent:
`account_login` answers `auth_source: "account_jwt"` plus an `auth_reason`, and
the server logs one `[cloud] …` line saying why. Protocol record:
`docs/research/cloud-auth-2026-11-18.md`.

The same decision covers **first install**: `auth_setup` and
`node scripts/auth-login.mjs` share one implementation
(`scripts/cloud-auth-shared.mjs`), so a new user on 2.0.0.3 completes setup
instead of hitting "no token returned from loginWithAccessToken". Their result
carries `auth_source` + `auth_reason`, the log line names the fallback, and the
store records the mode. A transport or HTTP error still fails loudly and stores
nothing.

**Token redaction (behaviour change).** `account_login`, `account_devices` and
`account_files` no longer echo the resolved `XX-Token`; under the fallback that
value is the long-lived account JWT. Pass `include_token: true` to read it,
exactly like `account_token_status`. A client that parsed `token` out of those
results keeps working only after opting in.

### Cloud MQTT needs the operator's TLS identity

`resources/mqtt-tls/` ships **empty** (only a README). Cloud MQTT requires the slicer's
mutual-TLS identity; extract `ca.crt`, `client.crt` and `client.key` into that folder locally.
Nothing in that folder is committed, and `connectMqtt` fails **closed** with
`MQTT_TLS_MATERIAL_MISSING` when the files are absent. LAN MQTT and the read-only cloud HTTP
path work without them. See `resources/mqtt-tls/README.md`.

## Build, test, gate

```bash
pnpm run build          # reproduce dist/server.mjs from the frozen vendor bundle
pnpm run test:unit      # node:test suites (offline, fixture-driven)
pnpm run test:integration   # 3MF round-trip + loopback bridge (offline)
pnpm run smoke          # boots dist/server.mjs over stdio, asserts the 115-tool contract
pnpm run check          # the gate (see below)
```

`pnpm run check` runs, in order:

```
format:check && lint && test:unit && build && smoke && check:licenses && check:architecture && sanitize
```

- `check:licenses` — Apache-2.0/MIT-only policy over the installed dependency graph.
- `check:architecture` — lane isolation (no `apps/`/`crates/` here), frozen-bundle wiring
  integrity, the frozen `ui/cad.html` hash, no private-key material, agnostic paths, and the
  empty `resources/mqtt-tls/` contract.
- `sanitize` — fails on any operator path / account identity left in the tree. Set
  `ANYCUBIC_SANITIZE_*` (see the script header) to also scan your own device values.

`pnpm run knip` reports dead code and dependency drift.

CI runs the same steps (`.github/workflows/health.yml`). A pre-commit hook formats staged files,
re-runs the sanitizer and rejects whitespace errors.

## Layout

```
vendor/server.mjs     frozen base bundle (the shipped server, upstream copy)
scripts/              MCP extension modules + build/gate scripts (71 files)
tests/                unit suites (MCP lane) + integration/ + fixtures/
schemas/              tools.json, openapi.json, machine-profile.schema.json
ui/cad.html           frozen CAD workspace surface (served by cad_open_workspace)
skills/ tools/ presets/ docs/ resources/   supporting assets (see each README)
dist/                 build output — regenerated, never edited
```

## Source provenance

This repository was split out of the `Anycubic-Bridge-Pluggin` monorepo (not public), which still
hosts the editor/slicer application (`apps/editor`, `crates/`).

- Source commit: `Anycubic-Bridge-Pluggin@79d75e9ebafed9f81b0d0351fb15844ba77777cd`
- Import commit: `chore: import MCP plugin from Anycubic-Bridge-Pluggin@79d75e9e`
- History starts at that import; the original history remains in the monorepo.

## License

MIT — see `LICENSE`. Third-party licenses and the dependency policy: `docs/licenses.md`.
