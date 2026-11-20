/**
 * LANE IMPL-2 tests: MQTT map expansion (binary registry), the raw ACE
 * inventory read (ace_raw_report) and the sku-capable ace_set_slot.
 *
 * Fixtures reproduce the REAL captured shapes from the 2026-11-18 surface
 * sweep (docs/evidence/mqtt-surface-sweep-2026-11-18.json — the idle Kobra S1
 * multiColorBox payload with the tagged slot AHPLLB-107 and edit_status 1 on
 * slot 2) and the probe record (docs/evidence/mqtt-read-probes-2026-11-18.json
 * — extfilbox acked but device-silent). All identifiers are the sanitized
 * placeholders the evidence itself uses. No network: everything runs against
 * an in-memory manager + fake cloud.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import z from "zod";

import {
  COMMAND_MAP,
  MQTT_FIRMWARE_ALIAS_TYPES,
  MQTT_REPORT_STRUCTS,
  MQTT_TYPE_REGISTRY,
  MQTT_TYPE_REGISTRY_CITATION,
  READ_ONLY_ACTIONS,
  READ_SOURCES,
  catalogStats,
  sourceById,
} from "../scripts/printer-property-catalog.mjs";
import { QUERYABLE_SOURCES } from "../scripts/printer-full-read.mjs";
import { collectAceRawReport } from "../scripts/printer-full-read.mjs";
import {
  CloudConnectionManager,
  assertConfirm,
  registerAceTools,
} from "../scripts/printer-command-bus.mjs";

// ---------------------------------------------------------------------------
// Fixtures — real captured shapes (sanitized placeholders)
// ---------------------------------------------------------------------------

/** multiColorBox/getInfo reply, byte-shape of the 2026-11-18 sweep payload. */
const SWEEP_MCB_PAYLOAD = {
  head_tools_model: 0,
  multi_color_box: [
    {
      id: 0,
      status: 1,
      model_id: "<ACE_MODEL_ID>",
      auto_feed: 0,
      loaded_slot: -1,
      feed_status: { code: 200, type: -1, current_status: -1, slot_index: -1 },
      temp: 27,
      humidity: 22,
      drying_status: { status: 0, target_temp: 0, duration: 0, remain_time: 0 },
      slots: [
        {
          index: 0,
          sku: "AHPLLB-107",
          type: "PLA",
          color: [212, 185, 150],
          edit_status: 0,
          status: 5,
          color_group: [[212, 185, 150, 255]],
          icon_type: 0,
          consumables_percent: 50,
        },
        {
          index: 1,
          sku: "",
          type: "PETG",
          color: [141, 118, 109],
          edit_status: 0,
          status: 5,
          color_group: [[141, 118, 109, 255]],
          icon_type: 0,
          consumables_percent: 0,
        },
        {
          index: 2,
          sku: "",
          type: "PLA",
          color: [0, 187, 49],
          edit_status: 1,
          status: 5,
          color_group: [[0, 187, 49, 255]],
          icon_type: 0,
          consumables_percent: 0,
        },
        {
          index: 3,
          sku: "",
          type: "PETG",
          color: [242, 239, 206],
          edit_status: 0,
          status: 5,
          color_group: [[242, 239, 206, 255]],
          icon_type: 0,
          consumables_percent: 0,
        },
      ],
    },
  ],
};

/**
 * HTTP /v2/printer/getMultiColorBoxInfo envelope covering ALL 33 catalogued
 * `ace` paths plus one catalog-external field (slots[].brand) to prove the
 * raw read returns extras unfiltered.
 */
const ACE_HTTP_ENVELOPE = {
  code: 1,
  msg: "ok",
  data: [
    {
      id: 0,
      box_name: "ACE",
      model_id: 40002,
      status: 1,
      auto_feed: 0,
      curr_nozzle_temp: 27,
      target_nozzle_temp: 0,
      temp: 27,
      humidity: 22,
      loaded_slot: -1,
      feed_status: { code: 200, type: -1, current_status: -1, slot_index: -1 },
      drying_status: { status: 0, target_temp: 0, duration: 0, remain_time: 0 },
      slots: [
        {
          index: 0,
          sku: "AHPLLB-107",
          type: "PLA",
          color: [212, 185, 150],
          color_group: [[212, 185, 150, 255]],
          edit_status: 0,
          status: 5,
          icon_type: 0,
          consumables_percent: 50,
        },
        {
          index: 2,
          sku: "MY-SKU-123",
          type: "PETG",
          color: [10, 20, 30],
          color_group: [[10, 20, 30, 255]],
          edit_status: 1,
          status: 5,
          icon_type: 0,
          consumables_percent: 0,
          brand: "AC",
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// MQTT map expansion — accounting and evidence levels
// ---------------------------------------------------------------------------

test("the binary type registry accounts for 21 types: 7 known, 14 new", () => {
  assert.equal(MQTT_TYPE_REGISTRY.length, 21, "the SDK registry holds exactly 21 types");
  assert.equal(
    MQTT_TYPE_REGISTRY.filter((t) => t.catalog_status === "known").length,
    7,
    "print/tempature/light/multiColorBox/extfilbox/video/peripherie were known before",
  );
  const newTypes = MQTT_TYPE_REGISTRY.filter((t) => t.catalog_status === "new");
  assert.equal(newTypes.length, 14);
  assert.deepEqual(
    newTypes.map((t) => t.type).sort(),
    [
      "airpure",
      "autoOperation",
      "exposure",
      "filament",
      "lastWill",
      "levelling",
      "network",
      "preheating",
      "releaseFilm",
      "residual",
      "resin",
      "screenSaver",
      "smartResinVat",
      "status",
    ].sort(),
  );
  assert.equal(MQTT_REPORT_STRUCTS.length, 31, "31 RTTI report structs");
  assert.deepEqual([...MQTT_FIRMWARE_ALIAS_TYPES].sort(), [
    "aiSettings",
    "axis",
    "fan",
    "file",
    "info",
  ]);
});

test("every registry type absent from the old catalog became a mapping-level read source", () => {
  const sourceIds = new Set(READ_SOURCES.map((s) => s.id));
  // "video" is NOT registry-added (it shipped with the catalog); the
  // new-in-binary surface it carries is the videoThumbnailList/listVideo/
  // deleteVideo verbs, asserted in the command-pair test below.
  for (const entry of MQTT_TYPE_REGISTRY.filter((t) => t.type !== "video")) {
    // status already existed as a live push-only source; every other new type
    // must be present now.
    assert.ok(sourceIds.has(entry.type), `missing read source for type ${entry.type}`);
  }
  const citation = "cloud_mqtt.dll 3194984-3195304";
  assert.ok(MQTT_TYPE_REGISTRY_CITATION.includes(citation), "registry citation carries offsets");
  for (const id of [
    "filament",
    "preheating",
    "levelling",
    "screenSaver",
    "network",
    "autoOperation",
    "airpure",
    "resin",
    "exposure",
    "lastWill",
    "residual",
    "releaseFilm",
    "smartResinVat",
  ]) {
    const source = sourceById(id);
    assert.ok(source, `source ${id} missing`);
    assert.equal(
      source.evidence,
      "mapping",
      `${id} must stay mapping-level until a live capture validates it`,
    );
    assert.ok(source.note.includes(citation), `${id} note must cite the binary offsets`);
    assert.ok(source.cloud_publish.includes("{model_id}"), `${id} needs a cloud topic template`);
    assert.ok(source.lan_publish.includes("{model_id}"), `${id} needs a LAN topic template`);
    assert.ok(
      !READ_ONLY_ACTIONS.includes(source.action),
      `${id} default action must NOT be on the default read path yet`,
    );
  }
});

test("the 38 new action names are all catalogued as mapping-level command pairs", () => {
  const NEW_ACTIONS = [
    "report",
    "queryInfo",
    "reportStatus",
    "reportAutoFeedInfo",
    "feedResin",
    "cyclicCleaning",
    "reportInfo",
    "reset",
    "reportVersion",
    "updateSuccessProcessed",
    "updateFailedProcessed",
    "downloading",
    "updating",
    "canceled",
    "update-success",
    "update-failed",
    "download-failed",
    "onlineReport",
    "clean",
    "cancel",
    "moveToCoordinates",
    "getSignalStrength",
    "workReport",
    "deleteBatch",
    "cloudRecommendList",
    "videoThumbnailList",
    "fileDetails",
    "renameFile",
    "listVideo",
    "deleteVideo",
    "ignore",
    "monitor",
    "reDetect",
    "replace",
    "autoUpdateDryStatus",
    "finishFeedFilament",
    "refresh",
    "autoUpdateInfo",
  ];
  assert.equal(NEW_ACTIONS.length, 38, "the binary registry adds exactly 38 action names");
  const catalogued = new Set(COMMAND_MAP.map((c) => c.action));
  for (const action of NEW_ACTIONS) {
    assert.ok(catalogued.has(action), `action ${action} missing from COMMAND_MAP`);
  }
  // Every addition carries mapping evidence (never live) and a citation note.
  const additions = COMMAND_MAP.filter((c) => NEW_ACTIONS.includes(c.action));
  for (const entry of additions) {
    assert.equal(entry.evidence, "mapping", `${entry.type}/${entry.action} must be mapping-level`);
    assert.equal(entry.data, null, `${entry.type}/${entry.action}: no payload is evidenced`);
    assert.ok(
      entry.note.includes("3194984") ||
        entry.note.includes("mqtt-surface-sweep") ||
        entry.note.includes("doc §3.3") ||
        entry.note.includes("slicer-binary-surface"),
      `${entry.type}/${entry.action} note must cite its evidence`,
    );
  }
});

test("catalog accounting stays coherent after the expansion", () => {
  const stats = catalogStats();
  assert.equal(stats.commands, COMMAND_MAP.length);
  // 34 pairs before + 42 pairs added (queryInfo catalogued per probed type).
  assert.equal(stats.commands, 76);
  assert.equal(stats.sources, READ_SOURCES.length);
  assert.equal(stats.sources, 25, "12 original sources + 13 new types (status existed)");
  assert.equal(stats.mqtt_type_registry.registry_types, 21);
  assert.equal(stats.mqtt_type_registry.new_in_binary, 14);
  assert.equal(stats.mqtt_type_registry.report_structs, 31);
  assert.equal(stats.mqtt_action_registry.registry_total, 56);
  assert.equal(stats.mqtt_action_registry.distinct_new_action_names, 38);
  // The default read path is unchanged: new mapping-level sources stay out.
  for (const id of ["filament", "network", "preheating", "resin", "airpure"]) {
    assert.ok(!QUERYABLE_SOURCES.includes(id), `${id} must not be queried by default`);
  }
  assert.equal(QUERYABLE_SOURCES.length, 11, "original queryable set unchanged");
});

// ---------------------------------------------------------------------------
// ace_raw_report — full inventory read against real fixtures
// ---------------------------------------------------------------------------

function fakeClient() {
  return {
    disconnected: false,
    disconnecting: false,
    endAsync: async () => {},
    on: () => {},
    publish: (_topic, _payload, cb) => cb(null),
  };
}

function seededManager(events) {
  const cloud = {
    xxToken: "test-token",
    login: async () => {},
    connectMqtt: async () => fakeClient(),
  };
  const manager = new CloudConnectionManager({ cloud });
  for (const event of events) manager.events.push(event);
  return manager;
}

function httpCloud() {
  let calls = 0;
  return {
    xxToken: "test-token",
    login: async () => {},
    connectMqtt: async () => fakeClient(),
    rawApi: async (method, endpoint) => {
      calls += 1;
      assert.equal(method, "GET");
      assert.equal(endpoint, "/v2/printer/getMultiColorBoxInfo");
      return structuredClone(ACE_HTTP_ENVELOPE);
    },
    _calls: () => calls,
  };
}

const PRINTER = { id: 1, machine_type: "20025", key: "<PRINTER_KEY>" };

test("ace_raw_report returns the integral multiColorBox payload with full reconciliation", async () => {
  const manager = seededManager([
    {
      topic: "anycubic/anycubicCloud/v1/printer/public/20025/<PRINTER_KEY>/multiColorBox/report",
      received_at: new Date().toISOString(),
      data: {
        type: "multiColorBox",
        action: "getInfo",
        code: 200,
        msgid: "device-1",
        data: structuredClone(SWEEP_MCB_PAYLOAD),
      },
    },
  ]);
  const cloud = httpCloud();
  const result = await collectAceRawReport({
    manager,
    cloud,
    printer: PRINTER,
    timeoutMs: 300,
  });
  // Integral: every field of the sweep payload is returned, unfiltered.
  const mcb = result.sources.multiColorBox;
  assert.equal(mcb.state, "uncorrelated_report", "sweep reports replay as type-only matches");
  assert.equal(mcb.report_count, 1);
  assert.equal(mcb.data.head_tools_model, 0);
  assert.equal(mcb.data.multi_color_box[0].slots[0].sku, "AHPLLB-107");
  assert.equal(mcb.data.multi_color_box[0].slots[0].consumables_percent, 50);
  assert.equal(mcb.data.multi_color_box[0].slots[2].edit_status, 1, "manual slot preserved");
  assert.equal(mcb.data.multi_color_box[0].loaded_slot, -1);
  // Reconciliation: the sweep showed 25/25 catalogued paths matched, extras [].
  assert.equal(mcb.reconciliation.catalog_count, mcb.reconciliation.observed_count);
  assert.deepEqual(mcb.reconciliation.extra, []);
  assert.deepEqual(mcb.device_codes, [200]);
});

test("ace_raw_report surfaces catalog-external fields as extras without dropping them", async () => {
  const payload = structuredClone(SWEEP_MCB_PAYLOAD);
  payload.multi_color_box[0].beta_field_probe = { depth: 2 };
  payload.multi_color_box[0].slots[0].tag_uid_guess = "not-a-real-field";
  const manager = seededManager([
    {
      topic: "anycubic/anycubicCloud/v1/printer/public/20025/<PRINTER_KEY>/multiColorBox/report",
      received_at: new Date().toISOString(),
      data: { type: "multiColorBox", action: "getInfo", code: 200, msgid: "d", data: payload },
    },
  ]);
  const result = await collectAceRawReport({
    manager,
    cloud: httpCloud(),
    printer: PRINTER,
    timeoutMs: 300,
  });
  const mcb = result.sources.multiColorBox;
  // Integral: the unknown fields are still in the raw data...
  assert.deepEqual(mcb.data.multi_color_box[0].beta_field_probe, { depth: 2 });
  assert.equal(mcb.data.multi_color_box[0].slots[0].tag_uid_guess, "not-a-real-field");
  // ...and flagged as unmapped discoveries, not silently swallowed. The
  // flattener records leaf paths, so an unknown OBJECT surfaces as its
  // deepest leaf (beta_field_probe.depth), an unknown scalar as itself.
  assert.ok(mcb.reconciliation.extra.includes("multi_color_box[].beta_field_probe.depth"));
  assert.ok(mcb.reconciliation.extra.includes("multi_color_box[].slots[].tag_uid_guess"));
  assert.equal(result.inventory.extra_fields.length, 2);
});

test("ace_raw_report adds the 33-field HTTP ace envelope and reconciles extras", async () => {
  const manager = seededManager([
    {
      topic: "anycubic/anycubicCloud/v1/printer/public/20025/<PRINTER_KEY>/multiColorBox/report",
      received_at: new Date().toISOString(),
      data: {
        type: "multiColorBox",
        action: "getInfo",
        code: 200,
        msgid: "d",
        data: structuredClone(SWEEP_MCB_PAYLOAD),
      },
    },
  ]);
  const cloud = httpCloud();
  const result = await collectAceRawReport({ manager, cloud, printer: PRINTER, timeoutMs: 300 });
  assert.equal(result.http.state, "reply");
  assert.equal(result.http.reconciliation.catalog_count, 33);
  assert.equal(result.http.reconciliation.observed_count, 33, "fixture covers every catalog path");
  // The catalog declares the data[].slots parent, and the matcher treats a
  // declared path as consuming everything beneath it — so a catalog-external
  // slot field (brand) cannot surface in HTTP `extra`. It stays integral in
  // the raw response (asserted below); the MQTT side has no slots parent, so
  // the extras test proves discovery there.
  assert.deepEqual(result.http.reconciliation.extra, []);
  // The manual slot written with the sku-capable setInfo is visible in HTTP too.
  const httpSlot = result.http.response.data[0].slots[1];
  assert.equal(httpSlot.sku, "MY-SKU-123");
  assert.equal(httpSlot.edit_status, 1);
  assert.equal(httpSlot.brand, "AC", "catalog-external field preserved in the raw response");
  // Inventory digest merges both carriers.
  assert.deepEqual(result.inventory.carriers, ["mqtt", "http"]);
  assert.equal(result.inventory.slots.length, 4, "MQTT slots are the inventory base");
  assert.equal(result.inventory.box.auto_feed, 0);
});

test("ace_raw_report tolerates a silent extfilbox (timeout is a state, not a failure)", async () => {
  const manager = seededManager([
    {
      topic: "anycubic/anycubicCloud/v1/printer/public/20025/<PRINTER_KEY>/multiColorBox/report",
      received_at: new Date().toISOString(),
      data: {
        type: "multiColorBox",
        action: "getInfo",
        code: 200,
        msgid: "d",
        data: structuredClone(SWEEP_MCB_PAYLOAD),
      },
    },
  ]);
  const result = await collectAceRawReport({
    manager,
    cloud: httpCloud(),
    printer: PRINTER,
    timeoutMs: 250,
  });
  const efb = result.sources.extfilbox;
  assert.ok(efb, "extfilbox entry present");
  assert.equal(efb.state, "timeout", "the sweep saw exactly this: acked, device silent");
  assert.equal(efb.report_count, 0);
  assert.equal(result.inventory.extfilbox, null);
  // Both probe actions were attempted (query + reportInfo), matching the sweep.
  assert.ok(efb.attempts.some((a) => a.action === "reportInfo"));
});

test("ace_raw_report publishes only read actions and can skip sources", async () => {
  const manager = seededManager([]);
  const cloud = httpCloud();
  await collectAceRawReport({
    manager,
    cloud,
    printer: PRINTER,
    includeExtfilbox: false,
    timeoutMs: 250,
  });
  const result = await collectAceRawReport({
    manager: seededManager([]),
    cloud,
    printer: PRINTER,
    includeExtfilbox: false,
    timeoutMs: 250,
  });
  assert.equal(result.published_actions, "multiColorBox/getInfo");
  assert.equal(result.sources.extfilbox, undefined);
  assert.ok(result.read_only);
  // Without a printer id the HTTP read is skipped, not failed.
  const noId = await collectAceRawReport({
    manager: seededManager([]),
    cloud,
    printer: { machine_type: "20025", key: "k" },
    timeoutMs: 250,
  });
  assert.equal(noId.http.state, "skipped");
});

test("ace_raw_report requires a connection-manager-like object", async () => {
  await assert.rejects(
    collectAceRawReport({ manager: {}, printer: PRINTER }),
    /requires a CloudConnectionManager/,
  );
});

// ---------------------------------------------------------------------------
// sku-capable ace_set_slot — payload serialization and the confirm gate
// ---------------------------------------------------------------------------

function capturingClient(seen) {
  return {
    publish: (topic, payload, cb) => {
      seen.push({ topic, envelope: JSON.parse(payload) });
      cb(null);
    },
  };
}

test("ace_set_slot serializes sku into the setInfo slot payload", async () => {
  const manager = new CloudConnectionManager({ cloud: {} });
  const seen = [];
  const printer = { machine_type: "20025", key: "<PRINTER_KEY>" };
  await manager.publish(
    printer,
    "ace_set_slot",
    { box_id: 0, slot_index: 2, material_type: "PETG", color: [10, 20, 30], sku: "MY-SKU-123" },
    capturingClient(seen),
  );
  const slot = seen[0].envelope.data.multi_color_box[0].slots[0];
  assert.deepEqual(slot, {
    index: 2,
    type: "PETG",
    color: [10, 20, 30],
    sku: "MY-SKU-123",
  });
  assert.equal(seen[0].envelope.action, "setInfo");
  assert.equal(seen[0].envelope.type, "multiColorBox");

  // Without sku the payload stays the legacy manual shape (no sku key).
  await manager.publish(
    printer,
    "ace_set_slot",
    { box_id: 0, slot_index: 1, material_type: "PLA", color: [1, 2, 3] },
    capturingClient(seen),
  );
  assert.deepEqual(seen[1].envelope.data.multi_color_box[0].slots[0], {
    index: 1,
    type: "PLA",
    color: [1, 2, 3],
  });
  assert.equal("sku" in seen[1].envelope.data.multi_color_box[0].slots[0], false);

  // 20 chars pass (the NFC-tag SKU field width), 21 are refused, not truncated.
  await manager.publish(
    printer,
    "ace_set_slot",
    { slot_index: 0, material_type: "PLA", color: [0, 0, 0], sku: "A".repeat(20) },
    capturingClient(seen),
  );
  assert.equal(seen[2].envelope.data.multi_color_box[0].slots[0].sku.length, 20);
  await assert.rejects(
    manager.publish(
      printer,
      "ace_set_slot",
      { slot_index: 0, material_type: "PLA", color: [0, 0, 0], sku: "A".repeat(21) },
      capturingClient(seen),
    ),
    /20-character/,
  );
});

test("ace_set_slot keeps the confirm gate: nothing is sent without confirm", () => {
  assert.throws(() => assertConfirm("ace_set_slot", {}), /requires confirm: true/);
  assert.throws(() => assertConfirm("ace_set_slot", { confirm: false }), /requires confirm: true/);
  // state class: confirm:true alone is enough (no EXECUTE word).
  assert.doesNotThrow(() => assertConfirm("ace_set_slot", { confirm: true }));
});

test("registerAceTools registers exactly the sku-capable ace_set_slot tool", async () => {
  const registered = new Map();
  const server = {
    registerTool: (name, config, handler) => registered.set(name, { config, handler }),
  };
  registerAceTools(server, z, {
    manager: { cloud: null },
    resolvePrinter: async () => ({}),
  });
  assert.deepEqual([...registered.keys()], ["ace_set_slot"]);
  const config = registered.get("ace_set_slot").config;
  assert.equal(config.annotations.readOnlyHint, false);
  assert.equal(config.annotations.destructiveHint, true);
  assert.ok(/confirm:true/.test(config.description) || /REQUIRES confirm/.test(config.description));
  assert.ok(/20 chars/.test(config.description), "sku limit documented on the tool");
  assert.throws(() => registerAceTools(server, z, {}), /requires manager and resolvePrinter/);
});

test("ace_set_slot handler refuses without confirm before any cloud call", async () => {
  const registered = new Map();
  registerAceTools(
    { registerTool: (name, config, handler) => registered.set(name, { config, handler }) },
    z,
    {
      manager: new CloudConnectionManager({
        cloud: {
          rawApi: async () => {
            throw new Error("network must not be reached");
          },
        },
      }),
      resolvePrinter: async () => {
        throw new Error("printer must not be resolved before confirm");
      },
    },
  );
  const reply = await registered.get("ace_set_slot").handler({
    slot_index: 2,
    material_type: "PETG",
    color: [1, 2, 3],
    sku: "MY-SKU-123",
  });
  assert.equal(reply.isError, true);
  assert.match(reply.content[0].text, /requires confirm: true/);
});

test("ace_set_slot handler sends the sku payload after confirm", async () => {
  const manager = new CloudConnectionManager({
    cloud: {
      xxToken: "test-token",
      login: async () => {},
    },
  });
  manager.acquire = async () => ({
    publish: (topic, payload, cb) => {
      manager.events.push({
        topic: "multiColorBox/report",
        data: {
          type: "multiColorBox",
          msgid: JSON.parse(payload).msgid,
          code: 200,
        },
      });
      cb(null);
    },
  });
  const registered = new Map();
  registerAceTools(
    { registerTool: (name, config, handler) => registered.set(name, { config, handler }) },
    z,
    { manager, resolvePrinter: async () => PRINTER },
  );
  const reply = await registered.get("ace_set_slot").handler({
    slot_index: 2,
    material_type: "PETG",
    color: [10, 20, 30],
    sku: "MY-SKU-123",
    confirm: true,
    reply_timeout_ms: 500,
  });
  assert.equal(reply.isError, undefined);
  assert.equal(reply.structuredContent.ok, true);
  assert.equal(reply.structuredContent.command, "ace_set_slot");
  const slot = reply.structuredContent.sent_data.multi_color_box[0].slots[0];
  assert.equal(slot.sku, "MY-SKU-123");
  assert.equal(reply.structuredContent.reply_state, "correlated_reply");
});
