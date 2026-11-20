# Cloud endpoint catalog — the full 93-route SDK surface (2026-11-18)

**Status:** implementation record. Declarative catalog + typed caller for all 93
cloud endpoints the Slicer Next 2.0.0.3 SDK registers, extracted from
`slicer-binary-surface-2026-11-18.md` §1 (the contiguous `cloud_sdk_cpp.dll`
registration table, offsets 6549640–6552896). **No live call was made from this
lane** — everything is fixture-driven (`tests/cloud-endpoints.test.mjs`, 15
tests, no network).

## What is implemented

- `scripts/cloud-endpoints.mjs` — a leaf module (its only import is `zod`, so
  the frozen bundle can wire it without dragging `mqtt` in):
  - `CLOUD_ENDPOINTS` — 93 frozen entries: `id` (mechanically derived from the
    path), `family`, `method`, `methodEvidence`, `path`, `purpose`, `safety`
    (`read`/`write`/`destructive`), `offset` (the doc's DLL offset, `null`
    where the doc quotes none), `covered`, declared `params` with per-param
    `evidence`, and `notes`.
  - `callEndpoint(client, endpointId, params)` — resolves the entry, validates
    params against a **loose** zod schema (declared params are type-checked;
    undeclared keys pass through, per the repo's no-invented-fields rule),
    refuses `write`/`destructive` calls without `confirm: true` +
    `confirm_word: "EXECUTE"` (meta fields stripped before the wire), dispatches
    GET→`query` / POST→`params` through an **injected** client
    (duck-typed `rawApi(method, path, { params, query })` — `AnycubicCloud`
    already satisfies it), and returns a formatted result with credential-shaped
    keys redacted.
  - Typed errors: `UNKNOWN_ENDPOINT`, `INVALID_CLIENT`, `INVALID_PARAMS`,
    `CONFIRMATION_REQUIRED` (`CloudEndpointError` with `code` + `details`).
  - `summarizeCatalog()`, `getEndpoint()`, `paramSchemaFor()`,
    `redactSensitive()`.

| Count           | Value                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------ |
| Total entries   | 93 (matches the SDK table: v2 20 · v5 17 · work 16 · farm 13 · user 12 · v3 10 · portal 5) |
| Already covered | 23 — routes the repo's connector already exercises                                         |
| New here        | 70                                                                                         |
| Safety classes  | read 50 · write 35 · destructive 8                                                         |
| Methods         | repo-validated 23 · research-doc 4 · inferred 66                                           |

Filament-domain endpoints (the owner's priority), with the contracts the doc
documents:

- `/v3/material/getTypeNameAndSkuListByVerNum` — the catalogue itself;
  `ver_num` (path-name evidence; the server may default to latest).
- `/v5/machine_material/{getColorGroupListByUser,addUserColorGroup,
editUserColorGroup,deleteUserColorGroup}` — the user colour-group write path.
  Param declarations carry the doc's struct fields (`color_group`, `slots`,
  `slot_index`, `material_type/tid/name/unit`) with the §7 caveat: request
  shapes are inferred from struct field names, never live-exercised.
- `/v2/printer/getExternalShelves` — `external_shelves` (DLL 6592848), the
  non-ACE-box material path.
- `/v5/printer/properties/query` — property mirror of the MQTT report tree.
- `/farm/*` — 13 routes; `createBulkTask` params (`filePath`, `taskType`) come
  from the app's own `/api/v1/FramSelectGcodeFile/sendGcodeCreateBulkTask`
  local route.

## The one open classification question

The doc registers the storage/upload resources under `/user/*` (offsets
6550048 / 6550088 / 6550136) while this repo's live-validated upload flow calls
the `/v2/*` twins. Both prefixes are declared; coverage is attributed to the
`/v2` rows (the count math only closes at v2 = 11 new + 9 covered, and the
repo's nine live v2 paths fit exactly). Which prefix the server actually
expects is pending live verification — same uncertainty class the research doc
§7 flags for all `/v5` and `/farm` request shapes.

## What needs live validation (read-only first, filament priority order)

1. `/v3/material/getTypeNameAndSkuListByVerNum` — real payload for `ver_num`
   and the type↔SKU shape.
2. `/v5/machine_material/getColorGroupListByUser` — how groups are stored
   server-side; this defines the edit/delete contract.
3. `/v2/printer/getExternalShelves` — needs the `id` param guessed here.
4. `/v5/printer/properties/query` — parameter contract undocumented.
5. The inferred methods (65 entries) — nothing above a `read` should be called
   live until the method is confirmed.
6. The `/user` vs `/v2` storage prefix question above.

Deletion-class endpoints (`destructive`: 8 of 93 — message deletes, folder
delete, `delFiles`, `unsetprinters`, `unsetprojects`, `deleteUserColorGroup`)
stay behind `confirm_word: "EXECUTE"` and must not be exercised against the
live cloud without a separate, explicit approval.

## Deliberately out of scope (next lane)

- Tool wiring: no CLI/vendor/MCP surface changes here — the catalog is callable
  only from code (`callEndpoint`) until the parent wires it.
- Retirement of the 8 unregistered community paths (research doc §1.3) and the
  `/v2/Printer/status` casing duplicate.
- The auth lane stays in `anycubic-cloud.mjs` / `cloud-auth-shared.mjs`;
  `loginWithAccessToken` is declared in the catalog for completeness but the
  exchange logic does not move here.
