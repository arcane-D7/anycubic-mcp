/**
 * Declarative catalog of the Anycubic cloud workbench API — the full 93-endpoint
 * surface the Slicer Next 2.0.0.3 SDK (`cloud_sdk_cpp.dll`) registers.
 *
 * Source of truth: `docs/research/slicer-binary-surface-2026-11-18.md` §1 — the
 * contiguous registration table at `cloud_sdk_cpp.dll` offsets 6549640–6552896.
 * `offset` is the string's file offset in that DLL; `null` where the research
 * doc does not quote one (the already-covered routes were enumerated by family
 * count, not by offset).
 *
 * `covered: true` marks routes this repo's connector already exercises
 * (scripts/anycubic-cloud.mjs, scripts/printer-full-read.mjs,
 * scripts/printer-expansion-tools.mjs, scripts/audit-gap-tools.mjs,
 * scripts/printer-command-bus.mjs): 23 of 93. The remaining 70 are new here.
 * This module only DECLARES them — tool wiring (CLI/vendor/bridge) is a
 * separate lane and must not grow here.
 *
 * Safety classes are static readings of path semantics from the research doc,
 * not live-verified behaviour:
 *  - `read`        — no server-side state change expected
 *  - `write`       — creates or mutates account/printer state
 *  - `destructive` — deletes data or unbinds resources
 * Deletion-class endpoints are documented as existing and MUST NOT be
 * exercised against the live cloud without a separate, explicit approval.
 *
 * This module is a leaf: its only import is `zod`, so the frozen bundle can
 * wire it without dragging the MQTT stack or the cloud client in.
 */
import { z } from "zod";

/** Confirmation word required for write/destructive calls. */
export const CONFIRM_WORD = "EXECUTE";

export const SAFETY = Object.freeze({
  READ: "read",
  WRITE: "write",
  DESTRUCTIVE: "destructive",
});

/** Where a parameter claim comes from, strongest first. */
export const PARAM_EVIDENCE = Object.freeze({
  REPO_VALIDATED: "repo-validated", // exercised by this repo against the live API
  BINARY_STRUCT: "binary-struct", // field named in the research doc with a DLL offset
  LOCAL_ROUTE: "local-route", // param names the app's own loopback HTTP routes expose
  RESEARCH_DOC: "research-doc", // documented in this repo's research records
  PATH_NAME: "path-name", // derived from the path itself (weakest)
  INFERRED: "inferred", // plausible, unverified
});

/** How confident the HTTP method is. */
export const METHOD_EVIDENCE = Object.freeze({
  REPO_VALIDATED: "repo-validated", // this repo's code sends exactly this method
  RESEARCH_DOC: "research-doc", // a research record documents the method
  LIVE: "live", // live-validated (2026-11-21 write window: POST + printer_id)
  INFERRED: "inferred", // guessed from path semantics
});

export class CloudEndpointError extends Error {
  /**
   * @param {string} code machine-readable: UNKNOWN_ENDPOINT | INVALID_PARAMS |
   *   CONFIRMATION_REQUIRED | INVALID_CATALOG
   * @param {string} message human-readable, includes the next step
   * @param {object|null} details structured extras (issues, safety, ...)
   */
  constructor(code, message, details = null) {
    super(message);
    this.name = "CloudEndpointError";
    this.code = code;
    this.details = details;
  }
}

/** One declared request parameter. */
const param = (name, type, evidence, { required = false, note } = {}) =>
  Object.freeze({ name, type, required, evidence, ...(note ? { note } : {}) });

/**
 * One catalog entry. `id` is mechanically derived from the path (leading slash
 * stripped, `/` → `_`), so ids stay unique exactly as long as paths are.
 */
const endpoint = (
  family,
  method,
  methodEvidence,
  path,
  purpose,
  safety,
  offset,
  { covered = false, params = [], notes = [] } = {},
) =>
  Object.freeze({
    id: path.slice(1).replaceAll("/", "_"),
    family,
    method,
    methodEvidence,
    path,
    purpose,
    safety,
    /** cloud_sdk_cpp.dll string offset; null when the research doc quotes none. */
    offset,
    covered,
    params: Object.freeze(params),
    ...(notes.length ? { notes: Object.freeze(notes) } : {}),
  });

/* ---------------------------------------------------------------------------
 * /farm/* — 13 registrations (12 new of 13), the multi-printer product line.
 * ------------------------------------------------------------------------- */
const FARM = [
  endpoint(
    "farm",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/farm/printer/createBulkTask",
    "Create bulk print tasks across farm printers (file-path dispatch).",
    SAFETY.WRITE,
    6551632,
    {
      params: [
        param("filePath", "string", PARAM_EVIDENCE.LOCAL_ROUTE, {
          note: "the app's own /api/v1/FramSelectGcodeFile/sendGcodeCreateBulkTask exposes these names",
        }),
        param("taskType", "string", PARAM_EVIDENCE.LOCAL_ROUTE),
      ],
      notes: ["dispatches print jobs — hardware-affecting once accepted"],
    },
  ),
  endpoint(
    "farm",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/farm/device/createBulkTask",
    "Create bulk print tasks by device id (cloud-file variant).",
    SAFETY.WRITE,
    6551912,
    {
      notes: [
        "the app's sendCloudFileIdBulkTask local route exposes no parameter names; request shape undocumented",
      ],
    },
  ),
  endpoint(
    "farm",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/farm/printer/setCleanPlate",
    "Run a farm printer's plate-clean routine.",
    SAFETY.WRITE,
    6551848,
    { notes: ["drives printer hardware once accepted"] },
  ),
  endpoint(
    "farm",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/farm/group/list",
    "List the account's farm printer groups.",
    SAFETY.READ,
    6551672,
  ),
  endpoint(
    "farm",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/farm/file/info",
    "Cloud file detail on the farm shelf.",
    SAFETY.READ,
    6551696,
    {
      covered: true,
      params: [
        param("id", "number", PARAM_EVIDENCE.REPO_VALIDATED, {
          note: "cloud file id (CLOUD_HTTP_ENDPOINTS `cloud_file_info`)",
        }),
      ],
      notes: ["the only /farm route this repo already touches"],
    },
  ),
  endpoint(
    "farm",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/farm/message/list",
    "List farm messages.",
    SAFETY.READ,
    6552376,
  ),
  endpoint(
    "farm",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/farm/message/info",
    "One farm message's detail.",
    SAFETY.READ,
    6552400,
  ),
  endpoint(
    "farm",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/farm/message/latest",
    "Latest farm message.",
    SAFETY.READ,
    6552496,
  ),
  endpoint(
    "farm",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/farm/message/printerErrorList",
    "Farm printer error events.",
    SAFETY.READ,
    6552424,
  ),
  endpoint(
    "farm",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/farm/message/statistics",
    "Farm message statistics.",
    SAFETY.READ,
    6552568,
  ),
  endpoint(
    "farm",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/farm/message/read",
    "Mark farm messages read.",
    SAFETY.WRITE,
    6552600,
  ),
  endpoint(
    "farm",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/farm/message/delete",
    "Delete one farm message.",
    SAFETY.DESTRUCTIVE,
    6552464,
  ),
  endpoint(
    "farm",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/farm/message/bulkDelete",
    "Delete several farm messages at once.",
    SAFETY.DESTRUCTIVE,
    6552624,
  ),
];

/* ---------------------------------------------------------------------------
 * /v5/* — 17 registrations (16 new of 17), the current-version API. The
 * machine_material quartet is the custom-filament write path.
 * ------------------------------------------------------------------------- */
// Shared material-identity fields: named as cloud_sdk_cpp.dll request structs
// in docs/research/slicer-binary-surface-2026-11-18.md §4.2. Request shapes are
// inferred from struct fields, never live-exercised (doc §7).
const MATERIAL_IDENTITY_PARAMS = [
  param("material_type", "string", PARAM_EVIDENCE.BINARY_STRUCT),
  param("material_tid", "string", PARAM_EVIDENCE.BINARY_STRUCT),
  param("material_name", "string", PARAM_EVIDENCE.BINARY_STRUCT),
  param("material_unit", "string", PARAM_EVIDENCE.BINARY_STRUCT),
];
const COLOR_GROUP_PARAMS = [
  param("color_group", "object", PARAM_EVIDENCE.BINARY_STRUCT, {
    note: "report-side struct field (mach_mqtt.dll 905784–906000); RGBA colour group",
  }),
  param("slots", "object", PARAM_EVIDENCE.BINARY_STRUCT, {
    note: "slot list of the group; exact element shape not live-verified",
  }),
  param("slot_index", "number", PARAM_EVIDENCE.BINARY_STRUCT),
];

const V5 = [
  endpoint(
    "v5",
    "GET",
    METHOD_EVIDENCE.RESEARCH_DOC,
    "/v5/machine_material/getColorGroupListByUser",
    "List the user's colour groups — how the cloud stores slot→colour→material assignments.",
    SAFETY.READ,
    6552088,
    {
      notes: [
        "read side of the custom-filament write path; research-doc investigation priority #7",
        "pairs with the solt_color_material_match print-order field (cloud_sdk_cpp.dll 6581488)",
      ],
    },
  ),
  endpoint(
    "v5",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v5/machine_material/addUserColorGroup",
    "Create a user colour group (slot→colour→material assignment).",
    SAFETY.WRITE,
    6552144,
    {
      params: [...COLOR_GROUP_PARAMS, ...MATERIAL_IDENTITY_PARAMS],
      notes: [
        "the write path a custom-filament feature extends (doc §4.2)",
        "request shape inferred from struct field names, not from a live exchange (doc §7)",
      ],
    },
  ),
  endpoint(
    "v5",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v5/machine_material/editUserColorGroup",
    "Edit an existing user colour group.",
    SAFETY.WRITE,
    6552192,
    {
      params: [
        param("group_id", "number", PARAM_EVIDENCE.INFERRED),
        ...COLOR_GROUP_PARAMS,
        ...MATERIAL_IDENTITY_PARAMS,
      ],
      notes: ["request shape inferred (doc §7)"],
    },
  ),
  endpoint(
    "v5",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v5/machine_material/deleteUserColorGroup",
    "Delete a user colour group.",
    SAFETY.DESTRUCTIVE,
    6552240,
    {
      params: [param("group_id", "number", PARAM_EVIDENCE.INFERRED)],
      notes: ["removes stored user material state"],
    },
  ),
  endpoint(
    "v5",
    "POST",
    METHOD_EVIDENCE.LIVE,
    "/v5/printer/properties/query",
    "Query the cloud property mirror of the MQTT report tree.",
    SAFETY.READ,
    6551808,
    {
      notes: [
        "the report tree it mirrors is the 31-struct registry of doc §3.4; parameter contract undocumented",
      ],
    },
  ),
  endpoint(
    "v5",
    "POST",
    METHOD_EVIDENCE.LIVE,
    "/v5/printer/file/thumbnail/list",
    "List thumbnails for a printer's files.",
    SAFETY.READ,
    6552336,
  ),
  endpoint(
    "v5",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/v5/project/info",
    "One cloud project's detail.",
    SAFETY.READ,
    6551888,
    {
      params: [
        param("id", "number", PARAM_EVIDENCE.INFERRED, {
          note: "the /v2 twin takes the project id (repo-validated)",
        }),
      ],
    },
  ),
  endpoint(
    "v5",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/v5/project/list",
    "List cloud projects.",
    SAFETY.READ,
    6552872,
    {
      notes: ["likely paginated like /v2/project/printHistory; unverified"],
    },
  ),
  endpoint(
    "v5",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/v5/project/source",
    "A cloud project's source artefacts.",
    SAFETY.READ,
    6552896,
  ),
  endpoint(
    "v5",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v5/mqtt/status/report",
    "Relay MQTT connection status to the cloud.",
    SAFETY.WRITE,
    6552656,
  ),
  endpoint(
    "v5",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v5/alarm_message/batchSetRead",
    "Mark several alarm messages read.",
    SAFETY.WRITE,
    6552528,
  ),
  endpoint(
    "v5",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v5/cloud-file/folder/create",
    "Create a cloud-drive folder.",
    SAFETY.WRITE,
    6552688,
  ),
  endpoint(
    "v5",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v5/cloud-file/folder/delete",
    "Delete a cloud-drive folder.",
    SAFETY.DESTRUCTIVE,
    6552728,
  ),
  endpoint(
    "v5",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v5/cloud-file/folder/rename",
    "Rename a cloud-drive folder.",
    SAFETY.WRITE,
    6552768,
  ),
  endpoint(
    "v5",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/v5/cloud-file/folder/list",
    "List cloud-drive folders.",
    SAFETY.READ,
    6552840,
  ),
  endpoint(
    "v5",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v5/cloud-file/item/move",
    "Move an item between cloud-drive folders.",
    SAFETY.WRITE,
    6552808,
  ),
  endpoint(
    "v5",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v5/project/printHistory/detail",
    "One print-history task's detail.",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [param("task_id", "number", PARAM_EVIDENCE.REPO_VALIDATED)],
      notes: ["the one /v5 route this repo already touches (printer-expansion-tools.mjs)"],
    },
  ),
];

/* ---------------------------------------------------------------------------
 * /v3/* — 10 registrations (7 new of 10; 3 already covered).
 * ------------------------------------------------------------------------- */
const V3 = [
  endpoint(
    "v3",
    "GET",
    METHOD_EVIDENCE.RESEARCH_DOC,
    "/v3/material/getTypeNameAndSkuListByVerNum",
    "The filament catalogue: material type names + SKU lists, keyed by catalogue version.",
    SAFETY.READ,
    6551328,
    {
      params: [
        param("ver_num", "number", PARAM_EVIDENCE.PATH_NAME, {
          note: "catalogue version; the server may default to latest — confirm live",
        }),
      ],
      notes: [
        "the type↔SKU vocabulary a custom-filament flow must speak; research-doc priority #4",
      ],
    },
  ),
  endpoint(
    "v3",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v3/printer/sendFile",
    "Send a cloud file to a printer.",
    SAFETY.WRITE,
    6551720,
  ),
  endpoint(
    "v3",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/v3/engine/getLatestVersion",
    "Latest slicer engine version (update check).",
    SAFETY.READ,
    6551440,
    { notes: ["supersedes the unregistered /work/printer/getPrinterUpdateVersion"] },
  ),
  endpoint(
    "v3",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/v3/user/getSlicerConfig",
    "Cloud-synced slicer settings.",
    SAFETY.READ,
    6551568,
  ),
  endpoint(
    "v3",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v3/user/setSlicerConfig",
    "Write cloud-synced slicer settings.",
    SAFETY.WRITE,
    6551600,
  ),
  endpoint(
    "v3",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v3/work_project/feedback",
    "Submit feedback for a cloud project.",
    SAFETY.WRITE,
    6552016,
  ),
  endpoint(
    "v3",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v3/public/getoauthToken",
    "OAuth token exchange.",
    SAFETY.WRITE,
    6551296,
    {
      notes: [
        "probed as an exchange alternative on 2.0.0.3 and did not yield a session (docs/research/cloud-auth-2026-11-18.md)",
      ],
    },
  ),
  endpoint(
    "v3",
    "POST",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v3/public/loginWithAccessToken",
    "Exchange an account JWT for a workbench session token.",
    SAFETY.WRITE,
    null,
    {
      covered: true,
      params: [
        param("device_type", "string", PARAM_EVIDENCE.REPO_VALIDATED),
        param("access_token", "string", PARAM_EVIDENCE.REPO_VALIDATED, {
          note: "never logged or echoed; see the redaction default in the auth lane",
        }),
      ],
      notes: [
        "legacy exchange: Slicer Next 2.0.0.3 answers code 0 and the account JWT is used directly as XX-Token",
        "the auth lane lives in scripts/anycubic-cloud.mjs + scripts/cloud-auth-shared.mjs — not here",
      ],
    },
  ),
  endpoint(
    "v3",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v3/printer/getVideoThumbnailList",
    "List a device's video thumbnails.",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [param("device_id", "number", PARAM_EVIDENCE.REPO_VALIDATED)],
    },
  ),
  endpoint(
    "v3",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v3/work_project/getErrorList",
    "Camera/AI inspection defect categories for a project.",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [param("id", "number", PARAM_EVIDENCE.REPO_VALIDATED, { note: "project id" })],
    },
  ),
];

/* ---------------------------------------------------------------------------
 * /v2/* — 20 registrations (11 new of 20; 9 already covered).
 * ------------------------------------------------------------------------- */
const V2 = [
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.RESEARCH_DOC,
    "/v2/printer/getExternalShelves",
    "External spool shelves (`external_shelves`) — the non-ACE-box material path.",
    SAFETY.READ,
    6551216,
    {
      params: [
        param("id", "number", PARAM_EVIDENCE.INFERRED, {
          note: "printer id, like the repo's other v2 printer reads",
        }),
      ],
      notes: [
        "`external_shelves` is a cloud_sdk_cpp.dll struct field (6592848); research-doc priority #5",
      ],
    },
  ),
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/v2/device/getPrintOption",
    "Print options for a device.",
    SAFETY.READ,
    6551384,
  ),
  endpoint(
    "v2",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v2/device/save",
    "Save device settings.",
    SAFETY.WRITE,
    6551416,
  ),
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.RESEARCH_DOC,
    "/v2/message/getMessageCount",
    "Unread message counts.",
    SAFETY.READ,
    6550840,
    {
      notes: [
        "live-evidenced on 2.0.0.3 with the account JWT as XX-Token (docs/research/cloud-auth-2026-11-18.md)",
      ],
    },
  ),
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/v2/message/getMessages",
    "List account messages.",
    SAFETY.READ,
    6550808,
  ),
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/v2/message/hasNewMessage",
    "Whether new messages exist.",
    SAFETY.READ,
    6550936,
  ),
  endpoint(
    "v2",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v2/message/setRead",
    "Mark messages read.",
    SAFETY.WRITE,
    6550912,
  ),
  endpoint(
    "v2",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v2/message/setReadById",
    "Mark one message read by id.",
    SAFETY.WRITE,
    6550880,
  ),
  endpoint(
    "v2",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v2/message/delete",
    "Delete a message.",
    SAFETY.DESTRUCTIVE,
    6550968,
  ),
  endpoint(
    "v2",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/v2/cloud_storage/getPreSignUrlArrWithName",
    "Pre-signed upload URLs for named files.",
    SAFETY.READ,
    6551512,
    { notes: ["issues signed URLs without mutating state; the URLs themselves are sensitive"] },
  ),
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/v2/network_plugin/info",
    "Network plugin info for a device.",
    SAFETY.READ,
    6551776,
  ),
  endpoint(
    "v2",
    "POST",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v2/cloud_storage/lockStorageSpace",
    "Lock account storage space before an upload.",
    SAFETY.WRITE,
    null,
    {
      covered: true,
      notes: [
        "upload flow step 1: lock → presigned S3 PUT → newUploadFile claim → unlock (scripts/audit-gap-tools.mjs)",
        "the research doc also registers a /user/cloud_storage twin (offset 6550088); see user_cloud_storage_lockStorageSpace",
      ],
    },
  ),
  endpoint(
    "v2",
    "POST",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v2/cloud_storage/unlockStorageSpace",
    "Release an account storage lock after an upload.",
    SAFETY.WRITE,
    null,
    {
      covered: true,
      notes: ["upload flow final step; orphaned locks are deleted on failure in the repo's flow"],
    },
  ),
  endpoint(
    "v2",
    "POST",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v2/profile/newUploadFile",
    "Claim a completed upload into the account file shelf.",
    SAFETY.WRITE,
    null,
    {
      covered: true,
      notes: ["upload flow claim step; /user twin registered at offset 6550048"],
    },
  ),
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v2/printer/printersStatus",
    "List the account's printers and their status.",
    SAFETY.READ,
    null,
    {
      covered: true,
      notes: [
        "primary discovery path on Slicer Next 2.0.0.3 (account JWT as XX-Token); /work/printer/getPrinters stays as fallback",
      ],
    },
  ),
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v2/printer/info",
    "One printer's full detail.",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [param("id", "number", PARAM_EVIDENCE.REPO_VALIDATED, { note: "printer id" })],
      notes: ["richest single read source: 128-field generated catalog"],
    },
  ),
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v2/printer/tool",
    "One printer's tool (nozzle) data.",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [
        param("id", "number", PARAM_EVIDENCE.REPO_VALIDATED, { note: "printer id" }),
        param("model_id", "number", PARAM_EVIDENCE.REPO_VALIDATED),
        param("type_function_id", "number", PARAM_EVIDENCE.REPO_VALIDATED, {
          note: "must be positive (13 = XYZ tool)",
        }),
      ],
    },
  ),
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v2/project/info",
    "One project's detail (slice params/results, device messages).",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [param("id", "number", PARAM_EVIDENCE.REPO_VALIDATED, { note: "project id" })],
      notes: ["126-field generated catalog"],
    },
  ),
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v2/project/printHistory",
    "Paginated print history.",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [
        param("page", "number", PARAM_EVIDENCE.REPO_VALIDATED),
        param("limit", "number", PARAM_EVIDENCE.REPO_VALIDATED),
        param("print_status", "number", PARAM_EVIDENCE.REPO_VALIDATED),
      ],
    },
  ),
  endpoint(
    "v2",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/v2/printer/getMultiColorBoxInfo",
    "One printer's ACE multi-colour box state.",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [param("id", "number", PARAM_EVIDENCE.REPO_VALIDATED, { note: "printer id" })],
      notes: ["the ACE box read; the plain /v2/printer/multiColorBoxInfo spelling returned 404"],
    },
  ),
];

/* ---------------------------------------------------------------------------
 * /work/* — 16 registrations (8 new of 8 covered → 8 new of 16).
 * ------------------------------------------------------------------------- */
const WORK = [
  endpoint(
    "work",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/work/printer/info",
    "Printer detail on the workbench lane.",
    SAFETY.READ,
    6550216,
    { params: [param("id", "number", PARAM_EVIDENCE.INFERRED, { note: "printer id" })] },
  ),
  endpoint(
    "work",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/work/printer/unsetprinters",
    "Unbind printer(s) from the account.",
    SAFETY.DESTRUCTIVE,
    6549976,
    {
      notes: ["deletion-class per the research doc §7 — never exercise without separate approval"],
    },
  ),
  endpoint(
    "work",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/work/work/addprinter",
    "Bind a printer to the account.",
    SAFETY.WRITE,
    6549944,
  ),
  endpoint(
    "work",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/work/project/report",
    "Report project state to the workbench.",
    SAFETY.WRITE,
    6550744,
  ),
  endpoint(
    "work",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/work/project/unsetprojects",
    "Remove project(s) from the account.",
    SAFETY.DESTRUCTIVE,
    6550992,
    { notes: ["deletion-class per the research doc §7"] },
  ),
  endpoint(
    "work",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/work/index/getUploadStatus",
    "Upload state machine status.",
    SAFETY.READ,
    6550632,
  ),
  endpoint(
    "work",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/work/index/renameFile",
    "Rename an account file.",
    SAFETY.WRITE,
    6550384,
  ),
  endpoint(
    "work",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/work/index/delFiles",
    "Delete account files.",
    SAFETY.DESTRUCTIVE,
    6550416,
    { notes: ["deletion-class per the research doc §7"] },
  ),
  endpoint(
    "work",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/work/gcode/info",
    "G-code artefact info.",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [
        param("id", "number", PARAM_EVIDENCE.REPO_VALIDATED, {
          note: "G-code id, not the task id",
        }),
      ],
    },
  ),
  endpoint(
    "work",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/work/gcode/infoFdm",
    "FDM G-code info: resolves gcode id → cloud file id + slice metadata.",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [param("id", "number", PARAM_EVIDENCE.REPO_VALIDATED, { note: "gcode id" })],
      notes: ["63-field generated catalog"],
    },
  ),
  endpoint(
    "work",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/work/index/getModelFileInfo",
    "Cloud model file detail.",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [param("id", "number", PARAM_EVIDENCE.REPO_VALIDATED, { note: "file id" })],
    },
  ),
  endpoint(
    "work",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/work/index/getUserStore",
    "Account cloud-storage quota.",
    SAFETY.READ,
    null,
    { covered: true, notes: ["quota preflight used by scripts/audit-gap-tools.mjs"] },
  ),
  endpoint(
    "work",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/work/index/userFiles",
    "List the account's cloud files.",
    SAFETY.READ,
    null,
    { covered: true },
  ),
  endpoint(
    "work",
    "POST",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/work/operation/sendOrder",
    "Send a legacy order (print control, settings, queries) to a printer.",
    SAFETY.WRITE,
    null,
    {
      covered: true,
      params: [
        param("printer_id", "number", PARAM_EVIDENCE.REPO_VALIDATED),
        param("order_id", "number|string", PARAM_EVIDENCE.REPO_VALIDATED, {
          note: "project-control orders (1–4) keep the integer; printer-level orders are stringified",
        }),
        param("msgid", "string", PARAM_EVIDENCE.REPO_VALIDATED),
        param("timestamp", "number", PARAM_EVIDENCE.REPO_VALIDATED),
        param("data", "object", PARAM_EVIDENCE.REPO_VALIDATED),
        param("project_id", "number", PARAM_EVIDENCE.REPO_VALIDATED, {
          note: "omitted for printer-level orders (MOVE_AXLE silently ignored with project_id present)",
        }),
      ],
      notes: [
        "legacy order lane; START_PRINT=1 and STOP_PRINT=4 live-validated 2026-09-11, other ids descriptive-only",
      ],
    },
  ),
  endpoint(
    "work",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/work/printer/getPrinters",
    "List the account's printers (legacy workbench route).",
    SAFETY.READ,
    null,
    {
      covered: true,
      notes: ["no longer served on Slicer Next 2.0.0.3; kept as the discovery fallback"],
    },
  ),
  endpoint(
    "work",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/work/project/getProjects",
    "Paginated cloud projects listing.",
    SAFETY.READ,
    null,
    {
      covered: true,
      params: [
        param("page", "number", PARAM_EVIDENCE.REPO_VALIDATED),
        param("limit", "number", PARAM_EVIDENCE.REPO_VALIDATED),
        param("print_status", "number", PARAM_EVIDENCE.REPO_VALIDATED),
      ],
    },
  ),
];

/* ---------------------------------------------------------------------------
 * /user/* — 12 registrations (11 new of 1 covered), the account lane.
 *
 * The research doc's table also registers the storage/upload resources under
 * /user/* (offsets below) while this repo's live-validated upload flow calls
 * the /v2 twins. Both prefixes are declared; which one the SDK registered for
 * the /v2 rows is pending live verification (doc §7 flags the same class of
 * uncertainty). Only /user/profile/userInfo is covered exactly.
 * ------------------------------------------------------------------------- */
const USER = [
  endpoint(
    "user",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/user/public/login",
    "Password login.",
    SAFETY.WRITE,
    6549688,
    { notes: ["credential lane — keep out of automation; never log credentials"] },
  ),
  endpoint(
    "user",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/user/public/logout",
    "End the account session.",
    SAFETY.WRITE,
    6549712,
  ),
  endpoint(
    "user",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/user/public/register",
    "Create an account.",
    SAFETY.WRITE,
    6549736,
  ),
  endpoint(
    "user",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/user/public/check_nickname",
    "Check nickname availability.",
    SAFETY.READ,
    6549768,
    { params: [param("nickname", "string", PARAM_EVIDENCE.PATH_NAME)] },
  ),
  endpoint(
    "user",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/user/public/passwordReset",
    "Reset the account password.",
    SAFETY.WRITE,
    6549808,
    { notes: ["credential lane — never driven from here without an explicit owner request"] },
  ),
  endpoint(
    "user",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/user/public/getIpAddress",
    "Report the caller's IP as the cloud sees it.",
    SAFETY.READ,
    6551152,
  ),
  endpoint(
    "user",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/user/verification_code/newSend",
    "Send a verification code.",
    SAFETY.WRITE,
    6549840,
    { notes: ["external side effect (email/SMS) once accepted"] },
  ),
  endpoint(
    "user",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/user/profile/newUploadFile",
    "Claim a completed upload into the account file shelf.",
    SAFETY.WRITE,
    6550048,
    {
      notes: [
        "resource implemented in this repo under the /v2/profile prefix twin (repo-validated); covered there",
      ],
    },
  ),
  endpoint(
    "user",
    "GET",
    METHOD_EVIDENCE.REPO_VALIDATED,
    "/user/profile/userInfo",
    "Account profile / identity.",
    SAFETY.READ,
    6551184,
    {
      covered: true,
      notes: [
        "workbench route; may refuse the raw account JWT — the repo treats identity as best-effort",
        "the repo's /v1/user/profile/userInfo spelling is the unregistered prefix variant",
      ],
    },
  ),
  endpoint(
    "user",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/user/cloud_storage/getTcCosTempToken",
    "Issue a temporary cloud-object-storage credential.",
    SAFETY.READ,
    6550304,
    {
      notes: ["mutates no state but the output is a usable credential — redacted by callEndpoint"],
    },
  ),
  endpoint(
    "user",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/user/cloud_storage/lockStorageSpace",
    "Lock account storage space before an upload.",
    SAFETY.WRITE,
    6550088,
    { notes: ["/v2 twin implemented and repo-validated; see v2_cloud_storage_lockStorageSpace"] },
  ),
  endpoint(
    "user",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/user/cloud_storage/unlockStorageSpace",
    "Release an account storage lock.",
    SAFETY.WRITE,
    6550136,
    { notes: ["/v2 twin implemented and repo-validated; see v2_cloud_storage_unlockStorageSpace"] },
  ),
];

/* ---------------------------------------------------------------------------
 * /portal/* — 5 registrations (all new), the unauthenticated pre-login surface.
 * ------------------------------------------------------------------------- */
const PORTAL = [
  endpoint(
    "portal",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/portal/index/country",
    "Country list for the pre-login UI.",
    SAFETY.READ,
    6550240,
    { notes: ["unauthenticated pre-login surface; the signed-header contract may not apply"] },
  ),
  endpoint(
    "portal",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/portal/index/country_hot",
    "Popular country list for the pre-login UI.",
    SAFETY.READ,
    6550272,
    { notes: ["unauthenticated pre-login surface"] },
  ),
  endpoint(
    "portal",
    "POST",
    METHOD_EVIDENCE.INFERRED,
    "/portal/index/feedback",
    "Submit pre-login feedback.",
    SAFETY.WRITE,
    6550016,
  ),
  endpoint(
    "portal",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/portal/index/reason",
    "Feedback reason list.",
    SAFETY.READ,
    6551056,
  ),
  endpoint(
    "portal",
    "GET",
    METHOD_EVIDENCE.INFERRED,
    "/portal/index/get_version",
    "Portal/app version banner.",
    SAFETY.READ,
    6551480,
  ),
];

export const CLOUD_ENDPOINTS = Object.freeze([
  ...FARM,
  ...V5,
  ...V3,
  ...V2,
  ...WORK,
  ...USER,
  ...PORTAL,
]);

/** The expected catalog size (doc §TL;DR: 93 registrations). Asserted by tests. */
export const EXPECTED_ENDPOINT_COUNT = 93;

/** Look up one endpoint by id, or null. */
export function getEndpoint(id) {
  return CLOUD_ENDPOINTS.find((e) => e.id === id) ?? null;
}

const ZOD_PARAM_TYPES = Object.freeze({
  string: () => z.string(),
  number: () => z.number(),
  boolean: () => z.boolean(),
  "number|string": () => z.union([z.number(), z.string()]),
  "string[]": () => z.array(z.string()),
  "number[]": () => z.array(z.number()),
  object: () => z.looseObject({}),
});

/**
 * The zod schema for an endpoint's declared params. Loose: declared params are
 * type-checked, undeclared keys pass through — a server field nobody documented
 * must not be refused (the repo's no-invented-fields rule cuts the other way:
 * nothing here invents a required field the doc does not attest).
 */
export function paramSchemaFor(endpointEntry) {
  const shape = {};
  for (const p of endpointEntry.params) {
    const factory = ZOD_PARAM_TYPES[p.type];
    if (!factory) {
      throw new CloudEndpointError(
        "INVALID_CATALOG",
        `endpoint ${endpointEntry.id} declares unknown param type "${p.type}"`,
      );
    }
    shape[p.name] = p.required ? factory() : factory().optional();
  }
  return z.looseObject(shape);
}

/**
 * Redact credential-shaped values from anything this module returns. Key-based
 * only (the same contract the CLI renderers use). Deliberately local and tiny:
 * importing the diagnostics redactor would drag the MQTT stack into this leaf
 * module, and the frozen bundle must be able to wire this file standalone.
 */
const SENSITIVE_KEY_RE =
  /(token|secret|password|passwd|signature|authorization|credential|api_key)/i;

export function redactSensitive(value, depth = 0, seen = new WeakSet()) {
  if (depth > 8) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1, seen));
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key)
        ? "[redacted]"
        : redactSensitive(child, depth + 1, seen);
    }
    return out;
  }
  return value;
}

/**
 * Call one catalog endpoint through an injected client.
 *
 * The client is injected (the same pattern as `AnycubicCloud`'s injectable
 * `fetchImpl`): any object with
 * `rawApi(method, path, { params, query })` works, and `AnycubicCloud` already
 * satisfies it. `GET` sends validated params as `query`, `POST` sends them as
 * the body (`params`).
 *
 * Confirmation: `write` and `destructive` endpoints are refused unless the
 * caller passes `confirm: true` AND `confirm_word: "EXECUTE"` inside `params`.
 * Both meta fields are stripped before anything reaches the wire.
 *
 * @param {{rawApi: Function}} client injected transport (duck-typed)
 * @param {string} endpointId a CLOUD_ENDPOINTS id
 * @param {object} params request params (+ confirm meta for write/destructive)
 * @returns {Promise<{endpoint: string, method: string, path: string, safety: string, data: object}>}
 */
export async function callEndpoint(client, endpointId, params = {}) {
  const entry = getEndpoint(endpointId);
  if (!entry) {
    throw new CloudEndpointError(
      "UNKNOWN_ENDPOINT",
      `unknown cloud endpoint "${endpointId}" — pick an id from CLOUD_ENDPOINTS (${CLOUD_ENDPOINTS.length} entries)`,
    );
  }
  if (typeof client?.rawApi !== "function") {
    throw new CloudEndpointError(
      "INVALID_CLIENT",
      "callEndpoint needs a client exposing rawApi(method, path, { params, query }) — AnycubicCloud qualifies",
    );
  }

  const rest = { ...(params ?? {}) };
  const confirmed = rest.confirm === true;
  const confirmWord = typeof rest.confirm_word === "string" ? rest.confirm_word : null;
  delete rest.confirm;
  delete rest.confirm_word;

  if (entry.safety !== SAFETY.READ && !(confirmed && confirmWord === CONFIRM_WORD)) {
    throw new CloudEndpointError(
      "CONFIRMATION_REQUIRED",
      `${entry.safety} endpoint ${entry.id} (${entry.method} ${entry.path}) requires confirm:true and confirm_word:"${CONFIRM_WORD}"`,
      { safety: entry.safety, expected_confirm_word: CONFIRM_WORD },
    );
  }

  const parsed = paramSchemaFor(entry).safeParse(rest);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new CloudEndpointError(
      "INVALID_PARAMS",
      `invalid params for ${entry.id}: ${issues.join("; ")}`,
      { issues },
    );
  }

  const wire = entry.method === "GET" ? { query: parsed.data } : { params: parsed.data };
  const data = await client.rawApi(entry.method, entry.path, wire);
  return {
    endpoint: entry.id,
    method: entry.method,
    path: entry.path,
    safety: entry.safety,
    data: redactSensitive(data),
  };
}

/** Counts the tests and the impl doc quote: totals by family, safety, coverage. */
export function summarizeCatalog() {
  const byFamily = {};
  const bySafety = {};
  let covered = 0;
  for (const entry of CLOUD_ENDPOINTS) {
    byFamily[entry.family] = (byFamily[entry.family] ?? 0) + 1;
    bySafety[entry.safety] = (bySafety[entry.safety] ?? 0) + 1;
    if (entry.covered) covered += 1;
  }
  return {
    total: CLOUD_ENDPOINTS.length,
    covered,
    new: CLOUD_ENDPOINTS.length - covered,
    byFamily: Object.freeze(byFamily),
    bySafety: Object.freeze(bySafety),
  };
}

// ---------------------------------------------------------------------------
// MCP registration (wired by the parent into vendor/server.mjs; the module
// stays a zod-only leaf so the frozen bundle can import it without mqtt).
// ---------------------------------------------------------------------------

/** Thin view of one catalog row for list responses (params only on demand). */
function rowView(entry) {
  return {
    id: entry.id,
    method: entry.method,
    path: entry.path,
    family: entry.family,
    safety: entry.safety,
    covered: Boolean(entry.covered),
    purpose: entry.purpose ?? "",
  };
}

export function registerCloudEndpointTools(server, z, { manager } = {}) {
  // ---- account_endpoint_catalog ------------------------------------------
  server.registerTool(
    "account_endpoint_catalog",
    {
      title: "Cloud workbench endpoint catalog (93 routes)",
      description:
        "Read-only, offline. The complete 93-endpoint surface the Slicer Next 2.0.0.3 SDK registers (source: the cloud_sdk_cpp.dll registration table, docs/research/slicer-binary-surface-2026-11-18.md). Each row: id, method, path, family, safety class (read/write/destructive), coverage flag and purpose. Methods for 65 routes are inferred from path semantics and never live-validated; read is the only class safe to call blind. Filter with family or id (id returns the full entry including params).",
      inputSchema: {
        family: z.string().optional(),
        id: z.string().optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ family, id }) => {
      let rows = CLOUD_ENDPOINTS;
      if (family) rows = rows.filter((e) => e.family === family);
      if (id) {
        rows = rows.filter((e) => e.id === id);
        if (rows.length === 0) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `unknown endpoint id "${id}" — call account_endpoint_catalog without filters to list all ${CLOUD_ENDPOINTS.length}`,
              },
            ],
          };
        }
      }
      const detailed = Boolean(id);
      const endpoints = rows.map((e) => (detailed ? e : rowView(e)));
      const out = {
        ok: true,
        ...summarizeCatalog(),
        filter: { family: family ?? null, id: id ?? null },
        endpoints,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(out) }],
        structuredContent: out,
      };
    },
  );

  // ---- account_endpoint_call ---------------------------------------------
  server.registerTool(
    "account_endpoint_call",
    {
      title: "Call one catalogued cloud endpoint",
      description:
        'Calls one endpoint from account_endpoint_catalog through the live cloud session. read-class endpoints need no confirmation; write/destructive refuse without params.confirm:true + params.confirm_word:"EXECUTE" (typed CONFIRMATION_REQUIRED). Responses are redacted for credential-shaped values. Most routes are INFERRED (never live-validated): start with read-class, expect surprises, report them.',
      inputSchema: {
        endpoint_id: z.string().min(1),
        params: z.record(z.string(), z.unknown()).optional(),
        access_token: z.string().optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ endpoint_id, params, access_token }) => {
      // Usage errors fail BEFORE any session work: unknown id and missing
      // confirmation never need a cloud login (callEndpoint re-validates).
      const entry = getEndpoint(endpoint_id);
      if (!entry) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `UNKNOWN_ENDPOINT: unknown cloud endpoint "${endpoint_id}" — call account_endpoint_catalog for the ${CLOUD_ENDPOINTS.length} ids`,
            },
          ],
        };
      }
      const wantsConfirm =
        entry.safety !== SAFETY.READ &&
        !(params?.confirm === true && params?.confirm_word === CONFIRM_WORD);
      if (wantsConfirm) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `CONFIRMATION_REQUIRED: ${entry.safety} endpoint ${entry.id} (${entry.method} ${entry.path}) requires params.confirm:true and params.confirm_word:"${CONFIRM_WORD}"`,
            },
          ],
        };
      }
      const cloud = manager?.cloud;
      if (!cloud) {
        return {
          isError: true,
          content: [{ type: "text", text: "SESSION_ERROR: No cloud session available." }],
        };
      }
      try {
        if (!cloud.xxToken) {
          const token = access_token ?? process.env.ANYCUBIC_CLOUD_TOKEN ?? null;
          if (token && !cloud.access_token) cloud.access_token = token;
          await cloud.login();
        }
        const result = await callEndpoint(cloud, endpoint_id, {
          ...(params ?? {}),
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          structuredContent: result,
        };
      } catch (error) {
        const code = error?.code ?? "ENDPOINT_ERROR";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `${code}: ${error?.message ?? String(error)}`,
            },
          ],
        };
      }
    },
  );
}
