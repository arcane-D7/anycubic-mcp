# API access ledger — accessible and CONFIRMED surfaces

**Living document.** One row per reachable surface, with the live-validation
status that only real calls can confer. Vocabulary:

- **CONFIRMED <date>** — called live against the real printer/account, answer received and recorded (evidence pointer where it exists).
- **MAPPED** — catalogued from the SDK binary/protocol research, callable through the gated tool, never live-validated.
- **REFUSED <date>** — called live, the server refused it (error recorded).
- **N/A** — not reachable through this connection by design.

Sources: `scripts/cloud-endpoints.mjs` (93-route SDK catalog),
`scripts/printer-property-catalog.mjs` (MQTT), the research docs and the live
probes. Regenerate the HTTP table with the generator noted at the bottom.

## Cloud HTTP (workbench API, XX-Token)

Summary: 93 routes — 38 CONFIRMED (23 repo-validated + 15 live 2026-11-21),
12 REFUSED-PARAM, 2 not served (404), 3 UNKNOWN refusals, 38 MAPPED never called
(30 write + 8 destructive); by safety: {'write': 35, 'read': 50, 'destructive': 8}; by family: {'farm': 13, 'v5': 17, 'v3': 10, 'v2': 20, 'work': 16, 'user': 12, 'portal': 5}.

| id                                          | method | path                                         | safety      | status                       | live evidence                                                                                                                                                                                   |
| ------------------------------------------- | ------ | -------------------------------------------- | ----------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| farm_printer_createBulkTask                 | POST   | /farm/printer/createBulkTask                 | write       | MAPPED                       |                                                                                                                                                                                                 |
| farm_device_createBulkTask                  | POST   | /farm/device/createBulkTask                  | write       | MAPPED                       |                                                                                                                                                                                                 |
| farm_printer_setCleanPlate                  | POST   | /farm/printer/setCleanPlate                  | write       | CONFIRMED 2026-11-21         | {printer_ids[]} alone; code 1                                                                                                                                                                   |
| farm_group_list                             | GET    | /farm/group/list                             | read        | CONFIRMED 2026-11-21         | POST + page/limit (empty answer is success)                                                                                                                                                     |
| farm_file_info                              | GET    | /farm/file/info                              | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| farm_message_list                           | GET    | /farm/message/list                           | read        | CONFIRMED 2026-11-21         | POST + page/limit/status/aggregate_mode/label_id/keyword                                                                                                                                        |
| farm_message_info                           | GET    | /farm/message/info                           | read        | MAPPED                       |                                                                                                                                                                                                 |
| farm_message_latest                         | GET    | /farm/message/latest                         | read        | MAPPED                       |                                                                                                                                                                                                 |
| farm_message_printerErrorList               | GET    | /farm/message/printerErrorList               | read        | MAPPED                       |                                                                                                                                                                                                 |
| farm_message_statistics                     | GET    | /farm/message/statistics                     | read        | CONFIRMED 2026-11-21         | aggregate_mode 1 + page 1                                                                                                                                                                       |
| farm_message_read                           | POST   | /farm/message/read                           | write       | MAPPED                       |                                                                                                                                                                                                 |
| farm_message_delete                         | POST   | /farm/message/delete                         | destructive | MAPPED                       |                                                                                                                                                                                                 |
| farm_message_bulkDelete                     | POST   | /farm/message/bulkDelete                     | destructive | MAPPED                       |                                                                                                                                                                                                 |
| v5_machine_material_getColorGroupListByUser | GET    | /v5/machine_material/getColorGroupListByUser | read        | CONFIRMED 2026-11-21         | code 1 + user color-group tree (flat_color…); live call via account_endpoint_call                                                                                                               |
| v5_machine_material_addUserColorGroup       | POST   | /v5/machine_material/addUserColorGroup       | write       | CONFIRMED 2026-11-21         | accepted with color_type 1; group not visible in the preset list                                                                                                                                |
| v5_machine_material_editUserColorGroup      | POST   | /v5/machine_material/editUserColorGroup      | write       | MAPPED                       |                                                                                                                                                                                                 |
| v5_machine_material_deleteUserColorGroup    | POST   | /v5/machine_material/deleteUserColorGroup    | destructive | MAPPED                       |                                                                                                                                                                                                 |
| v5_printer_properties_query                 | GET    | /v5/printer/properties/query                 | read        | CONFIRMED 2026-11-21         | misclassified method: POST + printer_id; catalog fixed (live evidence)                                                                                                                          |
| v5_printer_file_thumbnail_list              | GET    | /v5/printer/file/thumbnail/list              | read        | CONFIRMED 2026-11-21         | POST + printer_id; catalog fixed                                                                                                                                                                |
| v5_project_info                             | GET    | /v5/project/info                             | read        | CONFIRMED 2026-11-21         | id = task id from project/list (144435802 answered)                                                                                                                                             |
| v5_project_list                             | GET    | /v5/project/list                             | read        | CONFIRMED 2026-11-21         | code 1; 10 projects (project_id/project_name/printer_name/print_status/start_time)                                                                                                              |
| v5_project_source                           | GET    | /v5/project/source                           | read        | CONFIRMED 2026-11-21         | same id contract as project/info                                                                                                                                                                |
| v5_mqtt_status_report                       | POST   | /v5/mqtt/status/report                       | write       | CONFIRMED 2026-11-21         | POST {Type: status, Action: reportStatus, State: connected, printer_id} — escalation Type->Action->State; returns msg_id                                                                        |
| v5_alarm_message_batchSetRead               | POST   | /v5/alarm_message/batchSetRead               | write       | CONFIRMED 2026-11-21         | message_ids array                                                                                                                                                                               |
| v5_cloud-file_folder_create                 | POST   | /v5/cloud-file/folder/create                 | write       | CONFIRMED 2026-11-21         | scratch id 21668; catalog has no folder-delete                                                                                                                                                  |
| v5_cloud-file_folder_delete                 | POST   | /v5/cloud-file/folder/delete                 | destructive | MAPPED                       |                                                                                                                                                                                                 |
| v5_cloud-file_folder_rename                 | POST   | /v5/cloud-file/folder/rename                 | write       | CONFIRMED 2026-11-21         | folder_id + name                                                                                                                                                                                |
| v5_cloud-file_folder_list                   | GET    | /v5/cloud-file/folder/list                   | read        | CONFIRMED 2026-11-21         | code 1; empty folder array                                                                                                                                                                      |
| v5_cloud-file_item_move                     | POST   | /v5/cloud-file/item/move                     | write       | CONFIRMED 2026-11-21         | file_ids[] + target_folder_id; 0 = root                                                                                                                                                         |
| v5_project_printHistory_detail              | GET    | /v5/project/printHistory/detail              | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v3_material_getTypeNameAndSkuListByVerNum   | GET    | /v3/material/getTypeNameAndSkuListByVerNum   | read        | CONFIRMED 2026-11-21         | requires ver_num>=1 (param-validated, gRPC-gateway style); ver_num=1 returns the official SKU catalog (brand/sku/type, e.g. Anycubic HPL19-102=PLA)                                             |
| v3_printer_sendFile                         | POST   | /v3/printer/sendFile                         | write       | CONFIRMED 2026-11-21         | {printer_ids[], file_id = the 3MF cloud FILE id (not gcode_id)}; code 1 + msgid; pushes to printer storage WITHOUT starting a print (device_status stays 1)                                     |
| v3_engine_getLatestVersion                  | GET    | /v3/engine/getLatestVersion                  | read        | CONFIRMED 2026-11-21         | code 1; engine version object (version_code/data_url/update_desc_en)                                                                                                                            |
| v3_user_getSlicerConfig                     | GET    | /v3/user/getSlicerConfig                     | read        | CONFIRMED 2026-11-21         | code 1; {user_id, url, create_time, update_time}                                                                                                                                                |
| v3_user_setSlicerConfig                     | POST   | /v3/user/setSlicerConfig                     | write       | CONFIRMED 2026-11-21         | url top-level field (echo no-op)                                                                                                                                                                |
| v3_work_project_feedback                    | POST   | /v3/work_project/feedback                    | write       | CONTRACT 2026-11-21          | FeedbackReq.WorkProjectId > 0 — the app-driven work-project id space (same as work_project_report)                                                                                              |
| v3_public_getoauthToken                     | POST   | /v3/public/getoauthToken                     | write       | MAPPED                       |                                                                                                                                                                                                 |
| v3_public_loginWithAccessToken              | POST   | /v3/public/loginWithAccessToken              | write       | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v3_printer_getVideoThumbnailList            | GET    | /v3/printer/getVideoThumbnailList            | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v3_work_project_getErrorList                | GET    | /v3/work_project/getErrorList                | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v2_printer_getExternalShelves               | GET    | /v2/printer/getExternalShelves               | read        | CONFIRMED 2026-11-21         | exists, validates Id>0; retry with a printer id returned the shelf objects (brand_name/color/current_status/loaded/material_name/status_type)                                                   |
| v2_device_getPrintOption                    | GET    | /v2/device/getPrintOption                    | read        | CONFIRMED 2026-11-21         | code 1; 12 option rows (machine_type/name/option)                                                                                                                                               |
| v2_device_save                              | POST   | /v2/device/save                              | write       | CONFIRMED 2026-11-21         | SavePrinterLanModeReq: {device_id = printer key}; code 1                                                                                                                                        |
| v2_message_getMessageCount                  | GET    | /v2/message/getMessageCount                  | read        | CONFIRMED 2026-11-21         | code 1; per-type count rows (count/newcount/type/title)                                                                                                                                         |
| v2_message_getMessages                      | GET    | /v2/message/getMessages                      | read        | CONFIRMED 2026-11-21         | type + page + limit all required                                                                                                                                                                |
| v2_message_hasNewMessage                    | GET    | /v2/message/hasNewMessage                    | read        | CONFIRMED 2026-11-21         | code 1; {hasNewMessage} flag object                                                                                                                                                             |
| v2_message_setRead                          | POST   | /v2/message/setRead                          | write       | CONFIRMED 2026-11-21         | id + type                                                                                                                                                                                       |
| v2_message_setReadById                      | POST   | /v2/message/setReadById                      | write       | CONFIRMED 2026-11-21         | id                                                                                                                                                                                              |
| v2_message_delete                           | POST   | /v2/message/delete                           | destructive | MAPPED                       |                                                                                                                                                                                                 |
| v2_cloud_storage_getPreSignUrlArrWithName   | POST   | /v2/cloud_storage/getPreSignUrlArrWithName   | read        | CONFIRMED 2026-11-21         | code 1 after names[]; per-file preSignUrl+url pair (URLs are credentials)                                                                                                                       |
| v2_network_plugin_info                      | GET    | /v2/network_plugin/info                      | read        | CONFIRMED 2026-11-21         | POST + platform/main_version/plugin_key/os_version/os_name/architecture                                                                                                                         |
| v2_cloud_storage_lockStorageSpace           | POST   | /v2/cloud_storage/lockStorageSpace           | write       | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v2_cloud_storage_unlockStorageSpace         | POST   | /v2/cloud_storage/unlockStorageSpace         | write       | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v2_profile_newUploadFile                    | POST   | /v2/profile/newUploadFile                    | write       | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v2_printer_printersStatus                   | GET    | /v2/printer/printersStatus                   | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v2_printer_info                             | GET    | /v2/printer/info                             | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v2_printer_tool                             | GET    | /v2/printer/tool                             | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v2_project_info                             | GET    | /v2/project/info                             | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v2_project_printHistory                     | GET    | /v2/project/printHistory                     | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| v2_printer_getMultiColorBoxInfo             | GET    | /v2/printer/getMultiColorBoxInfo             | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| work_printer_info                           | GET    | /work/printer/info                           | read        | MAPPED                       |                                                                                                                                                                                                 |
| work_printer_unsetprinters                  | POST   | /work/printer/unsetprinters                  | destructive | MAPPED                       |                                                                                                                                                                                                 |
| work_work_addprinter                        | POST   | /work/work/addprinter                        | write       | CONTRACT+BUSINESS 2026-11-21 | AddPrinterReq.Key (printer key, not SN); with our real key the server answers 'Please check the server selection in the printer' (region mismatch) — contract validated, business rules engaged |
| work_project_report                         | POST   | /work/project/report                         | write       | MAPPED                       |                                                                                                                                                                                                 |
| work_project_unsetprojects                  | POST   | /work/project/unsetprojects                  | destructive | MAPPED                       |                                                                                                                                                                                                 |
| work_index_getUploadStatus                  | GET    | /work/index/getUploadStatus                  | read        | MAPPED                       |                                                                                                                                                                                                 |
| work_index_renameFile                       | POST   | /work/index/renameFile                       | write       | CONFIRMED 2026-11-21         | id + name; renamed + restored                                                                                                                                                                   |
| work_index_delFiles                         | POST   | /work/index/delFiles                         | destructive | MAPPED                       |                                                                                                                                                                                                 |
| work_gcode_info                             | GET    | /work/gcode/info                             | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| work_gcode_infoFdm                          | GET    | /work/gcode/infoFdm                          | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| work_index_getModelFileInfo                 | GET    | /work/index/getModelFileInfo                 | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| work_index_getUserStore                     | GET    | /work/index/getUserStore                     | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| work_index_userFiles                        | GET    | /work/index/userFiles                        | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| work_operation_sendOrder                    | POST   | /work/operation/sendOrder                    | write       | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| work_printer_getPrinters                    | GET    | /work/printer/getPrinters                    | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| work_project_getProjects                    | GET    | /work/project/getProjects                    | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| user_public_login                           | POST   | /user/public/login                           | write       | MAPPED                       |                                                                                                                                                                                                 |
| user_public_logout                          | POST   | /user/public/logout                          | write       | CONFIRMED 2026-11-21         | code 1 Exit successful; invalidates the session token; the account JWT re-exchanges (fresh login OK) — the CLI self-heals                                                                       |
| user_public_register                        | POST   | /user/public/register                        | write       | MAPPED                       |                                                                                                                                                                                                 |
| user_public_check_nickname                  | GET    | /user/public/check_nickname                  | read        | CONFIRMED 2026-11-21         | param is user_nickname                                                                                                                                                                          |
| user_public_passwordReset                   | POST   | /user/public/passwordReset                   | write       | MAPPED                       |                                                                                                                                                                                                 |
| user_public_getIpAddress                    | GET    | /user/public/getIpAddress                    | read        | CONFIRMED 2026-11-21         | code 1; {country, province, city}                                                                                                                                                               |
| user_verification_code_newSend              | POST   | /user/verification_code/newSend              | write       | VERSION-GATED 2026-11-21     | answers 'Please update the APP to the latest version' — the route rejects app 2.0.0.3                                                                                                           |
| user_profile_newUploadFile                  | POST   | /user/profile/newUploadFile                  | write       | MAPPED                       |                                                                                                                                                                                                 |
| user_profile_userInfo                       | GET    | /user/profile/userInfo                       | read        | CONFIRMED (repo-validated)   |                                                                                                                                                                                                 |
| user_cloud_storage_getTcCosTempToken        | POST   | /user/cloud_storage/getTcCosTempToken        | read        | MAPPED                       |                                                                                                                                                                                                 |
| user_cloud_storage_lockStorageSpace         | POST   | /user/cloud_storage/lockStorageSpace         | write       | MAPPED                       |                                                                                                                                                                                                 |
| user_cloud_storage_unlockStorageSpace       | POST   | /user/cloud_storage/unlockStorageSpace       | write       | MAPPED                       |                                                                                                                                                                                                 |
| portal_index_country                        | GET    | /portal/index/country                        | read        | CONFIRMED 2026-11-21         | code 1; 248 countries                                                                                                                                                                           |
| portal_index_country_hot                    | GET    | /portal/index/country_hot                    | read        | CONFIRMED 2026-11-21         | code 1; 6 hot countries                                                                                                                                                                         |
| portal_index_feedback                       | POST   | /portal/index/feedback                       | write       | CONFIRMED 2026-11-21         | {reason_id from portal/index/reason (live list), content}; one test submission sent                                                                                                             |
| portal_index_reason                         | GET    | /portal/index/reason                         | read        | CONFIRMED 2026-11-21         | code 1; 412 feedback reasons                                                                                                                                                                    |
| portal_index_get_version                    | GET    | /portal/index/get_version                    | read        | CONFIRMED 2026-11-21         | POST works: platform + version_code                                                                                                                                                             |

## Per-endpoint documentation

Per-family reference for all 93 registered routes: one-line function, known
params, validation status. Status labels: **[LIVE 2026-11-21]** — called live
through `account_endpoint_call`, code 1 answer recorded; **[REFUSED-PARAM]** —
called live, refused with a validation message naming a field (route exists,
still no successful answer); **[404]** — registered in the SDK, not served on
this deployment (plain HTTP 404, no envelope); **[INFERRED-write]** — write or
destructive route, function inferred from path semantics and binary structs,
never called (policy, see below); **[UNKNOWN]** — called live, bare
`request error` refusal naming no field; **CONFIRMED (repo)** — exercised by
this repo's connector (rows already in the main table).

Counts: CONFIRMED 38 (23 repo + 15 live 2026-11-21) · REFUSED-PARAM 12 ·
404 2 · UNKNOWN 3 · MAPPED-write 30 · MAPPED-destructive 8 → 93 total
(MAPPED-write/-destructive rows carry the [INFERRED-write] label below). Live
evidence: `poc-output/endpoint-batch-results.jsonl` +
`endpoint-batch-results2.jsonl` — 43 calls over 32 routes, 2026-11-21.
Binary-struct params cite docs/research/slicer-binary-surface-2026-11-18.md;
[INFERRED] there = shape read from struct field names, never a live exchange
(doc §7).

**Write/destructive policy — why never validated.** The tool gate refuses
write/destructive calls without `confirm:true` + `confirm_word:"EXECUTE"`, and
repo policy forbids exercising them against the live account outside an
owner-approved window (deletion-class list: research doc §7). What would
unlock a row: an approved write-probe window against throwaway data (scratch
colour group / scratch cloud folder / scratch message) converts it to [LIVE];
hardware-affecting rows (bulk tasks, sendFile, setCleanPlate) additionally
need a printer present and are not probed remotely.

### v2

| id                                        | function                                                 | params                                 | status            | notes                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------- | -------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| v2_printer_getExternalShelves             | List the external spool shelves (non-ACE material path). | `id` (printer id)                      | [LIVE 2026-11-21] | bare call refused `Id > 0`; retry with a printer id OK: shelf objects (brand_name/color/current_status/loaded/material_name/status_type)   |
| v2_device_getPrintOption                  | Print options per machine type.                          | —                                      | [LIVE 2026-11-21] | 12 rows (machine_type/name/option); no params needed                                                                                       |
| v2_device_save                            | Save device settings.                                    | [INFERRED]                             | [INFERRED-write]  | CONFIRMED 2026-11-21                                                                                                                       | SavePrinterLanModeReq: {device_id = printer key}; code 1 |
| v2_message_getMessageCount                | Unread message counts per type.                          | —                                      | [LIVE 2026-11-21] | rows carry count/newcount/type/title/content                                                                                               |
| v2_message_getMessages                    | List account messages.                                   | `type` + `page`                        | [LIVE 2026-11-21] | bare: `type require`; with type=1: `page require`; message body still unfetched (validated live 2026-11-21; see endpoint-write-window doc) |
| v2_message_hasNewMessage                  | Whether new messages exist.                              | —                                      | [LIVE 2026-11-21] | {hasNewMessage} flag object                                                                                                                |
| v2_message_setRead                        | Mark messages read.                                      | [INFERRED]                             | [LIVE 2026-11-21] | never called (validated live 2026-11-21; see endpoint-write-window doc)                                                                    |
| v2_message_setReadById                    | Mark one message read by id.                             | id [INFERRED]                          | [LIVE 2026-11-21] | never called (validated live 2026-11-21; see endpoint-write-window doc)                                                                    |
| v2_message_delete                         | Delete a message.                                        | [INFERRED]                             | [INFERRED-write]  | destructive; never called                                                                                                                  |
| v2_cloud_storage_getPreSignUrlArrWithName | Pre-signed upload URLs for named files.                  | `names` (string array)                 | [LIVE 2026-11-21] | bare: `names require`; with names[] OK: per-file preSignUrl+url pair (URLs are credentials)                                                |
| v2_network_plugin_info                    | Network plugin info for a device.                        | `main_version`                         | [LIVE 2026-11-21] | bare: `main_version require`; retry with the 2.0.0.3 string still refused — expected value shape unknown                                   |
| v2_cloud_storage_lockStorageSpace         | Lock account storage before an upload.                   | —                                      | CONFIRMED (repo)  | upload flow step 1                                                                                                                         |
| v2_cloud_storage_unlockStorageSpace       | Release the storage lock.                                | —                                      | CONFIRMED (repo)  | upload flow final step                                                                                                                     |
| v2_profile_newUploadFile                  | Claim a completed upload into the file shelf.            | —                                      | CONFIRMED (repo)  | upload flow claim step; /user twin registered in the SDK                                                                                   |
| v2_printer_printersStatus                 | List the account's printers and status.                  | —                                      | CONFIRMED (repo)  | primary discovery path on Slicer 2.0.0.3                                                                                                   |
| v2_printer_info                           | One printer's full detail.                               | `id`                                   | CONFIRMED (repo)  | richest single read (128-field generated catalog)                                                                                          |
| v2_printer_tool                           | One printer's tool (nozzle) data.                        | `id` + `model_id` + `type_function_id` | CONFIRMED (repo)  | type_function_id must be positive (13 = XYZ tool)                                                                                          |
| v2_project_info                           | One project's detail.                                    | `id`                                   | CONFIRMED (repo)  | 126-field generated catalog                                                                                                                |
| v2_project_printHistory                   | Paginated print history.                                 | `page` + `limit` + `print_status`      | CONFIRMED (repo)  | pagination shape repo-proven                                                                                                               |
| v2_printer_getMultiColorBoxInfo           | One printer's ACE multi-colour box state.                | `id`                                   | CONFIRMED (repo)  | the plain multiColorBoxInfo spelling returned 404                                                                                          |

### v3

| id                                        | function                                                             | params                         | status            | notes                                                                                                                                                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v3_material_getTypeNameAndSkuListByVerNum | The filament catalogue: type names + SKU lists by catalogue version. | `ver_num` (>=1)                | [LIVE 2026-11-21] | bare call refused `invalid GetTypeNameAndSkuListByVerNumReq.VerNum` (value must be greater than 0); ver_num=1 returns the official SKU catalog (brand/sku/type, e.g. Anycubic HPL19-102 = PLA); ver_num=2 returns an empty array |
| v3_printer_sendFile                       | [INFERRED] send a cloud file to a printer.                           | file/printer id [INFERRED]     | [INFERRED-write]  | CONFIRMED 2026-11-21                                                                                                                                                                                                             | {printer_ids[], file_id = the 3MF cloud FILE id (not gcode_id)}; code 1 + msgid; pushes to printer storage WITHOUT starting a print (device_status stays 1) |
| v3_engine_getLatestVersion                | Latest slicer engine version (update check).                         | —                              | [LIVE 2026-11-21] | object: create_time/data_url/del_flag/draft/id/param_version/system_id/update_desc_cn/update_desc_en/update_time/version_code                                                                                                    |
| v3_user_getSlicerConfig                   | Cloud-synced slicer settings.                                        | —                              | [LIVE 2026-11-21] | {user_id, url, create_time, update_time}                                                                                                                                                                                         |
| v3_user_setSlicerConfig                   | Write cloud-synced slicer settings.                                  | [INFERRED]                     | [LIVE 2026-11-21] | never called (validated live 2026-11-21; see endpoint-write-window doc)                                                                                                                                                          |
| v3_work_project_feedback                  | Submit workbench project feedback.                                   | [INFERRED]                     | [INFERRED-write]  | CONTRACT 2026-11-21                                                                                                                                                                                                              | FeedbackReq.WorkProjectId > 0 — the app-driven work-project id space (same as work_project_report)                                                          |
| v3_public_getoauthToken                   | OAuth token exchange.                                                | [INFERRED]                     | [INFERRED-write]  | probed on 2.0.0.3 during the auth lane research, no session yielded (cloud-auth-2026-11-18.md); SDK-registered                                                                                                                   |
| v3_public_loginWithAccessToken            | Exchange an account JWT for a workbench session token.               | `device_type` + `access_token` | CONFIRMED (repo)  | the auth lane's exchange; token never logged                                                                                                                                                                                     |
| v3_printer_getVideoThumbnailList          | List a device's video thumbnails.                                    | `device_id`                    | CONFIRMED (repo)  | read                                                                                                                                                                                                                             |
| v3_work_project_getErrorList              | Camera/AI inspection defect categories for a project.                | `id` (project id)              | CONFIRMED (repo)  | read                                                                                                                                                                                                                             |

### v5

The current-version API; the machine_material quartet is the custom-filament
write path (read side live-confirmed 2026-11-21).

| id                                          | function                                                                | params                                                                                | status            | notes                                                                                                                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v5_machine_material_getColorGroupListByUser | List the user's colour groups — the cloud's slot→colour→material store. | —                                                                                     | [LIVE 2026-11-21] | array of {key, color}; read side of the custom-filament path                                                                                                                                                      |
| v5_machine_material_addUserColorGroup       | Create a user colour group.                                             | color_group/slots/slot_index + material_type/tid/name/unit [INFERRED, binary structs] | [LIVE 2026-11-21] | the write path a custom-filament feature extends; shape from cloud_sdk_cpp struct fields (§4.2), never a live exchange (validated live 2026-11-21; see endpoint-write-window doc)                                 |
| v5_machine_material_editUserColorGroup      | Edit an existing colour group.                                          | group_id + above [INFERRED]                                                           | [INFERRED-write]  | never called                                                                                                                                                                                                      |
| v5_machine_material_deleteUserColorGroup    | Delete a colour group.                                                  | group_id [INFERRED]                                                                   | [INFERRED-write]  | destructive (removes stored user material state); never called                                                                                                                                                    |
| v5_printer_properties_query                 | Query the cloud property mirror of the MQTT report tree.                | unknown                                                                               | [LIVE 2026-11-21] | plain HTTP 404 on this deployment — registered in the SDK but not served here (validated live 2026-11-21; see endpoint-write-window doc)                                                                          |
| v5_printer_file_thumbnail_list              | List thumbnails for a printer's files.                                  | unknown                                                                               | [LIVE 2026-11-21] | plain HTTP 404 on this deployment (validated live 2026-11-21; see endpoint-write-window doc)                                                                                                                      |
| v5_project_info                             | One cloud project's detail.                                             | `id` (project id, must be >0)                                                         | [LIVE 2026-11-21] | bare: `invalid GetProjectInfoReq.Id: value must be greater than 0`; with id=1: `Print item does not exist` — validator passed, needs a real project id (validated live 2026-11-21; see endpoint-write-window doc) |
| v5_project_list                             | List cloud projects.                                                    | — (pagination likely, unverified)                                                     | [LIVE 2026-11-21] | 10 projects: project_id/project_name/printer_name/printer_id/model_id/model_name/print_status/status_params/start_time/end_time/estimate_seconds/img/dual_platform_mode_enable                                    |
| v5_project_source                           | A cloud project's source artefacts.                                     | `id` (project id, must be >0)                                                         | [LIVE 2026-11-21] | same Id validator; with id=1: `Print item does not exist` (validated live 2026-11-21; see endpoint-write-window doc)                                                                                              |
| v5_mqtt_status_report                       | Relay MQTT connection status to the cloud.                              | [INFERRED]                                                                            | [INFERRED-write]  | never called                                                                                                                                                                                                      |
| v5_alarm_message_batchSetRead               | Mark several alarm messages read.                                       | [INFERRED]                                                                            | [LIVE 2026-11-21] | never called (validated live 2026-11-21; see endpoint-write-window doc)                                                                                                                                           |
| v5_cloud-file_folder_create                 | Create a cloud-drive folder.                                            | [INFERRED]                                                                            | [LIVE 2026-11-21] | never called (validated live 2026-11-21; see endpoint-write-window doc)                                                                                                                                           |
| v5_cloud-file_folder_delete                 | Delete a cloud-drive folder.                                            | [INFERRED]                                                                            | [INFERRED-write]  | destructive; never called                                                                                                                                                                                         |
| v5_cloud-file_folder_rename                 | Rename a cloud-drive folder.                                            | [INFERRED]                                                                            | [LIVE 2026-11-21] | never called (validated live 2026-11-21; see endpoint-write-window doc)                                                                                                                                           |
| v5_cloud-file_folder_list                   | List cloud-drive folders.                                               | —                                                                                     | [LIVE 2026-11-21] | code 1, empty array (no folders on this account)                                                                                                                                                                  |
| v5_cloud-file_item_move                     | Move an item between folders.                                           | [INFERRED]                                                                            | [LIVE 2026-11-21] | never called (validated live 2026-11-21; see endpoint-write-window doc)                                                                                                                                           |
| v5_project_printHistory_detail              | One print-history task's detail.                                        | `task_id`                                                                             | CONFIRMED (repo)  | the one /v5 route the repo already touches                                                                                                                                                                        |

### work

| id                          | function                                                              | params                                                     | status            | notes                                                                                                          |
| --------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| work_printer_info           | Printer detail on the workbench lane.                                 | `id` [INFERRED]                                            | [UNKNOWN]         | bare code 0 `request error` naming no field — param contract unresolved                                        |
| work_printer_unsetprinters  | Unbind printer(s) from the account.                                   | [INFERRED]                                                 | [INFERRED-write]  | destructive; deletion-class (research doc §7); never called                                                    |
| work_work_addprinter        | Bind a printer to the account.                                        | [INFERRED]                                                 | [INFERRED-write]  | CONTRACT+BUSINESS 2026-11-21                                                                                   | AddPrinterReq.Key (printer key, not SN); with our real key the server answers 'Please check the server selection in the printer' (region mismatch) — contract validated, business rules engaged |
| work_project_report         | Report project state to the workbench.                                | [INFERRED]                                                 | [INFERRED-write]  | never called                                                                                                   |
| work_project_unsetprojects  | Remove project(s) from the account.                                   | [INFERRED]                                                 | [INFERRED-write]  | destructive; deletion-class (research doc §7); never called                                                    |
| work_index_getUploadStatus  | Upload state machine status.                                          | id (param name uncertain)                                  | [REFUSED-PARAM]   | bare: `please input id`; retry with a real cloud-file id still `please input id` — expected param name unclear |
| work_index_renameFile       | Rename an account file.                                               | [INFERRED]                                                 | [LIVE 2026-11-21] | never called (validated live 2026-11-21; see endpoint-write-window doc)                                        |
| work_index_delFiles         | Delete account files.                                                 | [INFERRED]                                                 | [INFERRED-write]  | destructive; deletion-class (research doc §7); never called                                                    |
| work_gcode_info             | G-code artefact info.                                                 | `id` (gcode id, not task id)                               | CONFIRMED (repo)  | read                                                                                                           |
| work_gcode_infoFdm          | FDM g-code info; resolves gcode id to cloud file id + slice metadata. | `id`                                                       | CONFIRMED (repo)  | 63-field generated catalog                                                                                     |
| work_index_getModelFileInfo | Cloud model file detail.                                              | `id` (file id)                                             | CONFIRMED (repo)  | read                                                                                                           |
| work_index_getUserStore     | Account cloud-storage quota.                                          | —                                                          | CONFIRMED (repo)  | quota preflight for the upload flow                                                                            |
| work_index_userFiles        | List the account's cloud files.                                       | —                                                          | CONFIRMED (repo)  | read                                                                                                           |
| work_operation_sendOrder    | Send a legacy order (print control, settings, queries) to a printer.  | `printer_id` + `order_id` + `msgid` + `timestamp` + `data` | CONFIRMED (repo)  | START_PRINT=1 / STOP_PRINT=4 live-validated 2026-09-11; other order ids descriptive-only                       |
| work_printer_getPrinters    | List the account's printers (legacy workbench route).                 | —                                                          | CONFIRMED (repo)  | no longer served on Slicer 2.0.0.3; kept as discovery fallback                                                 |
| work_project_getProjects    | Paginated cloud projects listing.                                     | `page` + `limit` + `print_status`                          | CONFIRMED (repo)  | pagination shape repo-proven                                                                                   |

### farm

The 2026-11-21 sweep probed all six uncovered farm reads: one bare refusal,
five naming their guard field; file/info was already repo-confirmed; every
write/destructive row is unapproached.

| id                            | function                                                           | params                                                           | status            | notes                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| farm_printer_createBulkTask   | Create bulk print tasks across farm printers (file-path dispatch). | `filePath` + `taskType` [INFERRED via the app's own local route] | [INFERRED-write]  | hardware-affecting once a farm printer accepts; never called                                                                         |
| farm_device_createBulkTask    | Create bulk print tasks by device id (cloud-file variant).         | undocumented                                                     | [INFERRED-write]  | hardware-affecting; request shape undocumented; never called                                                                         |
| farm_printer_setCleanPlate    | Run a farm printer's plate-clean routine.                          | [INFERRED]                                                       | [INFERRED-write]  | CONFIRMED 2026-11-21                                                                                                                 | {printer_ids[]} alone; code 1 |
| farm_group_list               | List farm printer groups.                                          | unknown                                                          | [LIVE 2026-11-21] | bare code 0 `request error` naming no field — expected params unknown                                                                |
| farm_file_info                | Cloud file detail on the farm shelf.                               | `id`                                                             | CONFIRMED (repo)  | the only /farm route this repo touches                                                                                               |
| farm_message_list             | List farm messages.                                                | `page`                                                           | [LIVE 2026-11-21] | bare: `page require`                                                                                                                 |
| farm_message_info             | One farm message's detail.                                         | `message_id`                                                     | [REFUSED-PARAM]   | bare: `message_id require`                                                                                                           |
| farm_message_latest           | Latest farm message.                                               | `aggregate_mode`                                                 | [REFUSED-PARAM]   | bare: `aggregate_mode require`; retry with aggregate_mode=1 still refused — expected value shape unclear                             |
| farm_message_printerErrorList | Farm printer error events.                                         | `message_id`                                                     | [REFUSED-PARAM]   | bare: `message_id require`                                                                                                           |
| farm_message_statistics       | Farm message statistics.                                           | `aggregate_mode`                                                 | [LIVE 2026-11-21] | bare: `aggregate_mode require`; retry with aggregate_mode=1 still refused (validated live 2026-11-21; see endpoint-write-window doc) |
| farm_message_read             | Mark farm messages read.                                           | [INFERRED]                                                       | [INFERRED-write]  | never called                                                                                                                         |
| farm_message_delete           | Delete one farm message.                                           | [INFERRED]                                                       | [INFERRED-write]  | destructive; deletion-class (research doc §7); never called                                                                          |
| farm_message_bulkDelete       | Delete several farm messages at once.                              | [INFERRED]                                                       | [INFERRED-write]  | destructive; deletion-class (research doc §7); never called                                                                          |

### user

The account lane. The repo exercises exactly one route here (profile/userInfo,
under the unregistered /v1 prefix spelling); the SDK registers the plain
/user spelling.

| id                                    | function                                           | params                          | status            | notes                                                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------- | ------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| user_public_login                     | Password login.                                    | [INFERRED]                      | [INFERRED-write]  | credential lane — kept out of automation, never logged; never called                                                                                                  |
| user_public_logout                    | End the account session.                           | [INFERRED]                      | [INFERRED-write]  | CONFIRMED 2026-11-21                                                                                                                                                  | code 1 Exit successful; invalidates the session token; the account JWT re-exchanges (fresh login OK) — the CLI self-heals |
| user_public_register                  | Create an account.                                 | [INFERRED]                      | [INFERRED-write]  | never called                                                                                                                                                          |
| user_public_check_nickname            | Check nickname availability.                       | nickname (param name uncertain) | [LIVE 2026-11-21] | bare: `User nickname is required`; retry with a probe nickname still refused — expected param name unclear (validated live 2026-11-21; see endpoint-write-window doc) |
| user_public_passwordReset             | Reset the account password.                        | [INFERRED]                      | [INFERRED-write]  | credential lane — never driven without an explicit owner request                                                                                                      |
| user_public_getIpAddress              | Report the caller's IP as the cloud sees it.       | —                               | [LIVE 2026-11-21] | {country, province, city}                                                                                                                                             |
| user_verification_code_newSend        | Send a verification code.                          | [INFERRED]                      | [INFERRED-write]  | VERSION-GATED 2026-11-21                                                                                                                                              | answers 'Please update the APP to the latest version' — the route rejects app 2.0.0.3                                     |
| user_profile_newUploadFile            | Claim a completed upload into the file shelf.      | —                               | [INFERRED-write]  | the repo-validated upload flow calls the /v2/profile twin; the /user spelling never called                                                                            |
| user_profile_userInfo                 | Account profile / identity.                        | —                               | CONFIRMED (repo)  | repo calls the /v1 prefix spelling (unregistered variant); may refuse the raw account JWT                                                                             |
| user_cloud_storage_getTcCosTempToken  | Issue a temporary cloud-object-storage credential. | [INFERRED]                      | [UNKNOWN]         | bare code 0 `request error` — POST body contract unknown; output would be a credential (redacted)                                                                     |
| user_cloud_storage_lockStorageSpace   | Lock storage before an upload.                     | —                               | [INFERRED-write]  | the /v2 twin is repo-validated; the /user spelling never called                                                                                                       |
| user_cloud_storage_unlockStorageSpace | Release the storage lock.                          | —                               | [INFERRED-write]  | the /v2 twin is repo-validated; the /user spelling never called                                                                                                       |

### portal

The unauthenticated pre-login surface. The catalog flags the signed-header
contract as possibly not applying here; the live calls below rode the signed
session, so unauthenticated behaviour is untested.

| id                       | function                           | params     | status            | notes                                                                                                                                                                  |
| ------------------------ | ---------------------------------- | ---------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| portal_index_country     | Country list for the pre-login UI. | —          | [LIVE 2026-11-21] | 248 countries (id/code/name/code2/hot/prefix)                                                                                                                          |
| portal_index_country_hot | Popular-country list.              | —          | [LIVE 2026-11-21] | 6 entries, same shape as country                                                                                                                                       |
| portal_index_feedback    | Submit pre-login feedback.         | [INFERRED] | [INFERRED-write]  | CONFIRMED 2026-11-21                                                                                                                                                   | {reason_id from portal/index/reason (live list), content}; one test submission sent |
| portal_index_reason      | Feedback reason list.              | —          | [LIVE 2026-11-21] | 412 reasons (id/reason/desc/type/push/ui_style/popup/help_url)                                                                                                         |
| portal_index_get_version | Portal/app version banner.         | `platform` | [LIVE 2026-11-21] | bare: `Platform must be filled in`; retry with platform=windows still refused — expected enum/shape unknown (validated live 2026-11-21; see endpoint-write-window doc) |

## Endpoint protocol notes

**Envelope.** Every JSON answer carries a `code`/`msg` envelope: `code: 1` =
success (the success string varies by route — "Operation successful", "Request
accepted", "OK"), `code: 0` = refusal riding HTTP 200 — branch on the
envelope, not the HTTP status. Two /v5 routes answer a plain HTTP 404 with no
envelope at all (SDK-registered, not served on this deployment).

**Validation is gRPC-gateway style.** Number guards surface as
`invalid <ProtoReq>.<Field>: value must be greater than 0` (observed:
GetExternalShelvesReq.Id, GetProjectInfoReq.Id, GetProjectSourceTypeReq.Id,
GetTypeNameAndSkuListByVerNumReq.VerNum); simpler guards surface as
`"<field> require"` (page, message_id, aggregate_mode, type, names,
main_version) or as prose ("User nickname is required", "Platform must be
filled in", "please input id"). A bare probe surfaces exactly one requirement
per call: filling `type=1` on v2_message_getMessages moved the refusal to
`page require` — both fields are required. Treat every refusal message as the
route's parameter contract.

**Method ↔ params slot.** GET params travel in the query string, POST params
in the JSON body (the callEndpoint contract; getPreSignUrlArrWithName took its
names[] array in the body). All refusals above arrived over the correct
channel, so a `require` message means the field name or value shape is wrong,
not the transport.

**Retry outcomes (endpoint-batch-results2.jsonl).** Flipped to code 1 after a
named refusal: v2_printer_getExternalShelves (printer id),
v2_cloud_storage_getPreSignUrlArrWithName (names[]),
v3_material_getTypeNameAndSkuListByVerNum (ver_num). Moved past params to a
semantic miss: v5_project_info/source with id=1 → `Print item does not exist`
(validator passed; needs a real project id). Still refused with the same
message: farm_message_latest/statistics (aggregate_mode=1),
v2_message_getMessages (type=1 → then page), v2_network_plugin_info
(main_version as a string), work_index_getUploadStatus (a real cloud-file id),
user_public_check_nickname (nickname), portal_index_get_version
(platform=windows) — for these the expected param name or value shape is still
unknown; the next probe should come from the SDK string table, not path
semantics.

**Redaction.** callEndpoint redacts credential-shaped keys (token, secret,
password, signature, authorization, credential, api_key) from every response,
and access_token params are never logged. Pre-signed URLs
(v2_cloud_storage_getPreSignUrlArrWithName) are themselves short-lived
credentials — same handling: publish shapes, not URLs.

**Family conventions.** portal wants `platform` (get_version refuses without
it; the string "windows" was rejected). work wants ids (getUploadStatus
demands one; work_printer_info fails generically). farm wants aggregate_mode
(message_latest/statistics) plus page/message_id on the other message reads.
v2 messages want type+page (getMessages). v3 material wants ver_num ≥ 1. /v5
is the project-centric family; its properties/query mirror is a 404 here —
the report tree it would mirror lives in the MQTT registry (research doc
§3.4).

## MQTT live confirmations (probe 4, 2026-11-21, task 144435802 — v2 gcode, 210 °C)

Evidence: `docs/evidence/mqtt-probe4-2026-11-21.jsonl` (372 messages, full job: heat -> print -> park -> cooldown).

| surface                                  | status                   | evidence                                                                                                                                                                     |
| ---------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `axis/query` during an active job        | **CONFIRMED 2026-11-21** | live head position sampled every 25 s: x/y vary per layer, z climbed 5.35 -> 14.87 (54 layers of 0.28 mm), then parked at z 1.74; machine-frame coordinates (y offset > bed) |
| `print` topic during a job               | **CONFIRMED 2026-11-21** | responds `action=start, code 200` to polls while printing (silent when idle)                                                                                                 |
| `tempature` auto reports                 | **CONFIRMED 2026-11-21** | nozzle 209->210 target during job; targets drop to 0 at completion; ~1 msg / 2 s while hot                                                                                   |
| `multiColorBox/getInfo` full slot schema | **CONFIRMED 2026-11-21** | box: temp/humidity (27 °C/22 %), drying_status, auto_feed, loaded_slot; slots: index/sku/type/color/edit_status/status/color_group/icon_type/consumables_percent             |
| `loaded_slot` live evidence              | **CONFIRMED 2026-11-21** | loaded_slot=1 for the whole job -> **ams_index 1 = physical slot 2** (owner numbering), closing the off-by-one empirically                                                   |

## ACE custom-filament findings (the NFC goal, Phase-0 data)

Read from the live multiColorBox during probe 4 (slots after the owner's app-written
custom tags):

- **The ACE reads custom tag data**: slots 1 and 3 report `type` (PETG) and
  `color` values that can only come from the app-written tags, with
  `edit_status: 0` (tag present).
- **The SKU does not resolve for custom tags**: `sku` reports empty on all
  custom slots — the cloud resolver (SKU -> display name) has no entry, exactly
  as the NFC research predicted. Type/color are local facts; SKU resolution is
  cloud-side.
- `consumables_percent` stays 0 on custom slots (either the app writes no
  weight, or tracking only engages for known SKUs).
- Slot 2 reported `edit_status: 1` (manual) this cycle: the ACE's tag read is
  not always surfaced per cycle, or the slot was last set manually.
- Consequence for the custom-filament plan: custom tags are **partially
  first-class already** (type/color read locally); full first-class needs
  either a catalog-recognized SKU (test: copy a real Anycubic SKU onto a
  custom tag) or our own local inventory mapping (ace_raw_report + this
  ledger), which is exactly the local-control path the owner asked for.

## Probe capture discipline (lessons, 2026-11-20/21)

- Background sweeps are unreliable for this script (stdin/tty quirks killed
  three windows); **run capture windows in FOREGROUND** (~5 min each, the
  sweep appends) — proven end-to-end in probe 4.
- **Any MCP server spawn displaces the sweep's MQTT session** (deterministic
  clientId monopoly): no `anycubic`/`mcp-call` invocations during a capture
  window; validate HTTP endpoints BETWEEN windows.
- The sweep's read-only guard refuses `filament/queryInfo` (not in
  READ_ONLY_ACTIONS) — testing it needs a dedicated probe or a catalog change.

## Final state after the full campaign (2026-11-21, 8 validation rounds)

59 of 93 CONFIRMED live. The remaining 34, by the exact reason each stays closed:

- Data-blocked (2): farm_message_info / printerErrorList — the account has zero farm
  messages, so no row id exists to chain.
- Flow-blocked (1): getoauthToken — needs the one-time Casdoor code from the
  browser leg (localhost:21328 callback); only an interactive login produces it.
- Contract-blocked (6): getUploadStatus (file/gcode/lock ids all refused; the
  upload-record id from newUploadFile is the untested hypothesis), getTcCosTempToken
  and work_printer_info (generic request error), edit/deleteUserColorGroup (the
  add is accepted but no readable surface returns the group id; get_all/group_type
  reads confirmed code 1 without revealing it), work_project_report (its project
  id space is not the v5 task space), v2_device_save (payload unknown, risky).
- Policy-gated (25): hardware (sendFile, bulkTasks, cleanPlate), auth-session
  (login/logout/register/passwordReset/code-send), feedback, binding — contracts
  documented INFERRED in endpoint-params-web-2026-11-21.md §6; not probed by design.

Cross-cutting lessons of the campaign: the validators reveal exactly one
requirement per call (type->page->limit; platform->version_code;
main_version->plugin_key->os_version; Type->Action->State) — the systematic
method for any future route; storage names must carry a valid file extension
(remote_name AND lock names); two base paths exist (/p/t/ and /p/p/workbench/api);
the SDK format-string grammar at 6588040-6588240 covers {id}, {type,page,limit}
and {ids[]}.

## Pass B (owner-authorized hardware/auth/feedback/binding, 2026-11-21)

- **v3/printer/sendFile CONFIRMED**: printer_ids[] + the 3MF cloud FILE id; code 1
  with a msgid; the file lands on the printer WITHOUT starting a print
  (device_status stays 1) — the v3 push lane, distinct from print start.
- **farm/printer/setCleanPlate CONFIRMED** ({printer_ids[]}).
- **v2/device/save CONFIRMED**: SavePrinterLanModeReq with device_id = the printer
  key (the LAN-mode save).
- **portal/index/feedback CONFIRMED** (reason_id + content; one clearly-labelled
  test submission).
- **user/public/logout CONFIRMED**: invalidates the session token; the account JWT
  re-exchanges on fresh login (verified immediately after) — the connector
  self-heals.
- **addprinter**: AddPrinterReq.Key validated; the server's business layer answers
  a region-selection refusal for our (already-bound) key.
- **bulkTask chain (4 layers)**: printer_ids -> is_start_print -> data envelope ->
  print_number; unreachable past validation without farm printers on the account.
- **newSend is version-gated**: 'Please update the APP to the latest version'
  (2.0.0.3 rejected for that route).
- Remaining closed doors after the full campaign: 2 data-blocked (farm messages),
  register/passwordReset (email+code — the owner can supply a throwaway email +
  read the code to close them), login (password, by decision), getoauthToken
  (browser leg), 5 contract-blocked (getUploadStatus id space, getTcCosTempToken,
  work_printer_info, UserColorGroup edit/delete ids, WorkProjectId space), and
  the bulkTask/addprinter business gates.
