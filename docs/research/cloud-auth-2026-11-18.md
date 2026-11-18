# Cloud auth lane change in Anycubic Slicer Next 2.0.0.3 (2026-11-18)

**Status:** protocol research record. The fix it describes is versioned in
`vendor/server.mjs` (the MCP bundle) and `scripts/anycubic-cloud.mjs` (the
CLI/diagnostics client), with fixture-based tests. **No live-credential test was
run in this repository** — see [What is not verified](#what-is-not-verified).

**Source:** reported by an external user's agent on 2026-11-18, diagnosed against
an installed Anycubic Slicer Next 2.0.0.3. Everything below comes from that
report; the diagnosis and the 16-combination matrix are theirs, the
implementation in this repo is ours. No account identifiers, printer IDs or
tokens are reproduced here — placeholders only.

## What changed

Slicer Next 2.0.0.3 broke the workbench session exchange that every community
client of the Anycubic cloud relied on:

1. **`POST /v3/public/loginWithAccessToken` no longer returns a session token.**
   For every token it answers HTTP 200 with

   ```json
   { "code": 0, "msg": "Failed to get user info" }
   ```

   and no `data.token`. The response is an _application-level_ refusal (code 0),
   not an HTTP error, which is why simple status-code checks looked healthy.

2. **`GET /work/printer/getPrinters` is no longer served.** Printer discovery
   through the workbench route returns nothing usable.
3. **The account JWT is accepted directly as the `XX-Token` header** by the
   `/v2/*` endpoints. The JWT is the HS512 token the slicer itself holds:
   claims `user_id` (the printer-cloud account) and `mode: "prod"`.

## Evidence: the 16 combinations

The external diagnosis varied four axes and got the same `code 0` answer for all
16 combinations of the session exchange:

| Axis        | Values tried                                                 |
| ----------- | ------------------------------------------------------------ |
| Token shape | account JWT (`user_id`, `mode: prod`) / bare token value     |
| Device type | `pcf` (slicer) / `web` (portal)                              |
| Header case | `XX-Token` / `Xx-Token` / `xx-token`                         |
| Base path   | `/p/p/workbench/api` / `/p/t/` (the portal workbench prefix) |

Alternate exchange routes were also probed and did **not** yield a session:
`/v3/public/getoauthToken` and the `/p/t/` base path. The conclusion is that the
exchange itself is gone for this build, not that a header or prefix was wrong.

## Evidence: what still works

With the account JWT sent as `XX-Token`, the `/v2/*` surface answers normally:

| Endpoint                                 | Result         |
| ---------------------------------------- | -------------- |
| `GET /v2/printer/printersStatus`         | printer list   |
| `GET /v2/Printer/status?id=<PRINTER_ID>` | printer status |
| `GET /v2/message/getMessageCount`        | message counts |

The signed `Xx-*` headers (device type, nonce, timestamp, version, signature)
are still required and unchanged — the auth change is only about which value
goes in `XX-Token`.

## What this repository does about it

Both cloud lanes are affected because the repo carries two implementations of
the same protocol, and both are versioned:

- `vendor/server.mjs` — the frozen MCP bundle (`scripts/build.mjs` copies it to
  `dist/server.mjs`). Functions: `loginWithAccessToken`, `getPrinters`,
  `TokenStore`.
- `scripts/anycubic-cloud.mjs` — the hand-written client used by
  `scripts/diagnose.mjs`, `scripts/cloud-readonly-diagnostics.mjs`, the command
  bus and the edge/full-read tools.

The shape of the fix in both:

1. **Exchange first, JWT second.** `login()` still calls
   `/v3/public/loginWithAccessToken`. Older slicers keep working exactly as
   before. Only when the server answers at the application level (HTTP 200, no
   `data.token`) does the account JWT become the `XX-Token`. A transport fault
   or a real HTTP error (4xx/5xx) still fails loudly — a silent downgrade would
   hide an expired token behind a confusing `/v2` error later.
2. **The fallback is visible, never silent.** One log line names the reason and
   the fallback (`... using the account access_token directly as XX-Token ...`),
   and the MCP `account_login` / `account_devices` results carry
   `auth_source: "account_jwt"` (plus `auth_reason` on login) so an agent can
   report _why_ the session exchange was skipped.
3. **Printers come from `/v2/printer/printersStatus` first**, mapped to the
   shape the callers already read (the MCP bundle's `PrinterInfo`
   `{id, key, machineType, deviceStatus, name, model, online}` and the scripts
   client's snake_case twin `{id, key, machine_type, device_status, name, model,
online}`). `/work/printer/getPrinters` stays as the fallback and is only
   called when the v2 route fails or carries no list. An **empty** v2 list is a
   success, not a reason to call the dead route.
4. **No invented fields.** Both reply envelopes in use in the rest of this
   codebase are accepted (`data: [...]` and `data: { list: [...] }`); the field
   mapping reuses exactly the aliases the old workbench payload already
   documented (`id`/`printer_id`, `key`/`dev_id`/`sn`/`device_id`,
   `machine_type`/`machineType`, `device_status`/`status`). A v2 payload key
   nobody has documented is not guessed into the contract.
5. **Token store stays BOM-free.** The DPAPI store (`cloud-token.json`) must be
   written without a UTF-8 BOM: `JSON.parse` throws on U+FEFF, and the store
   then reports "no token stored" forever. The external patch hit this. Here the
   writer never emits a BOM, and a file that arrives with one is **repaired on
   read** (stripped, rewritten without it, one log line) instead of being
   silently ignored.

## What is not verified

Stated plainly, so nobody mistakes fixture coverage for hardware truth:

- **No live call was made from this repository.** The agent that wrote this fix
  had no Anycubic credentials, and inventing a "verified live" claim would be
  worse than the gap. Everything here is fixture-driven.
- The exact **v2 envelope** for `printersStatus` (`data: [...]` vs
  `data: { list: [...] }`) was not captured in the report. Both are accepted;
  if the real payload uses a third key the list will be empty and the code falls
  back to the old route and logs why — visible, not silent.
- Whether **`/user/profile/userInfo`** accepts the raw JWT is unknown. The MCP
  bundle treats the profile as best-effort and the scripts client decodes
  `user_id`/`email` from the JWT claims when the profile call refuses; MQTT's
  user name is the only consumer.
- Whether `printersStatus` needs the same signed `Xx-*` headers is assumed
  (every request in this repo sends them) — the report only shows the
  `XX-Token` header mattering.

### Reproduction recipe (requires your own credentials)

Do not paste a real token into an issue or a commit. Locally:

```bash
# 1. the exchange (expected to answer code 0 on 2.0.0.3+)
curl -s -X POST "$ANY_CUBIC_BASE/v3/public/loginWithAccessToken" \
  -H "Content-Type: application/json" \
  -H "Xx-Device-Type: pcf" -H "Xx-Is-Cn: 1" \
  -H "Xx-Nonce: <NONCE>" -H "Xx-Timestamp: <TS>" -H "Xx-Version: V3.0.0" \
  -H "Xx-Signature: <MD5_SIGNATURE>" \
  -d '{"device_type":"pcf","access_token":"<ACCOUNT_JWT>"}'

# 2. the route that still works
curl -s "$ANY_CUBIC_BASE/v2/printer/printersStatus" \
  -H "XX-Token: <ACCOUNT_JWT>" -H "Xx-Device-Type: pcf" -H "Xx-Is-Cn: 1" \
  -H "Xx-Nonce: <NONCE>" -H "Xx-Timestamp: <TS>" -H "Xx-Version: V3.0.0" \
  -H "Xx-Signature: <MD5_SIGNATURE>"
```

If (2) answers with a printer list and (1) answers `code 0`, this record still
holds. If the payload's list key is neither `data[]` nor `data.list`, capture
the envelope shape (key names only, values redacted) and extend
`extractPrinterEntries` / `cloudPrinterList`.

## Code map

| Where                                         | What                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `vendor/server.mjs` (`// src/cloud.ts`)       | exchange-first `loginWithAccessToken` with the JWT fallback; v2-first `getPrinters` |
| `vendor/server.mjs` (`// src/token-store.ts`) | BOM-free write; BOM repair on read                                                  |
| `vendor/server.mjs` (`// src/index.ts`)       | `account_login` / `account_devices` report `auth_source` + `auth_reason`            |
| `scripts/anycubic-cloud.mjs`                  | same protocol in the hand-written client; exported mapping + token-record helpers   |
| `tests/cloud-auth-slicer2.test.mjs`           | client: fallback, v2 mapping, old-path fallback, BOM repair                         |
| `tests/vendor-cloud-auth.test.mjs`            | the same behaviours read out of `vendor/server.mjs` itself                          |
