# AGENTS.md — anycubic-mcp

Working agreements for anyone (human or agent) touching this repository.

## What this repo is

The MCP server plugin (`anycubic-slicer-next-control`) that controls Anycubic
Slicer Next, Anycubic printers over LAN (MQTT/FTP) and the Anycubic cloud
account. Imported from `Anycubic-Bridge-Pluggin@79d75e9ebafed9f81b0d0351fb15844ba77777cd`;
the slicer/editor lives in that repo.

## Non-negotiables

- **Agnostic repo.** No operator names, machine paths, LAN IPs, printer IDs,
  account IDs or tokens in code or docs. Environment variables only
  (`ANYCUBIC_*`). `scripts/sanitize-repo.mjs` must stay at 0 hits.
- **Keys are never committed.** `resources/mqtt-tls/` holds the operator-supplied
  MQTT TLS material (extracted from the official Anycubic install) and is
  gitignored; the plugin refuses closed with a typed error when it is missing.
  `check-architecture` rule 5 fails the gate on any `PRIVATE KEY` block.
- **Gate before commit.** `pnpm run check` = format:check, lint, unit tests,
  build, smoke (must report 115 tools), licences, architecture, sanitize
  dry-run. Commit with Conventional Commits; the owner pushes.
- **The bundle is frozen.** `vendor/server.mjs` is the versioned base; `build`
  copies it to `dist/` and appends the CAD wiring. Do not edit `dist/`.
- **Licence truth comes from the installed package**, not from our docs
  (`node_modules/<pkg>/package.json` + its `LICENSE` file). See
  `docs/licenses.md` for the current register, including the reference-only
  rows.
