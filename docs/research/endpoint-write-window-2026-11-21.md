# Write-probe window (owner-approved, 2026-11-21)

The owner approved exercising WRITE endpoints against throwaway data. Skipped
classes, documented and NOT probed: hardware-affecting (sendFile,
createBulkTask, setCleanPlate), auth-session (login/logout/register/
passwordReset/code-send), external side effects (feedback forms), binding
mutations (addprinter, device_save — no throwaway target exists).

## Confirmed live (code 1)

| route                                 | params that worked                            | note                                                                                                                                                                                                                   |
| ------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v5_cloud-file_folder_create           | `{name}`                                      | created ZZ-probe-scratch-folder (id 21668)                                                                                                                                                                             |
| v5_cloud-file_folder_rename           | `{folder_id, name}`                           | FolderId contract from the validator                                                                                                                                                                                   |
| v5_cloud-file_item_move               | `{file_ids[], target_folder_id}`              | moved the probe file in and back out (folder 0 = root)                                                                                                                                                                 |
| v2_message_setReadById                | `{id}`                                        | marked message 189300218 read                                                                                                                                                                                          |
| v2_message_setRead                    | `{id, type: 1}`                               |                                                                                                                                                                                                                        |
| v5_alarm_message_batchSetRead         | `{message_ids: [...]}`                        | MessageIds array with length bounds                                                                                                                                                                                    |
| v3_user_setSlicerConfig               | `{url}` (top-level field!)                    | echo of the getSlicerConfig url — no-op                                                                                                                                                                                |
| work_index_renameFile                 | `{id, name}`                                  | "Modification successful"; renamed and restored                                                                                                                                                                        |
| v5_machine_material_addUserColorGroup | `{name, color, material_type, color_type: 1}` | accepted (code 1); **the created group does not surface in getColorGroupListByUser** (that list returns the preset palettes flat/gradient/luminous) — where user groups surface is an open question for the SDK mining |

## Param contracts learned from refusals (gRPC-gateway validators)

- AddUserColorGroupReq.ColorType greater than 0; EditUserColorGroupReq.Id
  greater than 0; RenameCloudFileFolderReq.FolderId greater than 0;
  BatchSetReadAlarmMessageReq.MessageIds (array, length bounds);
  MqttStatusReportReq.Type (regex pattern, unknown); SetSlicerConfigReq.Url
  (at least 1 rune); work renameFile wants `id must filled in`; the
  /user lockStorageSpace twin wants `ID` (unlike the /v2 contract);
  v3_public_getoauthToken wants `code` (an OAuth code, not the account JWT —
  app-flow dependent).

## Cleanup state

- Probe file restored (name + root location). One real message marked read
  (three variants exercised). Scratch folder ZZ-probe-scratch-folder-2
  (id 21668) REMAINS: the 93-route catalog has no folder-delete route.
- Possibly an orphan user color group server-side (the add was accepted but
  the group is not visible in any list we can read).
- v5_machine_material_editUserColorGroup / deleteUserColorGroup stay
  REFUSED-PARAM: they need an Id we cannot discover through any readable
  surface yet.
