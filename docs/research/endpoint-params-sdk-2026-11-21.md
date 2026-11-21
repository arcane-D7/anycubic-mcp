# SDK-mined request params (salvaged + validated, 2026-11-21)

The mining agent died mid-run (response truncation); its transcript findings
were salvaged by the parent and every param below was then validated LIVE.
Source: static analysis of `cloud_sdk_cpp.dll` string clusters and lea
references (transcript of deleg_8ad82fc4) + the live rounds in
`poc-output/endpoint-batch-results*.jsonl`.

## Findings that changed the picture

1. **Two registered base paths** at the top of the endpoint table:
   `/p/t/workbench/api` (offset 6549640) and `/p/p/workbench/api` (6549664).
   The table rows are path suffixes; most routes answer without the prefix on
   the deployed host, but these bases are the SDK's canonical composition.
2. **Farm family field pool** (cluster 6584856-6586480): `code, limit, msg,
message_id, pageData, status, data, aggregate_mode, printer_id,
latest_time, label_id, update_status, label_name, keyword, model, name,
message_ids` — the farm list/statistics validators read exactly this set.
3. **network_plugin cluster** (6573024-6573680): `platform, main_version,
plugin_key, version_code, is_force_update` (+ disassembled refs to
   `os_version`, `os_name`, `architecture`) — a device/plugin registration
   contract, not a plain config read.
4. **`upload_id` exists as a string** (6599772) — the getUploadStatus
   contract, though `upload_id`/`id` both fail against gcode ids (probably
   the LOCK id from lockStorageSpace, untested).
5. `nickname` (6587501, UTF-16LE), `user_nickname` is the wire key
   (live-confirmed earlier).

## Validated param contracts (LIVE 2026-11-21, code 1 answers)

| route                        | the params that worked                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| POST /farm/message/list      | `{page, limit, status, aggregate_mode, label_id, keyword}` (empty answer is success)  |
| POST /farm/group/list        | `{page, limit}`                                                                       |
| POST /v2/network_plugin/info | `{platform, main_version, plugin_key, os_version, os_name, architecture}` (data null) |

## Escalation chains observed (one requirement per call)

- network_plugin/info: `main_version require` -> `plugin_key require` ->
  `os_version require` -> code 1 with the full cluster.
- farm_message_list: `page require` -> `limit require` -> `status require` ->
  `aggregate_mode require` -> code 1 with the full pool.
- v2_message_getMessages: `type` -> `page` -> `limit` -> code 1.
- portal get_version: `Platform` -> `Version_code` -> code 1.

## Still open (honest)

- work_index_getUploadStatus: "please input id" persists for `id` and
  `upload_id` against gcode/file ids; the LOCK id hypothesis is untested.
- user_cloud_storage_getTcCosTempToken + farm_group_list[GET] +
  work_printer_info: generic `request error` / `Unmodified content` — no
  named field surfaced; work_printer_info may be an ETag-style route.
- The `/user` lockStorageSpace twin wants `ID` (unlike /v2's
  size/name/is_temp_file contract).
