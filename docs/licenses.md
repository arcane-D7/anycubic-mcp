# License Policy Registry

> **Policy (binding):** direct use/implementation of a dependency = **Apache-2.0 or
> MIT only**. Every other license (GPL, AGPL, BSD-3, LGPL, MPL, ...) is
> **reference-of-information / comparison / study-only** — its code is never
> copied, imported, linked, adapted or bundled into this repository.
> External-process **prerequisites** (Blender, the Anycubic Slicer Next CLI) are
> **user-installed/discovered**, never bundled; versions and legal notices travel
> with the docs.
>
> Enforcement: `scripts/check-licenses.mjs` fails on any direct dependency whose
> SPDX id is not Apache-2.0/MIT (unless allowlisted dev-only tooling). This page
> is the human-readable half of that registry. Licenses below were read from the
> installed `node_modules/<pkg>/package.json` — the package is the authority, not
> this table.

## How a project may be used

| Classification            | Meaning                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| **Direct (Apache/MIT)**   | Code may be imported, linked, bundled or implemented from.            |
| **Reference-only**        | Studied for algorithms/behavior; code NOT copied. Citations required. |
| **External prerequisite** | User-installed executable/process required at runtime; never bundled. |

## Runtime dependencies

| Package                   | License                 | Allowed use                               | Rationale / citation                                                                                     |
| ------------------------- | ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| @modelcontextprotocol/sdk | MIT                     | Direct                                    | MCP server + client (stdio transport)                                                                    |
| zod                       | MIT                     | Direct                                    | Tool input/output schemas (the 115-tool surface)                                                         |
| mqtt                      | MIT                     | Direct                                    | LAN + cloud MQTT client                                                                                  |
| basic-ftp                 | MIT                     | Direct                                    | LAN file upload to the printer                                                                           |
| pngjs                     | MIT                     | Direct                                    | PNG decode/encode for camera + render tooling                                                            |
| three                     | MIT                     | Direct                                    | CAD workspace renderer (`ui/cad.html`)                                                                   |
| three-mesh-bvh            | MIT                     | Direct                                    | BVH acceleration for the workspace viewport                                                              |
| three-bvh-csg             | MIT                     | Direct                                    | Robust boolean CSG (`cad_v2_boolean`)                                                                    |
| manifold-3d               | Apache-2.0              | Direct                                    | Parametric CAD kernel for `cad_generate_parametric` (WASM, sandboxed)                                    |
| replicad                  | MIT                     | Direct — conversion-only tier             | STEP/OCCT glue for `cad-step-export`; kernel math stays in this repo                                     |
| replicad-opencascadejs    | LGPL-2.1-only           | Conversion-only, optional — never bundled | Bundles OCCT. Loaded lazily and dynamically by `scripts/cad-step-export.mjs` only; graceful STL fallback |
| node-forge                | BSD-3-Clause OR GPL-2.0 | Legacy runtime (allowlisted)              | Used by `scripts/anycubic-cloud.mjs` for cloud PKI certificate parsing — predates the policy             |

## External prerequisites (never bundled)

| Project                  | License     | Why it appears here                                                                                   |
| ------------------------ | ----------- | ----------------------------------------------------------------------------------------------------- |
| Anycubic Slicer Next CLI | proprietary | User-installed; the MCP orchestrates it as a separate process (`scripts/slicer-cli.mjs`)              |
| Blender                  | GPL         | User-installed renderer for `tools/render-headless.mjs`; invoked as an external process, never linked |

## Legacy runtime dependencies (pre-policy, migration tracked)

These entered the preserved MCP root before the license policy was confirmed.
They are **retained** because the frozen bundle (`vendor/server.mjs`) calls into
them, but they are NOT Apache/MIT and must be **migrated or removed** before any
new feature depends on them. `scripts/check-licenses.mjs` allowlists them with
this justification.

| Package                      | License                 | Used in                                                    | Migration plan                                                                                                                     |
| ---------------------------- | ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| node-forge@1.4.0             | BSD-3-Clause OR GPL-2.0 | `scripts/anycubic-cloud.mjs` (cloud PKI cert verification) | Replace with WebCrypto-based verification (no bundled cert parser) when the cloud module is refactored                             |
| replicad-opencascadejs@1.2.1 | LGPL-2.1-only           | `scripts/cad-step-export.mjs` (optional STEP export)       | Already graceful-fallback to STL; keep optional, never a hard dep — migrate to an Apache-2.0 OCCT wrapper if STEP export must stay |

## Protocol evidence that came from outside projects

The Anycubic cloud/LAN protocol was reconstructed from observable behaviour and
from published reverse-engineering projects. Nothing below was copied as code
into this repository; the rows record where the **values** (app ids, order ids,
topic shapes) were learned so the provenance is auditable.

| Project                          | License | Allowed use    | Citation                                                                                                 |
| -------------------------------- | ------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| WaresWichall/hass-anycubic_cloud | GPL-3.0 | Reference-only | Source of the shared slicer identity constants used by `scripts/anycubic-cloud.mjs` and `auth-login.mjs` |
| Nino6689/anycubic-cloud-api      | GPL-3.0 | Reference-only | `AnycubicOrderID` enum values (start/pause/resume/stop print)                                            |

## Direct-use dependency allowlist (dev-only tooling)

Dev-time tools, never shipped in the runtime bundle; allowlisted in
`scripts/check-licenses.mjs` with justification comments:

| Package             | License | Why allowed                 |
| ------------------- | ------- | --------------------------- |
| husky               | MIT     | Git hooks                   |
| lint-staged         | MIT     | Pre-commit formatter runner |
| prettier            | MIT     | Formatter                   |
| eslint / @eslint/js | MIT     | Linting                     |
| knip                | ISC     | Dead-code detection         |

## Rules of thumb

1. A new **runtime** dependency must be Apache-2.0 or MIT — otherwise it is
   reference-only and must never appear in `package.json` dependencies.
2. A dev-only tool that is not Apache/MIT may be added to the allowlist **with a
   justification comment**; the gate will then pass it explicitly.
3. Anything **studied** must get a row here (license + allowed use + citation)
   before its findings are encoded in code or docs.
4. If a license is unknown (`?`), the entry is **reference/verify** until resolved.
