/**
 * Anycubic Kobra S1 — exhaustive property & endpoint catalog.
 *
 * Purpose: a single declarative source of truth for EVERY read point and every
 * command/connection point reachable on the printer, the LAN transport and the
 * Anycubic cloud account. Consumed by `printer-full-read.mjs` (MCP tools) and by
 * the tests, so a newly observed field is either matched to a catalog entry or
 * reported as `extra` (i.e. an unmapped discovery that must be documented).
 *
 * Evidence levels (never upgrade a level without evidence):
 *  - "live"        verified against captured traffic from the real printer
 *                  (docs/evidence/cloud-<PRINTER_ID>-*.json, .sweep-events.json)
 *  - "mapping"     command mapping documented by the validated LAN protocol
 *                  reference; publishing path confirmed, semantics not re-measured
 *  - "reference"   present in the vendor/reference API surface but NOT validated
 *                  on this hardware; treat as hypothesis
 *  - "hypothesis"  inferred from protocol shape only — must not be used to act
 *
 * Safety classes for commands:
 *  - "read"        no physical effect
 *  - "state"       changes reversible non-motion state (light, fan, ACE metadata)
 *  - "thermal"     changes heaters — can burn / deform
 *  - "motion"      moves axes — can crash into the part
 *  - "job"         starts/stops a print — irreversible for the part on the bed
 */
import { HTTP_PROPERTY_CATALOG } from "./printer-http-property-catalog.mjs";

export { HTTP_PROPERTY_CATALOG };

export const PRINTER_MODEL = Object.freeze({
  model_id: "20025",
  family: "Kobra S1",
  firmware_observed: process.env.ANYCUBIC_FW_VERSION ?? "unknown",
  cloud_printer_id: Number(process.env.ANYCUBIC_PRINTER_ID ?? 0),
  ace_model_id: 40002,
  bed_mm: { x: 250, y: 250, z: 260 },
});

/** Cloud MQTT topic roots. Command side is `pc/`, report side is `app/`+`public/`. */
export const CLOUD_TOPICS = Object.freeze({
  command: "anycubic/anycubicCloud/v1/pc/printer/{model_id}/{printer_key}/{type}",
  account_reports: "anycubic/anycubicCloud/v1/printer/app/{model_id}/{printer_key}/#",
  public_reports: "anycubic/anycubicCloud/v1/printer/public/{model_id}/{printer_key}/{type}/report",
  broker: "mqtts://mqtt-universe.anycubic.com:8883",
  auth: "mutual TLS (shared slicer client identity) + RSA-encrypted XX-Token",
});

/** Native LAN-mode topic roots (printer-local broker, port 9883 after handshake). */
export const LAN_TOPICS = Object.freeze({
  command: "anycubic/anycubicCloud/v1/web/printer/{model_id}/{mqtt_device_id}/{type}",
  reports: "anycubic/anycubicCloud/v1/printer/public/{model_id}/{mqtt_device_id}/{type}/report",
  info_http: "http://{ip}:18910/info",
  ctrl_http: "http://{ip}:18910/ctrl",
  camera_flv: "http://{ip}:18088/flv",
  gkapi_octoprint: "http://{ip}:80/api/version",
});

/**
 * The slicer's own MQTT type registry, recovered from the 2.0.0.3 binaries
 * (docs/research/slicer-binary-surface-2026-11-18.md §3.2). The registry holds
 * 21 types; 7 were already known to this catalog, 14 are added here from the
 * binary evidence only. Every entry is `mapping`-level: a name in a string
 * table proves the vocabulary exists, never that this firmware emits the
 * report — field-level truth requires a live capture.
 */
export const MQTT_TYPE_REGISTRY = Object.freeze([
  { type: "print", catalog_status: "known", lane: "fdm" },
  { type: "tempature", catalog_status: "known", lane: "fdm" },
  { type: "light", catalog_status: "known", lane: "fdm" },
  { type: "multiColorBox", catalog_status: "known", lane: "ace" },
  { type: "extfilbox", catalog_status: "known", lane: "ace" },
  { type: "video", catalog_status: "known", lane: "fdm" },
  { type: "peripherie", catalog_status: "known", lane: "fdm" },
  {
    type: "filament",
    catalog_status: "new",
    lane: "fdm",
    note: "dedicated filament report never subscribed to before (registry line 'filament/report'); the top investigation target for per-spool identity",
  },
  { type: "status", catalog_status: "new", lane: "fdm", note: "FDM status channel (push-only)" },
  { type: "preheating", catalog_status: "new", lane: "fdm", note: "preheat state machine" },
  { type: "levelling", catalog_status: "new", lane: "fdm", note: "auto bed levelling" },
  { type: "screenSaver", catalog_status: "new", lane: "fdm", note: "panel control" },
  {
    type: "network",
    catalog_status: "new",
    lane: "fdm",
    note: "WiFi diagnostics; 'getSignalStrength' lives here",
  },
  { type: "autoOperation", catalog_status: "new", lane: "fdm", note: "auto-op state machine" },
  { type: "lastWill", catalog_status: "new", lane: "resin", note: "resin (SLA) line" },
  { type: "exposure", catalog_status: "new", lane: "resin", note: "resin (SLA) line" },
  { type: "residual", catalog_status: "new", lane: "resin", note: "resin (SLA) line" },
  {
    type: "airpure",
    catalog_status: "new",
    lane: "shared",
    note: "air filter; sold for FDM too (pairs with the FilterElement report struct)",
  },
  { type: "releaseFilm", catalog_status: "new", lane: "resin", note: "resin (SLA) line" },
  { type: "smartResinVat", catalog_status: "new", lane: "resin", note: "resin (SLA) line" },
  { type: "resin", catalog_status: "new", lane: "resin", note: "resin (SLA) line" },
]);

/** Citation carried by every mapping-level registry entry. */
export const MQTT_TYPE_REGISTRY_CITATION = Object.freeze(
  "cloud_mqtt.dll 3194984-3195304, mirrored in mach_mqtt.dll 880712-881032 (source cloud_sdk_src/cloud_mqtt/cloud_mqtt_constant.cpp; docs/research/slicer-binary-surface-2026-11-18.md §3.2)",
);

/**
 * Report struct names recovered from MSVC RTTI, namespace
 * `mach_mqtt::FDM::Report` (slicer-binary-surface §3.4). Names only — the
 * field-level shapes are the reflection table at mach_mqtt.dll 882960-884456,
 * of which only the ACE-relevant subset has been transcribed (§4.2).
 */
export const MQTT_REPORT_STRUCTS = Object.freeze([
  "AutoOpStatus",
  "AxisMove",
  "ExtFilBox",
  "FilamentType",
  "FileDelete",
  "FileDetail",
  "FileList",
  "FileRename",
  "File",
  "FilterElement",
  "Info",
  "Light",
  "MCBDryStatus",
  "MultiBoxInfo",
  "NetworkQuery",
  "OTAUpgrade",
  "OTAVersion",
  "Peripherie",
  "PrintCommon",
  "PrintDownloading",
  "PrintIgnore",
  "PrintMonitoring",
  "PrintPreheating",
  "PrintPrinting",
  "PrintRetect",
  "PrintUpdate",
  "Resin",
  "SmartBox",
  "Tempature",
  "VideoDelete",
  "VideoList",
]);

/**
 * Types our tools publish that the SDK registry does NOT contain (§3.2). They
 * are firmware-side aliases or community names the firmware tolerates; the
 * live sweep (mqtt-surface-sweep §8) noted the inversion: exactly these
 * answered reads, exactly the registry types stayed silent.
 */
export const MQTT_FIRMWARE_ALIAS_TYPES = Object.freeze([
  "fan",
  "axis",
  "aiSettings",
  "file",
  "info",
]);

/**
 * Read sources. Every entry that has `action` is publishable to `path_template`
 * with the JSON envelope `{type, action, timestamp, msgid, data}`.
 */
export const READ_SOURCES = Object.freeze([
  {
    id: "info",
    transport: "mqtt",
    type: "info",
    action: "query",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/info",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/info",
    observed_actions: ["query", "report"],
    cadence_hint: "slow (~30s push)",
    evidence: "live",
    properties: [
      { path: "printerName", type: "string", group: "identity" },
      { path: "model", type: "string", group: "identity" },
      { path: "ip", type: "string", group: "identity" },
      { path: "version", type: "string", group: "identity" },
      { path: "state", type: "string", group: "state", note: "free = idle" },
      { path: "print_speed_mode", type: "number", group: "print" },
      { path: "fan_speed_pct", type: "number", unit: "percent", group: "cooling" },
      { path: "aux_fan_speed_pct", type: "number", unit: "percent", group: "cooling" },
      { path: "box_fan_level", type: "number", unit: "level", group: "cooling" },
      {
        path: "urls.rtspUrl",
        type: "string",
        group: "camera",
        note: "live camera URL; redacted by default",
      },
      {
        path: "urls.fileUploadurl",
        type: "string",
        group: "transfer",
        note: "signed upload URL; redacted",
      },
      { path: "temp.curr_hotbed_temp", type: "number", unit: "celsius", group: "temperature" },
      { path: "temp.curr_nozzle_temp", type: "number", unit: "celsius", group: "temperature" },
      { path: "temp.target_hotbed_temp", type: "number", unit: "celsius", group: "temperature" },
      { path: "temp.target_nozzle_temp", type: "number", unit: "celsius", group: "temperature" },
      { path: "project", type: "object|null", group: "print", note: "null when idle" },
      { path: "last_project.state", type: "string", group: "print" },
      { path: "last_project.print_status", type: "number", group: "print" },
      { path: "last_project.progress", type: "number", unit: "percent", group: "print" },
      { path: "last_project.curr_layer", type: "number", group: "print" },
      { path: "last_project.total_layers", type: "number", group: "print" },
      { path: "last_project.remain_time", type: "number", unit: "second", group: "print" },
      { path: "last_project.print_time", type: "number", unit: "second", group: "print" },
      {
        path: "last_project.supplies_usage",
        type: "number",
        unit: "millimeter",
        group: "material",
      },
      {
        path: "last_project.pause",
        type: "number",
        group: "print",
        note: "authoritative pause state 0-4",
      },
      { path: "last_project.project_type", type: "number", group: "print" },
      { path: "last_project.task_id", type: "number", group: "print" },
      { path: "last_project.localtask", type: "string", group: "print" },
      { path: "last_project.filename", type: "string", group: "print" },
      { path: "last_project.print_speed_mode", type: "object", group: "print" },
      { path: "last_project.task_settings.camera_timelapse", type: "number", group: "camera" },
      { path: "features.auto_leveling_support", type: "boolean", group: "capability" },
      { path: "features.vibration_compensation_support", type: "boolean", group: "capability" },
      { path: "features.flow_calibration_support", type: "boolean", group: "capability" },
      { path: "features.drying_first_support", type: "boolean", group: "capability" },
      { path: "features.camera_timelapse_support", type: "boolean", group: "capability" },
      { path: "features.gcode_3mf_support", type: "boolean", group: "capability" },
      { path: "features.delete_batch_support", type: "boolean", group: "capability" },
      { path: "features.preheating_support", type: "boolean", group: "capability" },
      {
        path: "features.fod_support",
        type: "boolean",
        group: "capability",
        note: "on-device AI failure detection",
      },
      {
        path: "features.shengwang_rtc_support",
        type: "boolean",
        group: "capability",
        note: "Agora RTC (cloud camera)",
      },
      { path: "features.shengwang_rdt_support", type: "boolean", group: "capability" },
      { path: "features.pre_cancel_support", type: "boolean", group: "capability" },
    ],
  },
  {
    id: "tempature",
    transport: "mqtt",
    type: "tempature",
    action: "query",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/tempature",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/tempature",
    observed_actions: ["query", "auto"],
    cadence_hint: "fast push (~1s)",
    evidence: "live",
    note: "topic name is intentionally misspelled by the vendor ('tempature').",
    properties: [
      { path: "curr_hotbed_temp", type: "number", unit: "celsius", group: "temperature" },
      { path: "curr_nozzle_temp", type: "number", unit: "celsius", group: "temperature" },
      { path: "curr_chamber_temp", type: "number", unit: "celsius", group: "temperature" },
      { path: "target_hotbed_temp", type: "number", unit: "celsius", group: "temperature" },
      { path: "target_nozzle_temp", type: "number", unit: "celsius", group: "temperature" },
      { path: "target_chamber_temp", type: "number", unit: "celsius", group: "temperature" },
      { path: "taskid", type: "string", group: "print" },
    ],
  },
  {
    id: "fan",
    transport: "mqtt",
    type: "fan",
    action: "query",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/fan",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/fan",
    observed_actions: ["query"],
    evidence: "live",
    properties: [
      {
        path: "fan_speed_pct",
        type: "number",
        unit: "percent",
        group: "cooling",
        note: "part cooling fan",
      },
      {
        path: "aux_fan_speed_pct",
        type: "number",
        unit: "percent",
        group: "cooling",
        note: "auxiliary fan",
      },
      {
        path: "box_fan_level",
        type: "number",
        unit: "level",
        group: "cooling",
        note: "ACE / chamber fan",
      },
    ],
  },
  {
    id: "light",
    transport: "mqtt",
    type: "light",
    action: "query",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/light",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/light",
    observed_actions: ["query"],
    evidence: "live",
    properties: [
      { path: "lights[].type", type: "number", group: "lighting", note: "2 = chamber light" },
      { path: "lights[].status", type: "number", group: "lighting" },
      { path: "lights[].brightness", type: "number", unit: "percent", group: "lighting" },
    ],
  },
  {
    id: "peripherie",
    transport: "mqtt",
    type: "peripherie",
    action: "query",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/peripherie",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/peripherie",
    observed_actions: ["query"],
    evidence: "live",
    properties: [
      { path: "camera", type: "number", group: "peripheral", note: "1 = camera present" },
      { path: "multiColorBox", type: "number", group: "peripheral", note: "1 = ACE present" },
      { path: "udisk", type: "number", group: "peripheral", note: "1 = USB storage present" },
    ],
  },
  {
    id: "aiSettings",
    transport: "mqtt",
    type: "aiSettings",
    action: "query",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/aiSettings",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/aiSettings",
    observed_actions: ["query"],
    evidence: "live",
    note: "read side of the on-device AI failure detection (fod_support).",
    properties: [
      { path: "ai_settings.status", type: "number", group: "ai", note: "3 = enabled" },
      { path: "ai_settings.type", type: "number", group: "ai" },
      { path: "ai_settings.count", type: "number", group: "ai" },
      { path: "ai_settings.notice_type", type: "array", group: "ai" },
      { path: "ai_settings.sensitivity_level", type: "array", group: "ai" },
    ],
  },
  {
    id: "multiColorBox",
    transport: "mqtt",
    type: "multiColorBox",
    action: "getInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/multiColorBox",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/multiColorBox",
    observed_actions: ["getInfo"],
    evidence: "live",
    note: "activity-gated: use action getInfo (not query) and poll.",
    properties: [
      { path: "head_tools_model", type: "number", group: "ace" },
      { path: "multi_color_box[].id", type: "number", group: "ace" },
      { path: "multi_color_box[].status", type: "number", group: "ace" },
      { path: "multi_color_box[].model_id", type: "number", group: "ace", note: "40002 = ACE Pro" },
      { path: "multi_color_box[].auto_feed", type: "number", group: "ace" },
      {
        path: "multi_color_box[].loaded_slot",
        type: "number",
        group: "ace",
        note: "-1 = no slot fed",
      },
      { path: "multi_color_box[].temp", type: "number", unit: "celsius", group: "ace" },
      { path: "multi_color_box[].humidity", type: "number", unit: "percent", group: "ace" },
      { path: "multi_color_box[].feed_status.code", type: "number", group: "ace" },
      { path: "multi_color_box[].feed_status.type", type: "number", group: "ace" },
      { path: "multi_color_box[].feed_status.current_status", type: "number", group: "ace" },
      { path: "multi_color_box[].feed_status.slot_index", type: "number", group: "ace" },
      { path: "multi_color_box[].drying_status.status", type: "number", group: "ace" },
      {
        path: "multi_color_box[].drying_status.target_temp",
        type: "number",
        unit: "celsius",
        group: "ace",
      },
      {
        path: "multi_color_box[].drying_status.duration",
        type: "number",
        unit: "minute",
        group: "ace",
      },
      {
        path: "multi_color_box[].drying_status.remain_time",
        type: "number",
        unit: "minute",
        group: "ace",
      },
      { path: "multi_color_box[].slots[].index", type: "number", group: "ace" },
      {
        path: "multi_color_box[].slots[].type",
        type: "string",
        group: "ace",
        note: "material name",
      },
      {
        path: "multi_color_box[].slots[].sku",
        type: "string",
        group: "ace",
        note: "Anycubic spool SKU; empty on manual slots unless written via setInfo with sku (custom-filament path). The only per-slot material identifier the box reports (no tag UID).",
      },
      { path: "multi_color_box[].slots[].color", type: "array", group: "ace", note: "[R,G,B]" },
      {
        path: "multi_color_box[].slots[].color_group",
        type: "array",
        group: "ace",
        note: "[[R,G,B,A]]",
      },
      {
        path: "multi_color_box[].slots[].edit_status",
        type: "number",
        group: "ace",
        note: "0 = RFID tag, 1 = manually entered",
      },
      {
        path: "multi_color_box[].slots[].status",
        type: "number",
        group: "ace",
        note: "5 = loaded/ready",
      },
      { path: "multi_color_box[].slots[].icon_type", type: "number", group: "ace" },
      {
        path: "multi_color_box[].slots[].consumables_percent",
        type: "number",
        unit: "percent",
        group: "material",
      },
    ],
  },
  {
    id: "axis",
    transport: "mqtt",
    type: "axis",
    action: "query",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/axis",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/axis",
    observed_actions: ["query"],
    evidence: "live",
    note: "reported coordinates are NOT a homing reference and do not prove origin/offsets.",
    properties: [
      { path: "coordinates.x", type: "number", unit: "millimeter", group: "motion" },
      { path: "coordinates.y", type: "number", unit: "millimeter", group: "motion" },
      { path: "coordinates.z", type: "number", unit: "millimeter", group: "motion" },
    ],
  },
  {
    id: "extfilbox",
    transport: "mqtt",
    type: "extfilbox",
    action: "query",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/extfilbox",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/extfilbox",
    observed_actions: ["query", "reportInfo"],
    evidence: "live",
    note: "external single-slot filament holder (not ACE). Timed out on an idle printer.",
    properties: [
      { path: "type", type: "string", group: "material" },
      { path: "color", type: "array", group: "material", note: "[R,G,B]" },
      { path: "loaded", type: "number", group: "material" },
      { path: "status_type", type: "number", group: "material" },
      { path: "current_status", type: "number", group: "material" },
    ],
  },
  {
    id: "print",
    transport: "mqtt",
    type: "print",
    action: "query",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/print",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/print",
    observed_actions: ["query"],
    evidence: "reference",
    note: "no reply observed within 20s on a failed/idle printer; NOT proof the capability is absent.",
    properties: [
      { path: "taskid", type: "string", group: "print" },
      { path: "state", type: "string", group: "print" },
      { path: "settings", type: "object", group: "print" },
      {
        path: "settings.target_nozzle_temp",
        type: "number",
        unit: "celsius",
        group: "temperature",
      },
      {
        path: "settings.target_hotbed_temp",
        type: "number",
        unit: "celsius",
        group: "temperature",
      },
      { path: "settings.fan_speed_pct", type: "number", unit: "percent", group: "cooling" },
      { path: "settings.aux_fan_speed_pct", type: "number", unit: "percent", group: "cooling" },
      { path: "settings.box_fan_level", type: "number", unit: "level", group: "cooling" },
      { path: "settings.print_speed_mode", type: "number", group: "print" },
    ],
  },
  {
    id: "file",
    transport: "mqtt",
    type: "file",
    action: "listLocal",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/file",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/file",
    observed_actions: ["listLocal", "listUdisk", "getPreSignedUrl", "saveVideoThumbnail"],
    evidence: "live",
    note: "listLocal and listUdisk are separated so one reply cannot satisfy the other query.",
    properties: [
      { path: "list_mode", type: "number", group: "storage" },
      { path: "records[].filename", type: "string", group: "storage" },
      { path: "records[].is_dir", type: "boolean", group: "storage" },
      { path: "records[].timestamp", type: "number", unit: "second", group: "storage" },
      { path: "records[].size", type: "number", unit: "byte", group: "storage" },
      { path: "records[].plate_number", type: "number", group: "storage" },
      { path: "filename", type: "string", group: "storage" },
      { path: "fileSize", type: "number", unit: "byte", group: "storage" },
      { path: "fileKey", type: "string", group: "storage" },
      { path: "path", type: "string", group: "storage" },
      { path: "thumbnailUrl", type: "string", group: "camera", note: "redacted" },
    ],
  },
  {
    id: "status",
    transport: "mqtt",
    type: "status",
    action: "report",
    cloud_publish: null,
    lan_publish: null,
    observed_actions: ["report"],
    evidence: "live",
    note:
      "push-only work report; no query projection observed. The binary registry confirms 'status' as a protocol type (mapping: " +
      MQTT_TYPE_REGISTRY_CITATION +
      "); the sweep additionally probed status/queryInfo — broker ack, no device report (mqtt-surface-sweep §8).",
    properties: [
      { path: "state", type: "string", group: "state", note: "free | busy" },
      { path: "workReport", type: "object", group: "print" },
    ],
  },
  // ---------------------------------------------------------------------------
  // Binary-registry types (mapping level) — added from the Slicer Next 2.0.0.3
  // string tables (slicer-binary-surface §3.2/§3.4). Each source declares ONE
  // placeholder property named after its RTTI report struct (or a bare
  // "report" container where no FDM struct exists): a declared entry that
  // shows up as `missing` until a live capture documents the real shape, so
  // every genuinely new field still surfaces as `extra`. None of these use a
  // READ_ONLY_ACTIONS action, so no default read path publishes them.
  // ---------------------------------------------------------------------------
  {
    id: "filament",
    transport: "mqtt",
    type: "filament",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/filament",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/filament",
    observed_actions: ["queryInfo", "report"],
    evidence: "mapping",
    note:
      "dedicated filament report we have never subscribed to; the top live-validation target for per-spool identity (" +
      MQTT_TYPE_REGISTRY_CITATION +
      "). FilamentType RTTI struct (§3.4). The sweep probed filament/queryInfo — broker ack, no device report (mqtt-surface-sweep §8).",
    properties: [
      {
        path: "filament_type",
        type: "object",
        group: "filament",
        note: "placeholder named after the FilamentType report struct; field shape unverified",
      },
    ],
  },
  {
    id: "preheating",
    transport: "mqtt",
    type: "preheating",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/preheating",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/preheating",
    observed_actions: ["queryInfo"],
    evidence: "mapping",
    note:
      "preheat state machine (" +
      MQTT_TYPE_REGISTRY_CITATION +
      "); PrintPreheating RTTI struct (§3.4). Probe acked, no device report (mqtt-surface-sweep §8).",
    properties: [
      {
        path: "preheating",
        type: "object",
        group: "state",
        note: "placeholder named after the PrintPreheating report struct; field shape unverified",
      },
    ],
  },
  {
    id: "levelling",
    transport: "mqtt",
    type: "levelling",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/levelling",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/levelling",
    observed_actions: ["queryInfo"],
    evidence: "mapping",
    note:
      "auto bed levelling (" +
      MQTT_TYPE_REGISTRY_CITATION +
      "). Probe acked, no device report (mqtt-surface-sweep §8).",
    properties: [
      {
        path: "report",
        type: "object",
        group: "state",
        note: "placeholder; no RTTI struct transcribed for this type yet",
      },
    ],
  },
  {
    id: "screenSaver",
    transport: "mqtt",
    type: "screenSaver",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/screenSaver",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/screenSaver",
    observed_actions: ["queryInfo"],
    evidence: "mapping",
    note:
      "panel control (" +
      MQTT_TYPE_REGISTRY_CITATION +
      "). Probe acked, no device report (mqtt-surface-sweep §8).",
    properties: [
      {
        path: "report",
        type: "object",
        group: "state",
        note: "placeholder; no RTTI struct transcribed for this type yet",
      },
    ],
  },
  {
    id: "network",
    transport: "mqtt",
    type: "network",
    action: "getSignalStrength",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/network",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/network",
    observed_actions: ["getSignalStrength"],
    evidence: "mapping",
    note:
      "WiFi diagnostics; the registry pairs this type with the getSignalStrength action (" +
      MQTT_TYPE_REGISTRY_CITATION +
      "); NetworkQuery RTTI struct (§3.4). Probe acked, no device report (mqtt-surface-sweep §8).",
    properties: [
      {
        path: "network_query",
        type: "object",
        group: "network",
        note: "placeholder named after the NetworkQuery report struct; field shape unverified",
      },
    ],
  },
  {
    id: "autoOperation",
    transport: "mqtt",
    type: "autoOperation",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/autoOperation",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/autoOperation",
    observed_actions: ["queryInfo"],
    evidence: "mapping",
    note:
      "auto-op state machine (" +
      MQTT_TYPE_REGISTRY_CITATION +
      "); AutoOpStatus RTTI struct (§3.4). Probe acked, no device report (mqtt-surface-sweep §8).",
    properties: [
      {
        path: "auto_op_status",
        type: "object",
        group: "state",
        note: "placeholder named after the AutoOpStatus report struct; field shape unverified",
      },
    ],
  },
  {
    id: "airpure",
    transport: "mqtt",
    type: "airpure",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/airpure",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/airpure",
    observed_actions: ["queryInfo"],
    evidence: "mapping",
    note:
      "air filter; sold for FDM too — pairs with the FilterElement report struct (" +
      MQTT_TYPE_REGISTRY_CITATION +
      ", §3.4).",
    properties: [
      {
        path: "filter_element",
        type: "object",
        group: "peripheral",
        note: "placeholder named after the FilterElement report struct (filter life); field shape unverified",
      },
    ],
  },
  {
    id: "resin",
    transport: "mqtt",
    type: "resin",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/resin",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/resin",
    observed_actions: ["queryInfo"],
    evidence: "mapping",
    note:
      "resin (SLA) line — not valid for the FDM Kobra S1; catalogued for surface completeness (" +
      MQTT_TYPE_REGISTRY_CITATION +
      "); Resin RTTI struct (§3.4).",
    properties: [
      {
        path: "resin",
        type: "object",
        group: "resin",
        note: "placeholder named after the Resin report struct; field shape unverified",
      },
    ],
  },
  {
    id: "exposure",
    transport: "mqtt",
    type: "exposure",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/exposure",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/exposure",
    observed_actions: ["queryInfo"],
    evidence: "mapping",
    note: "resin (SLA) exposure control — not FDM (" + MQTT_TYPE_REGISTRY_CITATION + ").",
    properties: [
      {
        path: "report",
        type: "object",
        group: "resin",
        note: "placeholder; no RTTI struct transcribed for this type yet",
      },
    ],
  },
  {
    id: "lastWill",
    transport: "mqtt",
    type: "lastWill",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/lastWill",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/lastWill",
    observed_actions: ["queryInfo"],
    evidence: "mapping",
    note: "MQTT last-will channel (" + MQTT_TYPE_REGISTRY_CITATION + ").",
    properties: [
      {
        path: "report",
        type: "object",
        group: "state",
        note: "placeholder; no RTTI struct transcribed for this type yet",
      },
    ],
  },
  {
    id: "residual",
    transport: "mqtt",
    type: "residual",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/residual",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/residual",
    observed_actions: ["queryInfo"],
    evidence: "mapping",
    note: "resin residual-clean line — not FDM (" + MQTT_TYPE_REGISTRY_CITATION + ").",
    properties: [
      {
        path: "report",
        type: "object",
        group: "resin",
        note: "placeholder; no RTTI struct transcribed for this type yet",
      },
    ],
  },
  {
    id: "releaseFilm",
    transport: "mqtt",
    type: "releaseFilm",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/releaseFilm",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/releaseFilm",
    observed_actions: ["queryInfo"],
    evidence: "mapping",
    note: "resin release-film line — not FDM (" + MQTT_TYPE_REGISTRY_CITATION + ").",
    properties: [
      {
        path: "report",
        type: "object",
        group: "resin",
        note: "placeholder; no RTTI struct transcribed for this type yet",
      },
    ],
  },
  {
    id: "smartResinVat",
    transport: "mqtt",
    type: "smartResinVat",
    action: "queryInfo",
    cloud_publish: "pc/printer/{model_id}/{printer_key}/smartResinVat",
    lan_publish: "web/printer/{model_id}/{mqtt_device_id}/smartResinVat",
    observed_actions: ["queryInfo"],
    evidence: "mapping",
    note: "smart resin vat peripheral — not FDM (" + MQTT_TYPE_REGISTRY_CITATION + ").",
    properties: [
      {
        path: "report",
        type: "object",
        group: "resin",
        note: "placeholder; no RTTI struct transcribed for this type yet",
      },
    ],
  },
]);

/**
 * HTTP read endpoints on the cloud workbench API.
 * `params` lists the query keys the endpoint actually consumes.
 */
export const CLOUD_HTTP_ENDPOINTS = Object.freeze([
  {
    id: "printers_status",
    path: "/work/printer/printersStatus",
    params: [],
    evidence: "reference",
  },
  { id: "printer_status", path: "/v2/Printer/status", params: ["id"], evidence: "live" },
  {
    id: "printer_info",
    path: "/v2/printer/info",
    params: ["id"],
    evidence: "live",
    note: "richest single source: 128 fields",
  },
  {
    id: "printer_tool",
    path: "/v2/printer/tool",
    params: ["id", "model_id", "type_function_id"],
    evidence: "live",
    note: "type_function_id must be positive (13 = XYZ tool)",
  },
  {
    id: "printer_functions",
    path: "/v2/printer/functions",
    params: ["id", "model_id"],
    evidence: "live",
    note: "returned Photon S metadata for Kobra S1 inputs — not a reliable capability list",
  },
  { id: "printer_all", path: "/v2/printer/all", params: ["id"], evidence: "reference" },
  {
    id: "print_history",
    path: "/v2/project/printHistory",
    params: ["page", "limit", "print_status"],
    evidence: "reference",
  },
  {
    id: "print_history_detail",
    path: "/v5/project/printHistory/detail",
    params: ["task_id"],
    evidence: "live",
  },
  {
    id: "project_info",
    path: "/v2/project/info",
    params: ["id"],
    evidence: "live",
    note: "126 fields incl. slice_param/slice_result and device_message",
  },
  { id: "project_monitor", path: "/v2/project/monitor", params: ["id"], evidence: "live" },
  {
    id: "work_project_error_list",
    path: "/v3/work_project/getErrorList",
    params: ["id"],
    evidence: "reference",
  },
  {
    id: "project_list",
    path: "/work/project/getProjects",
    params: ["page", "limit", "print_status"],
    evidence: "reference",
  },
  {
    id: "gcode_info",
    path: "/work/gcode/info",
    params: ["id"],
    evidence: "reference",
    note: "id is the G-code id, not the task id",
  },
  {
    id: "gcode_info_fdm",
    path: "/work/gcode/infoFdm",
    params: ["id"],
    evidence: "live",
    note: "resolves gcode_id -> cloud file id + slice metadata (63 fields)",
  },
  { id: "cloud_file_info", path: "/farm/file/info", params: ["id"], evidence: "reference" },
  {
    id: "model_file_info",
    path: "/work/index/getModelFileInfo",
    params: ["id"],
    evidence: "reference",
  },
  {
    id: "multi_color_box_info",
    path: "/v2/printer/getMultiColorBoxInfo",
    params: ["id"],
    evidence: "live",
    note: "initial /v2/printer/multiColorBoxInfo returned 404",
  },
  {
    id: "video_thumbnail_list",
    path: "/v3/printer/getVideoThumbnailList",
    params: ["device_id"],
    evidence: "reference",
  },
  { id: "printer_getPrinters", path: "/work/printer/getPrinters", params: [], evidence: "live" },
  { id: "user_files", path: "/work/index/userFiles", params: [], evidence: "live" },
  { id: "user_profile", path: "/v1/user/profile/userInfo", params: [], evidence: "live" },
  {
    id: "login",
    path: "/v3/public/loginWithAccessToken",
    params: [],
    method: "POST",
    evidence: "live",
    note: "legacy /uapi/account/xxLogin returns HTTP 405",
  },
  {
    id: "send_order",
    path: "/work/operation/sendOrder",
    params: [],
    method: "POST",
    evidence: "live",
    note: "accepted orders are NOT proof the device executed them",
  },
]);

/** Read-only HTTP surface exposed by the printer itself. */
export const PRINTER_HTTP_ENDPOINTS = Object.freeze([
  {
    id: "version",
    path: "/api/version",
    result: "200 — self-identifies as OctoPrint 1.8.7 (API 0.1)",
    evidence: "live",
  },
  { id: "printer", path: "/api/printer", result: "404", evidence: "live" },
  { id: "job", path: "/api/job", result: "404", evidence: "live" },
  { id: "connection", path: "/api/connection", result: "404", evidence: "live" },
  { id: "files", path: "/api/files", result: "404", evidence: "live" },
  { id: "settings", path: "/api/settings", result: "404", evidence: "live" },
  { id: "logs", path: "/api/logs", result: "404", evidence: "live" },
  { id: "server_info", path: "/server/info", result: "404", evidence: "live" },
  { id: "objects", path: "/printer/objects/list", result: "404", evidence: "live" },
  { id: "info", path: "/info", result: "404", evidence: "live" },
]);

/**
 * Command / connection map — every writable channel discovered, with its safety
 * class and evidence level. Read-only by construction: this is a description,
 * not an executor. Fields are the payload keys the command expects.
 */
export const COMMAND_MAP = Object.freeze([
  {
    type: "print",
    action: "pause",
    data: { taskid: "task id" },
    safety: "job",
    evidence: "mapping",
  },
  {
    type: "print",
    action: "resume",
    data: { taskid: "task id" },
    safety: "job",
    evidence: "mapping",
  },
  {
    type: "print",
    action: "stop",
    data: { taskid: "-1 to stop current" },
    safety: "job",
    evidence: "mapping",
  },
  {
    type: "print",
    action: "update",
    data: {
      taskid: "task id",
      settings:
        "subset of target_nozzle_temp/target_hotbed_temp/fan_speed_pct/aux_fan_speed_pct/box_fan_level/print_speed_mode",
    },
    safety: "thermal",
    evidence: "mapping",
    note: "changes the RUNNING job; it is not a refresh/status query",
  },
  {
    type: "print",
    action: "start",
    data: { taskid: "task id", file: "remote path" },
    safety: "job",
    evidence: "reference",
    note: "LAN start payload not verified for this Kobra S1",
  },
  { type: "print", action: "query", data: null, safety: "read", evidence: "reference" },
  {
    type: "tempature",
    action: "set",
    data: {
      type: "0 noz / 1 bed / 2 both",
      target_nozzle_temp: "celsius",
      target_hotbed_temp: "celsius",
    },
    safety: "thermal",
    evidence: "mapping",
  },
  { type: "tempature", action: "query", data: null, safety: "read", evidence: "live" },
  {
    type: "tempature",
    action: "auto",
    data: null,
    safety: "thermal",
    evidence: "reference",
    note: "observed as a report action; publish semantics unverified",
  },
  {
    type: "fan",
    action: "setSpeed",
    data: { fan_speed_pct: "0-100", aux_fan_speed_pct: "0-100", box_fan_level: "level" },
    safety: "state",
    evidence: "mapping",
    note: "slicer sends exactly one key per call",
  },
  { type: "fan", action: "query", data: null, safety: "read", evidence: "live" },
  {
    type: "light",
    action: "control",
    data: { type: "2 = chamber", status: "0|1", brightness: "0-100" },
    safety: "state",
    evidence: "live",
    note: "physically executed and confirmed via light/report",
  },
  { type: "light", action: "query", data: null, safety: "read", evidence: "live" },
  { type: "axis", action: "query", data: null, safety: "read", evidence: "live" },
  {
    type: "axis",
    action: "move",
    data: { axis: "x|y|z", move_type: "move|home", distance: "millimeter" },
    safety: "motion",
    evidence: "mapping",
    note: "homexy executed physically during validation",
  },
  {
    type: "axis",
    action: "turnOff",
    data: null,
    safety: "motion",
    evidence: "mapping",
    note: "disables stepper holding torque",
  },
  { type: "peripherie", action: "query", data: null, safety: "read", evidence: "live" },
  { type: "aiSettings", action: "query", data: null, safety: "read", evidence: "live" },
  {
    type: "aiSettings",
    action: "switch",
    data: {
      ai_settings: {
        status: "3 on / 0 off",
        type: "",
        count: "",
        sensitivity_level: "",
        notice_type: "",
      },
    },
    safety: "state",
    evidence: "reference",
    note: "cloud order id 1243; LAN action name unverified",
  },
  { type: "multiColorBox", action: "getInfo", data: null, safety: "read", evidence: "live" },
  {
    type: "multiColorBox",
    action: "setDry",
    data: {
      multi_color_box: [
        {
          id: "box id",
          drying_status: {
            status: "1 start / 0 stop",
            target_temp: "celsius",
            duration: "minutes",
          },
        },
      ],
    },
    safety: "thermal",
    evidence: "mapping",
  },
  {
    type: "multiColorBox",
    action: "feedFilament",
    data: {
      multi_color_box: [
        { id: "box id", feed_status: { slot_index: "slot", type: "feed direction" } },
      ],
    },
    safety: "motion",
    evidence: "mapping",
  },
  {
    type: "multiColorBox",
    action: "setInfo",
    data: {
      multi_color_box: [
        {
          id: "box id",
          slots: [
            {
              index: "slot",
              type: "material",
              color: "[R,G,B]",
              sku: "optional, <=20 chars — custom/manual filament SKU",
            },
          ],
        },
      ],
    },
    safety: "state",
    evidence: "mapping",
    note: "legitimate manual-filament path (mirrors edit_status=1). sku is OPTIONAL: omitted = plain manual slot (type+colour); filled (max 20 chars, the NFC-tag SKU field width) = custom filament with a product identity without any tag. The live payload shows sku is the only per-slot material identifier (mqtt-surface-sweep §4).",
  },
  {
    type: "multiColorBox",
    action: "setAutoFeed",
    data: { multi_color_box: [{ id: "box id", auto_feed: "0|1" }] },
    safety: "state",
    evidence: "mapping",
  },
  { type: "file", action: "listLocal", data: null, safety: "read", evidence: "live" },
  { type: "file", action: "listUdisk", data: null, safety: "read", evidence: "live" },
  {
    type: "file",
    action: "getPreSignedUrl",
    data: { path: "", filename: "" },
    safety: "read",
    evidence: "live",
  },
  {
    type: "file",
    action: "saveVideoThumbnail",
    data: { filename: "", fileKey: "", thumbnailUrl: "" },
    safety: "read",
    evidence: "live",
  },
  {
    type: "file",
    action: "deleteLocal",
    data: { filename: "" },
    safety: "state",
    evidence: "reference",
    note: "destructive; not validated",
  },
  {
    type: "file",
    action: "deleteUdisk",
    data: { filename: "" },
    safety: "state",
    evidence: "reference",
    note: "destructive; not validated",
  },
  {
    type: "video",
    action: "startCapture",
    data: null,
    safety: "state",
    evidence: "mapping",
    note: "starts the camera stream",
  },
  { type: "video", action: "stopCapture", data: null, safety: "state", evidence: "mapping" },
  { type: "extfilbox", action: "query", data: null, safety: "read", evidence: "reference" },
  { type: "info", action: "query", data: null, safety: "read", evidence: "live" },

  // ---------------------------------------------------------------------------
  // Binary action registry additions (38 new action names; slicer-binary-
  // surface §3.3, immediately after the type tables). Evidence level is
  // `mapping` for every entry: the names exist as strings in cloud_mqtt.dll /
  // mach_mqtt.dll; the type/action PAIRING is inferred from the doc's intent
  // groups and RTTI struct names (the registries are two separate string
  // tables — the binary does not store pairs), and no payload shape has been
  // observed. `data: null` everywhere: nothing here is executable until a
  // live capture validates the envelope.
  // ---------------------------------------------------------------------------
  {
    type: "filament",
    action: "report",
    data: null,
    safety: "read",
    evidence: "mapping",
    note:
      "registry line 'filament/report' — the dedicated per-spool filament report; top live-validation target (§8 priority 1). " +
      MQTT_TYPE_REGISTRY_CITATION,
  },
  {
    type: "filament",
    action: "queryInfo",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "registry query verb; sweep probed it on filament/preheating/levelling/screenSaver/autoOperation/status types — broker ack, no device report in every case (mqtt-surface-sweep §8).",
  },
  {
    type: "status",
    action: "reportStatus",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "FDM status channel report verb (" + MQTT_TYPE_REGISTRY_CITATION + ").",
  },
  {
    type: "preheating",
    action: "queryInfo",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "preheat state machine query (" + MQTT_TYPE_REGISTRY_CITATION + ").",
  },
  {
    type: "levelling",
    action: "queryInfo",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "auto bed levelling query (" + MQTT_TYPE_REGISTRY_CITATION + ").",
  },
  {
    type: "screenSaver",
    action: "queryInfo",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "panel control query (" + MQTT_TYPE_REGISTRY_CITATION + ").",
  },
  {
    type: "network",
    action: "getSignalStrength",
    data: null,
    safety: "read",
    evidence: "mapping",
    note:
      "the registry pairs the network type with getSignalStrength (doc §3.2 'getSignalStrength lives here'); NetworkQuery struct. Probe acked, no report. " +
      MQTT_TYPE_REGISTRY_CITATION,
  },
  {
    type: "autoOperation",
    action: "queryInfo",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "auto-op state machine query; AutoOpStatus struct (" + MQTT_TYPE_REGISTRY_CITATION + ").",
  },
  {
    type: "multiColorBox",
    action: "reportAutoFeedInfo",
    data: null,
    safety: "read",
    evidence: "mapping",
    note:
      "ACE auto-feed state report verb (" +
      MQTT_TYPE_REGISTRY_CITATION +
      "); pairs with the auto_feed field of the live multiColorBox payload.",
  },
  {
    type: "extfilbox",
    action: "reportInfo",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "external filament holder report verb; sweep probed extfilbox/reportInfo twice — acked, device silent on an idle printer (mqtt-surface-sweep §5).",
  },
  {
    type: "info",
    action: "reportVersion",
    data: null,
    safety: "read",
    evidence: "mapping",
    note:
      "OTA lane (doc §3.3); OTAUpgrade/OTAVersion structs exist in the FDM report namespace — type pairing inferred, the registry stores no pairs. " +
      MQTT_TYPE_REGISTRY_CITATION,
  },
  {
    type: "info",
    action: "downloading",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "OTA download-progress report verb (doc §3.3 OTA group); type pairing inferred.",
  },
  {
    type: "info",
    action: "updating",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "OTA update-progress report verb (doc §3.3 OTA group); type pairing inferred.",
  },
  {
    type: "info",
    action: "canceled",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "OTA cancellation report verb (doc §3.3 OTA group); type pairing inferred.",
  },
  {
    type: "info",
    action: "update-success",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "OTA success report verb, hyphenated in the registry (doc §3.3); type pairing inferred.",
  },
  {
    type: "info",
    action: "update-failed",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "OTA failure report verb, hyphenated in the registry (doc §3.3); type pairing inferred.",
  },
  {
    type: "info",
    action: "download-failed",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "OTA download-failure report verb, hyphenated in the registry (doc §3.3); type pairing inferred.",
  },
  {
    type: "info",
    action: "updateSuccessProcessed",
    data: null,
    safety: "state",
    evidence: "mapping",
    note: "OTA lane (doc §3.3); reads as a processing acknowledgement the client sends after an OTA outcome — direction/payload unvalidated, treat as write-shaped.",
  },
  {
    type: "info",
    action: "updateFailedProcessed",
    data: null,
    safety: "state",
    evidence: "mapping",
    note: "OTA lane (doc §3.3); processing acknowledgement for a failed update — direction/payload unvalidated, treat as write-shaped.",
  },
  {
    type: "print",
    action: "onlineReport",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "print-control lane report verb (doc §3.3); pairing inferred.",
  },
  {
    type: "print",
    action: "workReport",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "push-only work report verb (doc §3.3); the live status push carries workReport objects (catalog status source).",
  },
  {
    type: "print",
    action: "ignore",
    data: null,
    safety: "job",
    evidence: "mapping",
    note: "skip one object of the RUNNING job (doc §3.3 print control 'ignore (skip object)'); PrintIgnore struct (§3.4). Affects the part on the bed — job-class gate; payload unvalidated.",
  },
  {
    type: "print",
    action: "monitor",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "print monitoring query; PrintMonitoring struct (" + MQTT_TYPE_REGISTRY_CITATION + ").",
  },
  {
    type: "print",
    action: "reDetect",
    data: null,
    safety: "state",
    evidence: "mapping",
    note: "re-run on-device AI failure detection (doc §3.3); PrintRetect struct [sic] (§3.4). Triggers computation, no motion; state-class.",
  },
  {
    type: "video",
    action: "listVideo",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "file lane (doc §3.3): recorded videos listing; VideoList struct (§3.4).",
  },
  {
    type: "video",
    action: "deleteVideo",
    data: null,
    safety: "state",
    evidence: "mapping",
    note: "file lane (doc §3.3): destructive video delete; VideoDelete struct (§3.4). Not validated.",
  },
  {
    type: "video",
    action: "videoThumbnailList",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "sweep probed video/videoThumbnailList — broker ack, no device report (mqtt-surface-sweep §8).",
  },
  {
    type: "file",
    action: "deleteBatch",
    data: null,
    safety: "state",
    evidence: "mapping",
    note: "destructive bulk delete; appears ONLY in cloud_mqtt.dll 3195888, not in mach_mqtt.dll — a cloud-only bulk delete (doc §3.3). Not validated.",
  },
  {
    type: "file",
    action: "fileDetails",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "file lane: per-file detail query; FileDetail struct (doc §3.3/§3.4).",
  },
  {
    type: "file",
    action: "renameFile",
    data: null,
    safety: "state",
    evidence: "mapping",
    note: "file lane: rename (write); FileRename struct (doc §3.3/§3.4). Not validated.",
  },
  {
    type: "file",
    action: "cloudRecommendList",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "file lane: cloud-recommended model list (doc §3.3).",
  },
  {
    type: "file",
    action: "replace",
    data: null,
    safety: "state",
    evidence: "mapping",
    note: "file lane: replace (write, destructive-ish) (doc §3.3). Not validated.",
  },
  {
    type: "multiColorBox",
    action: "autoUpdateInfo",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "ACE/box lane (doc §3.3): box info auto-update report verb.",
  },
  {
    type: "multiColorBox",
    action: "autoUpdateDryStatus",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "ACE/box lane (doc §3.3): drying-state report verb; MCBDryStatus RTTI struct — drying as a separate struct, not a field of MultiBoxInfo (§3.4).",
  },
  {
    type: "multiColorBox",
    action: "finishFeedFilament",
    data: null,
    safety: "motion",
    evidence: "mapping",
    note: "ACE/box lane (doc §3.3): the SECOND phase of a two-phase feed ('feed has a two-phase completion we do not model; a half-fed ACE is a jam'). Requires hardware validation; treat as feed motion.",
  },
  {
    type: "multiColorBox",
    action: "refresh",
    data: null,
    safety: "read",
    evidence: "mapping",
    note: "ACE/box lane (doc §3.3): box state refresh verb; pairing inferred.",
  },
  {
    type: "resin",
    action: "feedResin",
    data: null,
    safety: "motion",
    evidence: "mapping",
    note: "resin (SLA) line (doc §3.3): physical resin feed; not valid for the FDM Kobra S1.",
  },
  {
    type: "resin",
    action: "cyclicCleaning",
    data: null,
    safety: "motion",
    evidence: "mapping",
    note: "resin (SLA) line (doc §3.3): cyclic vat cleaning; physical motion.",
  },
  {
    type: "resin",
    action: "clean",
    data: null,
    safety: "state",
    evidence: "mapping",
    note: "resin (SLA) line (doc §3.3): clean verb; semantics unvalidated.",
  },
  {
    type: "resin",
    action: "cancel",
    data: null,
    safety: "state",
    evidence: "mapping",
    note: "resin (SLA) line (doc §3.3): cancel verb; semantics unvalidated.",
  },
  {
    type: "resin",
    action: "reset",
    data: null,
    safety: "state",
    evidence: "mapping",
    note: "resin (SLA) line (doc §3.3): reset verb; semantics unvalidated.",
  },
  {
    type: "axis",
    action: "moveToCoordinates",
    data: null,
    safety: "motion",
    evidence: "mapping",
    note: "the registry variant of our axis/move (doc §3.3: 'move → moveToCoordinates'). Payload shape NOT evidenced — the legacy order-id move used axis/move_type/distance; publishing this name requires live validation first.",
  },
]);

/**
 * Legacy HTTP `sendOrder` identifiers.
 * START_PRINT=1 / PAUSE=2 / RESUME=3 / STOP=4 follow the reference
 * AnycubicOrderID IntEnum and were LIVE-VALIDATED 2026-09-11 (task <TASK_ID>
 * started the physical printer; STOP_PRINT cleared residual task <TASK_ID>).
 * The old 1240/1241/1242 hypothesis answered "Operation successful" yet never
 * created a task. Other ids are descriptive only — never use an unvalidated id
 * to discover semantics.
 */
export const LEGACY_ORDER_IDS = Object.freeze({
  START_PRINT: 1,
  PAUSE_PRINT: 2,
  RESUME_PRINT: 3,
  STOP_PRINT: 4,
  SET_AI_SETTINGS: 1243,
  SET_TEMPERATURE: 1214,
  SET_FAN_SPEED: 1215,
  SET_PRINT_SPEED: 1216,
  SET_LIGHT_STATUS: 1217,
  MOVE_AXLE: 1226,
  MOVE_AXLE_TURN_OFF: 1227,
  QUERY_AXIS_POSITION: 1214,
  LIST_LOCAL_FILES: 103,
  LIST_UDISK_FILES: 1235,
  DELETE_LOCAL_FILE: 1236,
  DELETE_UDISK_FILE: 1237,
  QUERY_PERIPHERALS: 1231,
  GET_LIGHT_STATUS: 1232,
  MULTI_COLOR_BOX_GET_INFO: 1206,
  MULTI_COLOR_BOX_DRY: 1251,
  MULTI_COLOR_BOX_AUTO_FEED: 1252,
  MULTI_COLOR_BOX_SET_SLOT: 1253,
  FEED_FILAMENT: 1254,
  CAMERA_OPEN: 1260,
});

/** Validated HTTP read order ids (corrected and tested against the live device). */
export const VALIDATED_HTTP_READ_ORDER_IDS = Object.freeze({
  axis: 1214,
  peripherie: 1231,
  light: 1232,
  multiColorBox: 1206,
  local_files: 103,
  usb_files: 101,
});

export const LIFECYCLE_STATES = Object.freeze([
  "preheating",
  "auto_leveling",
  "vibrating",
  "flow_calibrating",
  "printing",
  "pausing",
  "paused",
  "resuming",
  "resumed",
  "stopping",
  "stoped",
  "finished",
  "failed",
]);

export const DEFAULT_PORT_SCAN = Object.freeze([
  18910, 9883, 990, 21, 8883, 80, 18088, 18086, 1883, 7125, 22,
]);

/**
 * Actions that are read-only by definition. Every entry in `QUERYABLE_SOURCES`
 * must use one of these, so the reader can never publish a mutating action.
 */
export const READ_ONLY_ACTIONS = Object.freeze([
  "query",
  "getInfo",
  "reportInfo",
  "listLocal",
  "listUdisk",
  "getPreSignedUrl",
  "saveVideoThumbnail",
  "report",
]);

/**
 * Flatten an arbitrary payload into `path -> leaf value` pairs (arrays as `[]`).
 * First occurrence wins for array elements, so the shape is stable regardless of
 * how many elements the printer reported.
 */
export function flattenProperties(value, prefix = "", out = {}, depth = 0) {
  if (depth > 12 || value === null || value === undefined) {
    if (prefix && !(prefix in out)) out[prefix] = value ?? null;
    return out;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (!(prefix in out)) out[prefix] = [];
      return out;
    }
    for (const item of value) flattenProperties(item, `${prefix}[]`, out, depth + 1);
    return out;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenProperties(child, prefix ? `${prefix}.${key}` : key, out, depth + 1);
    }
    return out;
  }
  if (!(prefix in out)) out[prefix] = value;
  return out;
}

function normalizeTemplatePath(path) {
  return path.replace(/\[\]/g, "[]");
}

function leafValueAt(payload, path) {
  const segments = path.split(".").flatMap((segment) => {
    const match = segment.match(/^([^[\]]+)((\[\])*)$/);
    if (!match) return [[segment, 0]];
    const brackets = (match[2].match(/\[\]/g) ?? []).length;
    return [[match[1], brackets]];
  });
  let current = payload;
  for (const [key, brackets] of segments) {
    if (Array.isArray(current)) {
      const found = current.map((item) => item?.[key]).find((item) => item !== undefined);
      current = found;
    } else if (current && typeof current === "object") {
      current = current[key];
    } else {
      return undefined;
    }
    for (let i = 0; i < brackets; i += 1) {
      current = Array.isArray(current) ? current[0] : undefined;
    }
    if (current === undefined || current === null) return current;
  }
  return current;
}

/**
 * Match a live payload against a catalog property list.
 * Returns matched (with value), missing catalog entries and unmapped extra fields.
 */
export function matchProperties(payload, propertyList) {
  const flat = flattenProperties(payload ?? {});
  const matched = [];
  const missing = [];
  const consumed = new Set();
  const declared = new Set();

  for (const property of propertyList) {
    const path = normalizeTemplatePath(property.path);
    declared.add(path);
    const value = leafValueAt(payload ?? {}, property.path);
    if (value === undefined) {
      missing.push(path);
      continue;
    }
    matched.push({
      path,
      value,
      type: property.type,
      unit: property.unit ?? null,
      group: property.group ?? null,
      label: property.label ?? null,
      note: property.note ?? null,
    });
    for (const flatPath of Object.keys(flat)) {
      if (flatPath === path || flatPath.startsWith(`${path}.`) || flatPath.startsWith(`${path}[`))
        consumed.add(flatPath);
    }
  }

  const extra = Object.keys(flat).filter(
    (flatPath) => !consumed.has(flatPath) && !declared.has(flatPath),
  );
  return {
    matched,
    missing,
    extra,
    observed_count: matched.length,
    catalog_count: propertyList.length,
  };
}

export function sourceById(id) {
  return READ_SOURCES.find((source) => source.id === id) ?? null;
}

export function sourcesByTransport(transport) {
  return READ_SOURCES.filter((source) => source.transport === transport);
}

export function commandByTypeAction(type, action) {
  return COMMAND_MAP.find((entry) => entry.type === type && entry.action === action) ?? null;
}

/** Total declared property paths across every read source. */
export function catalogStats() {
  const bySource = {};
  let total = 0;
  for (const source of READ_SOURCES) {
    bySource[source.id] = source.properties.length;
    total += source.properties.length;
  }
  const byEvidence = {};
  for (const source of READ_SOURCES) {
    byEvidence[source.evidence] = (byEvidence[source.evidence] ?? 0) + source.properties.length;
  }
  const byHttpEndpoint = {};
  let httpTotal = 0;
  for (const [kind, entry] of Object.entries(HTTP_PROPERTY_CATALOG)) {
    byHttpEndpoint[kind] = entry.properties.length;
    httpTotal += entry.properties.length;
  }
  const httpEvidence = {};
  for (const entry of Object.values(HTTP_PROPERTY_CATALOG)) {
    httpEvidence[entry.evidence] = (httpEvidence[entry.evidence] ?? 0) + entry.properties.length;
  }
  return {
    sources: READ_SOURCES.length,
    total_properties: total,
    by_source: bySource,
    by_evidence: byEvidence,
    http_endpoints_with_catalog: Object.keys(HTTP_PROPERTY_CATALOG).length,
    http_properties: httpTotal,
    by_http_endpoint: byHttpEndpoint,
    http_by_evidence: httpEvidence,
    grand_total_properties: total + httpTotal,
    commands: COMMAND_MAP.length,
    mqtt_type_registry: {
      registry_types: MQTT_TYPE_REGISTRY.length,
      known_before_binary: MQTT_TYPE_REGISTRY.filter((t) => t.catalog_status === "known").length,
      new_in_binary: MQTT_TYPE_REGISTRY.filter((t) => t.catalog_status === "new").length,
      firmware_alias_types_not_in_registry: MQTT_FIRMWARE_ALIAS_TYPES.length,
      report_structs: MQTT_REPORT_STRUCTS.length,
      citation: MQTT_TYPE_REGISTRY_CITATION,
    },
    mqtt_action_registry: {
      registry_total: 56,
      distinct_new_action_names: 38,
      // One entry per (type, action) pair; the queryInfo verb is catalogued
      // once per type it was probed against, so the pair count exceeds 38.
      command_pairs_added_from_binary: 42,
      citation:
        "docs/research/slicer-binary-surface-2026-11-18.md §3.3 — every added entry is evidence: mapping, data: null",
    },
    cloud_http_endpoints: CLOUD_HTTP_ENDPOINTS.length,
    printer_http_endpoints: PRINTER_HTTP_ENDPOINTS.length,
  };
}

/**
 * Match an HTTP endpoint payload against its generated property catalog, so the
 * same extra/missing reporting used for MQTT also applies to the HTTP surface
 * (printer_info alone declares 128 paths).
 */
export function matchHttpProperties(kind, payload) {
  const entry = HTTP_PROPERTY_CATALOG[kind];
  if (!entry) return null;
  const flat = flattenProperties(payload ?? {});
  const consumed = new Set();
  const matched = [];
  const missing = [];
  for (const property of entry.properties) {
    const path = normalizeTemplatePath(property.path);
    const value = leafValueAt(payload ?? {}, property.path);
    if (value === undefined) {
      missing.push(path);
      continue;
    }
    matched.push({ path, value, unit: property.unit ?? null, group: property.group ?? null });
    for (const flatPath of Object.keys(flat)) {
      if (flatPath === path || flatPath.startsWith(`${path}.`) || flatPath.startsWith(`${path}[`))
        consumed.add(flatPath);
    }
  }
  const declared = new Set(
    entry.properties.map((property) => normalizeTemplatePath(property.path)),
  );
  const extra = Object.keys(flat).filter(
    (flatPath) => !consumed.has(flatPath) && !declared.has(flatPath),
  );
  return {
    kind,
    endpoint: entry.path,
    evidence: entry.evidence,
    catalog_count: entry.properties.length,
    observed_count: matched.length,
    coverage_pct: entry.properties.length
      ? Math.round((matched.length / entry.properties.length) * 1000) / 10
      : 0,
    matched,
    missing,
    extra,
  };
}

export function httpCatalog() {
  return Object.entries(HTTP_PROPERTY_CATALOG).map(([kind, entry]) => ({
    kind,
    path: entry.path,
    evidence: entry.evidence,
    note: entry.note ?? null,
    property_count: entry.properties.length,
  }));
}
