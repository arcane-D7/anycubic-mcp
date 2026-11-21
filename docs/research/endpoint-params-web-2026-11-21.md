# Cloud contracts from the embedded workbench web resources + local bridge (2026-11-21)

Companion to `slicer-binary-surface-2026-11-18.md` and `endpoint-params-sdk-2026-11-21.md`.
This round chased the 10 unresolved-route contracts through a source the earlier
rounds had not mined: the **embedded web workbench** shipped in
`C:\Program Files\AnycubicSlicerNext\resources\web` (185 JS, 12 MB), plus the
host-side local HTTP surface and the SDK's own body templates.

## Method

- `rg --encoding auto` over all 185 JS/CSS/HTML in `resources/web` for every
  route fragment (`getUploadStatus`, `lockStorageSpace`, `farm/message`,
  `getoauthToken`, ...) — after establishing the files are UTF-8/UTF-16-BOM
  plain text, not packed.
- Full ASCII string dump of the route-table and field-pool clusters of
  `cloud_sdk_cpp.dll` (6549640–6601500) to anchor what the binary really
  registers, and extraction of its JSON body format-templates.
- Read of the four shipped homepage JS files (`account.js`, `home.js`,
  `homebody.js`, `host_application.js`) end to end.
- Greps over `%APPDATA%\AnycubicSlicerNext\log\MainApp_202611*.log` (the logs
  the app itself wrote on 14/16/18/20/21 Nov) — these turned out to hold only
  MQTT connect/lost lines, zero HTTP requests (see §7).

## 1. The web resources are NOT a workbench client

The decisive negative result of this round:

| File                                  | Size     | What it actually is                                                                              |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `anycubic/anycubic_workbench.html`    | 1.4 KB   | redirect stub — `onLoad="redirectToWorkbench()"` sends the browser to `https://cn.anycubic.com/` |
| `anycubic/missing_connection.html`    | 1.1 KB   | static "printer not connected" notice                                                            |
| `homepage/js/account.js`              | 5.3 KB   | local `ac.localhost` bridge client (below)                                                       |
| `homepage/js/host_application.js`     | 2.7 KB   | `ModuleRequest` wrapper over the same bridge                                                     |
| `homepage/js/home*.js`, `leftmenu.js` | 40/24 KB | disconnected homepage shell                                                                      |

There is no API host, no route fragment, no signed-header logic, no OAuth code
anywhere in these files: zero matches for `oauth`, `getUploadStatus`,
`lockStorageSpace`, `X-Auth-Token`, `farm/message`, `cloud_storage`, and every
other fragment tried. `homepage/js/home.js` carries the only remote hosts —
`www.makeronline.com` and `www-mo-itdev*.anycubic.com` (model portal, not the
workbench API).

## 2. The local bridge the web UI really uses

`homepage/js/account.js` + `host_application.js` speak **one** base URL:

```js
// Windows: http://ac.localhost/api/v1/   (macOS/Linux: anycubic://ac.localhost/api/v1/)
Account.prototype.SendGET(module, resource, data); // data -> ?query string
Account.prototype.SendPOST / PUT / DELETE(module, resource, data); // JSON body
appSender.get("config_read", { key }); // ModuleRequest('app')
```

Observed host-module calls: `app/config_read` (`Application.config_read`),
`account/{login,logout,logged}` (the same routes `Slic3r::GUI::HttpServer`
registers on the same 51-route local table as the MQTT bridge). **This is the
complete extent of the web-side knowledge** — the embedded pages are thin UI
over the same local server the firmwares research doc already catalogued.
Consequence: **no cloud route is callable through the embedded web UI**; the
unresolved contracts cannot be recovered from `resources/web` because the
workbench that would issue them (remote `cloud-universe.anycubic.com/w/p/AcOrcaWeb`)
is fetched live, from the browser, at runtime.

## 3. Route-table completeness, re-anchored

The 93-route table in the ABI research doc is the complete set: a fresh string
dump of `cloud_sdk_cpp.dll` yields exactly the same paths (offsets 6549640 –
6552896, contiguous, NUL-padded), ending with `https://` at 6552920. No unlisted
cloud path exists in the binary. The format strings the SDK uses to build
request bodies sit apart from the routes, at 6588040–6588240, and are the
nearest thing to a request grammar:

| Offset  | Format string                         | Used by                                          |
| ------- | ------------------------------------- | ------------------------------------------------ |
| 6588136 | `{{"id":{}}}`                         | any single-id write (rename, read, delete-by-id) |
| 6588152 | `{{"type":{}, "page":{},"limit":{}}}` | paginated list reads                             |
| 6588200 | `{{"ids":[{}]}}`                      | id-array writes (bulk setRead and similar)       |

(Note the doubled braces in the .rdata blob are a printf-style escape pair, not
JSON braces; the emitted body is single-braced.)

## 4. Per-route findings (routes 1–5 of the brief)

Legend: **web** = `resources/web`, **sdk** = `cloud_sdk_cpp.dll` +offset, **logs** =
`%APPDATA%\AnycubicSlicerNext\log\`. Route offsets are from the fresh dump and
match the ABI doc.

### 4.1 farm_message_info · farm_message_printerErrorList — where message_id comes from

|      |                                                                        |
| ---- | ---------------------------------------------------------------------- |
| Web  | NOT FOUND — zero `farm` references in all 185 JS                       |
| SDK  | `/farm/message/info` 6552400, `/farm/message/printerErrorList` 6552424 |
| Live | ledger 2026-11-21: bare calls refused `message_id require`             |

The SDK's farm field pool (6584856–6586480) answers the open question: the
**list read** returns rows whose own fields are the id source. The pool shows,
immediately after the `message_id`/`status`/`aggregate_mode` request keys, the
row fields `printer_id`, `latest_time`, `label_id`, `update_status`,
`label_name`, `keyword`, `model`, `name`, and — in the response half —
`task_id`, `alarm_code`, `del_flag`, `message_ids`, `unread_total`, `total`,
`updated`, `created_time`. So the flow is:

```
POST /farm/message/list {page, limit, status, aggregate_mode, label_id, keyword}
  -> data.pageData[] rows, each carrying message_id (and task_id / printer_id)
POST /farm/message/info {message_id}            <- row.message_id
POST /farm/message/printerErrorList {message_id} <- row.message_id (error rows of that message)
```

Our list came back **empty** because the account has no farm messages yet — the
refusals on info/printerErrorList are downstream of having no row to take an id
from, not a wrong param name. Suggested JSON (no call made):

```json
// farm_message_info / farm_message_printerErrorList (GET, query)
{ "message_id": 12345 } // 12345 = data.pageData[n].message_id from farm_message_list
```

### 4.2 v3_public_getoauthToken — the OAuth flow

|       |                                                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web   | NOT FOUND — zero `oauth` matches; the remote workbench is fetched live                                                                                                                     |
| SDK   | `/v3/public/getoauthToken` 6551296, next to `/v3/public/loginWithAccessToken` 6551256                                                                                                      |
| Env   | `resources/cloud/cloud_profile.ini`: `casdoor_base_url_en = https://uc.makeronline.com/login/oauth/authorize`, `casdoor_client_id_en = b269a3136d26ac6488bb`, `casdoor_scheme_en = acnext` |
| Local | OAuth redirect `http://localhost:21328/callback` (`AnycubicSlicer.dll` 56216104, ABI doc §1.2)                                                                                             |

Flow, assembled from the four pinned facts: browser opens the Casdoor authorize
URL (client id above, PKCE), the app listens on `localhost:21328` for
`/callback?code=…`, then the SDK exchanges that code — `getoauthToken` is that
exchange, and `loginWithAccessToken` (repo-CONFIRMED) is the sibling that takes
the resulting JWT. The token-lane research (cloud-auth-2026-11-18) probed this
route and got no session; the missing piece was the one-time `code`, which only
the interactive browser leg produces. Suggested JSON (never callable without a
fresh code):

```json
// POST /v3/public/getoauthToken
{
  "code": "<one-time code from the localhost:21328/callback redirect>",
  "client_id": "b269a3136d26ac6488bb",
  "redirect_uri": "http://localhost:21328/callback"
}
```

### 4.3 work_index_getUploadStatus — the real id

|      |                                                                                              |
| ---- | -------------------------------------------------------------------------------------------- |
| Web  | NOT FOUND — zero matches                                                                     |
| SDK  | `/work/index/getUploadStatus` 6550632                                                        |
| Live | ledger: `please input id` persists for `id` and for `upload_id` tried against gcode/file ids |

Two solid candidates now exist, and the cloud-storage pool names both:

1. **`lockID`** — `cloud_sdk_cpp.dll` 6583956, sitting inside the storage-lock
   cluster between `user_lock_space_id` (6583152/6600080), `is_temp_file`,
   `size`, `name`, `requestID` and `fileID` (6583912/6583924). The /v2 lock
   route (repo-CONFIRMED) answers the lock call with an id; the upload status
   route is the state machine's read side, so its "id" is plausibly that
   lock/session id, not a file id.
2. **`upload_id`** — 6599772 (already known), but note its immediate pool
   neighbours: `source_user_upload_id` (6599760), `stl_user_upload_id`
   (6599976), `image_id` (6599856), `name_counts` (6599792) — a user-upload
   record family. The `source_user_upload_id` spelling suggests the upload
   pipeline registers an _upload record_ distinct from the finished file, and
   getUploadStatus reads that record.

Concretely testable, in order of likelihood:

```json
// work_index_getUploadStatus (GET, query) — three candidates, cheapest first
{ "id": "<lockID from the /v2/cloud_storage/lockStorageSpace response>" }
{ "id": "<upload record id returned by /v2/profile/newUploadFile response>" }
{ "upload_id": "<same as above>" }
```

### 4.4 user_cloud_storage_getTcCosTempToken — who calls, and with what

|     |                                                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web | NOT FOUND in JS; but the route's **response** struct is fully named in the SDK pool                                                                                                                    |
| SDK | route 6550304; pool at 6597032–6597456: `tmpSecretId`, `tmpSecretKey`, `sessionToken`, `region`, `file_key`, `file_size`, `bucket`-style fields (`appid` 6598108, `uid` 6597600, `client_uid` 6597896) |

The field cluster is a **Tencent Cloud COS temporary-credential grant**
(`tmpSecretId`/`tmpSecretKey`/`sessionToken` are the exact TC COS STS names).
The caller is the client that is about to PUT an object straight to COS using
those temp credentials — i.e. the slicer's own upload pipeline (gcode/slice
artefacts), between `getPreSignUrlArrWithName` (named-URL variant) and
`newUploadFile` (claim). Request contract is small — the only request-shaped
keys near the route are the credential-issuance triplet plus `file_key`:

```json
// POST /user/cloud_storage/getTcCosTempToken
{ "file_key": "<object key the upload will write>" }
// response (credential-shaped — redact everything but the shape):
{ "code": 1, "data": { "tmpSecretId": "<...>", "tmpSecretKey": "<...>",
  "sessionToken": "<...>", "region": "<...>", "appid": "<...>" } }
```

### 4.5 work_printer_info — why `Unmodified content`

|      |                                                                                          |
| ---- | ---------------------------------------------------------------------------------------- |
| Web  | NOT FOUND                                                                                |
| SDK  | `/work/printer/info` 6550216, directly after `/work/operation/sendOrder` 6550184         |
| Live | ledger: code 0 `request error` on bare call; `Unmodified content` also seen on this lane |

The work family's id key is `printer_id` — the farm pool spells it, and
`work/printer/getPrinters` (repo-CONFIRMED) returns printer rows whose id feeds
every other work read (`sendOrder` uses `printer_id`, repo-proven). The bare
`request error` is therefore most likely a missing `printer_id`, and
`Unmodified content` is the server's cache answer: with an id but no
change-sensitive params the workbench lane returns its HTTP-304-style cache
verdict. The SDK work printer cluster (6590784–6590976: `printerID`,
`is_clean_plate`, `sort_by`, `nozzle_diameter`, `query_status`, `status_type`,
`nonce`) names the param family. Suggested:

```json
// work_printer_info (GET, query)
{ "printer_id": 1234 }                 // id from work_printer_getPrinters
// if that still answers cached/empty, add the freshness pair the pool shows:
{ "printer_id": 1234, "query_status": 1, "nonce": "<random>" }
```

## 5. Per-route findings (routes 6–8 of the brief)

### 5.1 UserColorGroup — the read that works, the write whose id is unseen

|      |                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Web  | NOT FOUND — zero `ColorGroup` matches                                                                                                         |
| SDK  | read 6552088, add 6552144, edit 6552192, delete 6552240                                                                                       |
| Live | read CONFIRMED 2026-11-21 (returns preset-style `{key, color}` entries); add ACCEPTED (color_type 1) but the group never appeared in the read |

The live evidence plus the SDK struct pool resolve the apparent contradiction.
The colour-group request struct (6581208–6581312) is:
`group_type`, `name`, `machine_name`, `get_all`, `thumbnail`, `use_ams`,
`ams_index`, `paint_color`, `ams_color`, `material_type`, `page`, `color`,
`estimate`, `total_layers`, `used_filament`, `length_filament`, `status`,
`ams_info`, `filament_color`. Two consequences:

1. **Why the add "vanished"**: `get_all` exists as a request key. The read
   almost certainly defaults to server-known groups unless `get_all: true`
   (or a `group_type` filter) is passed — a user-created group with a custom
   `group_type` is invisible to the default read. That is the cheapest probe
   to settle it, no write needed.
2. **Where edit/delete ids come from**: the same pool carries `work_project_group_id`
   (6582144) and the group response side carries `name`/`key`/`color` — the
   edit/delete twins want the group's server id, which only appears in the
   read response once the group is visible (the missing link again, not a
   different route). If the read-with-`get_all` still hides it, the id space
   to try is the `work_project_group_id` family.

```json
// 1) re-read with the explicit flags (GET query):
{ "get_all": true }
{ "group_type": 1, "get_all": true }
// 2) then edit/delete with the id the read finally returns:
{ "group_id": 123 }                     // editUserColorGroup: + the add-body fields
{ "group_id": 123 }                     // deleteUserColorGroup
```

### 5.2 v5_mqtt_status_report — the `Type` field

|     |                                                            |
| --- | ---------------------------------------------------------- |
| Web | NOT FOUND                                                  |
| SDK | route 6552656; the _MQTT_ type registry is the enum source |

The `Type` field relays the connection/report state of the client's own MQTT
session, and its enum is the SDK's authoritative type registry
(`cloud_mqtt.dll` 3194984–3195304, mirrored in `mach_mqtt.dll` 880712–881032):
`print, tempature, filament, screenSaver, levelling, preheating, status, video,
network, exposure, lastWill, residual, airpure, releaseFilm, smartResinVat,
resin, autoOperation, multiColorBox, light, extfilbox, peripherie` — 21 values,
lowercase-first camel spelling. A status _report_ narrows to the connection
verbs the registry also carries (`onlineReport`, `workReport`, `reportStatus`).
No numeric id table exists in the binary (order-id probe, ABI doc §5: zero
hits), so the wire value is one of these strings.

```json
// POST /v5/mqtt/status/report
{ "Type": "status", "Status": "connected" } // Type from the 21-value registry
```

### 5.3 work_project_report — the project_id space

|     |                                                                                                                                                                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web | NOT FOUND                                                                                                                                                                                                                                                                         |
| SDK | route 6550744; project pool 6589816–6590496: `project_id`, `project_type`, `project_name`, `printer_name`, `machine_type`, `model_id`, `model_name`, `print_status`, `status_params`, `start_time`, `end_time`, `estimate_seconds`, `img`, `is_farm`, `dual_platform_mode_enable` |

The id space is the **/v5 project space**: `v5_project_list` (LIVE 2026-11-21)
returns `project_id` values and `v5_project_info` accepts that id
(`144435802` answered live). `work_project_report` writes to the same store —
its pool is literally the v5 project row schema plus write-only fields
(`slice_result`, `task_settings`, `evoke_from`, `print_number`,
`work_project_group_id`, `is_start_print`, `camera_timelapse`, `ai_detect`,
`auto_leveling`, `vibration_compensation`, `flow_calibration`, `dry_mode`,
`drying_settings`, `supplies_usage`, `total_layers`, `estimate`).

```json
// POST /work/project/report
{
  "project_id": 144435802, // from v5_project_list
  "project_type": 1,
  "evoke_from": 1,
  "is_start_print": 0,
  "printer_ids": [1234],
  "file_id": 0,
  "ai_detect": 0,
  "camera_timelapse": 0,
  "auto_leveling": 1,
  "vibration_compensation": 1,
  "flow_calibration": 1
}
```

## 6. Contract-only routes (brief item 9 — bodies from the JS/doc evidence, no calls)

The credential/feedback/hardware writes. The slicer's own local UI bridge
never issues these over HTTP with JSON we can read (the login UI is native,
not the embedded web), so contracts below come from the shared field pools of
`cloud_sdk_cpp.dll` (offsets cited) and stay INFERRED — the doc records the
shape, never a validated exchange:

| rota                                | contrato sugerido (INFERRED)                                                                                                                                                                                   | evidência                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `POST /v3/printer/sendFile`         | `{ "printer_id": <id>, "file_id": <id>, "task_settings": {...} }` — mesmo partial-schema do sendOrder; keys de 6583040 (`printer_id`, `file_id`, `task_settings`, `solt_color_material_match`, `filetype`)     | pool work 6583040-6583816; sendOrder repo-CONFIRMED partilha `printer_id`/`order_id`/`data` |
| `POST /farm/printer/createBulkTask` | `{ "filePath": "<path>", "taskType": <n>, "printer_ids": [<id>...] }` — o apêndice local `/api/v1/FramSelectGcodeFile/sendGcodeCreateBulkTask params: filePath, taskType` (ABI doc §2.2) espelha o corpo cloud | AnycubicSlicer.dll 56806384; pool farm 6580292 (`bulk_id`, `empty_group_id`, `printer_ids`) |
| `POST /farm/device/createBulkTask`  | variante por device id (`device_id` + `file_id` + mesmos task fields)                                                                                                                                          | pool farm device 6590632 (`bulk_id`, `video_taskid`, `device_status`)                       |
| `POST /farm/printer/setCleanPlate`  | `{ "printer_id": <id>, "is_clean_plate": 1 }`                                                                                                                                                                  | `is_clean_plate` 6590808 na zona work/farm                                                  |
| `POST /v2/device/save`              | `{ "machine_type": "<type>", "name": "<device name>", "key": "<k>", "value": "<v>" }` — pares key/value (6589168/6589224/6592276)                                                                              | pool device                                                                                 |
| `POST /work/work/addprinter`        | bind: `{ "printer_sn": "<sn>", "machine_type": "<t>", "name": "<nome>" }`                                                                                                                                      | pool 6590908 `nonce`, 6591408 `machine_mac`                                                 |
| `POST /user/public/login`           | `{ "user_nickname": "<n>", "password": "<md5?>", "code": ... }` — CREDENCIAL: nunca testar em automação                                                                                                        | `user_nickname` 6587496 (UTF-16LE confirmado no doc SDK)                                    |
| `POST /user/public/register`        | mesmo family + `email/phone`, password hash                                                                                                                                                                    | 6549736 route                                                                               |
| `POST /user/public/passwordReset`   | `{ "code": <vcode>, "password": "<...>" }` após `verification_code/newSend`                                                                                                                                    | 6549808; `newSend` 6549840                                                                  |
| `POST /portal/index/feedback`       | `{ "reason_id": <id from portal/index/reason>, "content": "<txt>" }`                                                                                                                                           | `reason_id` 6595744, `content` 6587544                                                      |
| `POST /v3/work_project/feedback`    | `{ "post_id": <id>, "post_title": "<t>", "is_feedback": 1, "feedbacks": [...] }`                                                                                                                               | 6596672/6596856/6596072                                                                     |

## 7. item 10 — o contract ID do /user/cloud_storage/lockStorageSpace

|             |                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------- |
| gêmeo /v2   | repo-CONFIRMED: `{ "size": <n>, "name": "<f>", "is_temp_file": 0/1 }` (endpoint-params-sdk doc) |
| gêmeo /user | espera `ID` (doc SDK §"Still open") + a pool adiciona o nome exacto do campo                    |

A pool cloud-storage resolve: a resposta do lock traz `lockID` (6583956) e o
record do ficheiro traz `user_lock_space_id` (6583152/6600080). O contrato do
twin /user é esse par:

```json
// POST /user/cloud_storage/lockStorageSpace
{ "ID": <lockID devolvido pelo /v2 lock, ou user_lock_space_id do record> }
```

## 8. logs MainApp_202611*.log

Zero evidência de rotas HTTP (todas as 6 janelas de Nov): cada ficheiro tem
só linhas `CloudMqttClient.cpp` (connect url / connected / CONNECTION LOST).
Ex.: `MainApp_20261114_3.log:1` → `cloud mqtt ... connect url: mqtts://mqtt-universe.anycubic.com:8883` (host público,
sem segredo). Os pedidos HTTP não chegam a este log — o canal cloud fica no
SDK (ver §3). O `update_status` que aparecia nos logs referidos pela task
brief corresponde ao campo da pool farm (6585056), não a linhas de log.

## 6. Contract-only rows (pool-derived, never probed, still MAPPED)

- `POST /v2/device/save` — device settings write (pool: `machine_type`,
  `name`, key/value rows).
- `POST /farm/message/bulkDelete` — DESTRUCTIVE, bulk message delete.
- `POST /work/project/unsetprojects` — DESTRUCTIVE, project unbind.
- `POST /user/public/login|logout|register`, `GET .../passwordReset` —
  credential lane, kept out of automation entirely.
- `POST /v3/feedback ×2` (`/v3/work_project/feedback` 6552016,
  `portal_index_feedback` 6550016) — the two feedback contract rows; bodies
  carry `reason_id`/`content`/`post_id` per the pool, never probed.

## 7. MainApp_202611*.log evidence

The MainApp logs hold **zero route evidence**: `MainApp_20261114_3.log` (one
cloud-mqtt connect + one lost line), `MainApp_20261116.log` (same shape),
`MainApp_20261118.log` (0 bytes), `MainApp_20261120.log` / `_21.log` (same
connect cadence). The MQTT topic log lines the binary carries are compiled to
a verbosity the shipped log config does not emit (ABI doc §7), and no HTTP
request body reaches MainApp — the route table lives in `cloud_sdk_cpp.dll`,
not in the logs. Local host evidence instead:
`homepage/js/account.js` `BASE_URL` = `http://ac.localhost/api/v1/` and the
route table it serves (§3).

## 8. Suggested JSON bodies — the parent's test sheet

| Route                               | Suggested body                                                         |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `POST /farm/printer/createBulkTask` | `{ "filePath": "<gcode path>", "taskType": 1, "printer_ids": [1234] }` |
| `POST /farm/device/createBulkTask`  | `{ "device_id": 1234, "file_id": 5678, "task_settings": {} }`          |
| `POST /farm/message/read`           | `{ "message_ids": [ 1, 2 ] }` (the read pool row key)                  |
| `POST /v3/printer/sendFile`         | `{ "printer_id": 1234, "file_id": 5678, "task_settings": {} }`         |
| `GET /user/cloud_storage/...` twins | follow the /v2 shapes (§6)                                             |

## 8. The MITM verdict (2026-11-21): the SDK pins its TLS — addendum

Method: mitmproxy on 127.0.0.1:8888, the app relaunched with HTTPS_PROXY (the
cloud SDK honors proxy env vars — its connections DID arrive at the proxy),
the mitmproxy CA installed in the user store AND the machine root store
(owner-approved UAC). Result: every TLS handshake ends with
`tlsv1 alert unknown ca` — the SDK carries its own CA validation
(**certificate pinning**; consistent with a shared mTLS culture).
Consequence: the app's HTTPS request bodies are cryptographically opaque to
local interception; the missing contracts cannot be recovered by MITM.

## 9. The OAuth flow, corrected (2026-11-21)

The authorize attempt with `redirect_uri=http://localhost:21328/callback` was
refused by Casdoor's allowlist. The SDK strings correct the picture:
`acnext://login&scope=read&state=ac_slicer_next&lang=…` and
`acnext://logout&state=…&id_token_hint=…` — the registered redirect is the
**custom scheme `acnext://login`**, which the OS routes to the app itself.
`http://localhost:21328/callback` is the **SimplyPrint integration** callback
(sits next to `simplyprintanycubicslicer` and the `user.read files.te…`
scope list in the binary). So the OAuth code exists only inside the app after
a browser login; the exchange (`getoauthToken`) is the app's own step.
Loopback (`/api/v1/account/login|logged|headers`, 49 routes) is the observer
lane — it comes up with the app's embedded web UI.
