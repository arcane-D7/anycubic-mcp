import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOUD_ENDPOINTS,
  CONFIRM_WORD,
  CloudEndpointError,
  callEndpoint,
  getEndpoint,
  paramSchemaFor,
  redactSensitive,
  summarizeCatalog,
} from "../scripts/cloud-endpoints.mjs";

class RecordingClient {
  constructor(reply = { code: 1, data: { ok: true } }) {
    this.reply = reply;
    this.calls = [];
  }
  async rawApi(method, path, { params, query } = {}) {
    this.calls.push({ method, path, params, query });
    if (typeof this.reply === "function") return this.reply(method, path, { params, query });
    return this.reply;
  }
}

test("catalog holds exactly 93 unique endpoints with unique ids and paths", () => {
  const summary = summarizeCatalog();
  assert.equal(summary.total, 93);
  assert.equal(CLOUD_ENDPOINTS.length, 93);
  const idSet = new Set(CLOUD_ENDPOINTS.map((e) => e.id));
  assert.equal(idSet.size, 93, "endpoint ids must be unique");
  const pathSet = new Set(CLOUD_ENDPOINTS.map((e) => e.path));
  assert.equal(pathSet.size, 93, "endpoint paths must be unique");
  // The research doc's family table: /v2 20 · /v5 17 · /work 16 · /farm 13 ·
  // /user 12 · /v3 10 · /portal 5.
  assert.deepEqual(summary.byFamily, {
    v2: 20,
    v5: 17,
    work: 16,
    farm: 13,
    user: 12,
    v3: 10,
    portal: 5,
  });
  assert.equal(summary.covered, 23);
  assert.equal(summary.new, 70);
});

test("every endpoint is fully declared: method, safety, purpose, offset, param evidence", () => {
  for (const e of CLOUD_ENDPOINTS) {
    assert.ok(["GET", "POST"].includes(e.method), `${e.id} method`);
    assert.ok(
      ["read", "write", "destructive"].includes(e.safety),
      `${e.id} must declare a safety class`,
    );
    assert.ok(typeof e.purpose === "string" && e.purpose.length > 10, `${e.id} needs a purpose`);
    assert.ok(
      e.offset === null || (Number.isInteger(e.offset) && e.offset >= 6549640),
      `${e.id} offset must be null or a plausible cloud_sdk_cpp.dll offset`,
    );
    assert.ok(
      ["repo-validated", "research-doc", "inferred"].includes(e.methodEvidence),
      `${e.id} needs method evidence`,
    );
    for (const p of e.params) {
      assert.ok(p.name && p.evidence, `param ${e.id}.${p.name} needs name+evidence`);
    }
  }
});

test("doc anchor offsets survive transcription", () => {
  assert.equal(getEndpoint("farm_file_info").offset, 6551696);
  assert.equal(getEndpoint("user_profile_userInfo").offset, 6551184);
  assert.equal(getEndpoint("v3_material_getTypeNameAndSkuListByVerNum").offset, 6551328);
  assert.equal(getEndpoint("v2_printer_getExternalShelves").offset, 6551216);
  assert.equal(getEndpoint("v5_machine_material_addUserColorGroup").offset, 6552144);
  assert.equal(getEndpoint("v5_machine_material_deleteUserColorGroup").offset, 6552240);
});

test("the filament-domain endpoints carry the doc's contracts", () => {
  const catalogue = getEndpoint("v3_material_getTypeNameAndSkuListByVerNum");
  assert.equal(catalogue.safety, "read");
  assert.ok(catalogue.params.some((p) => p.name === "ver_num"));

  const add = getEndpoint("v5_machine_material_addUserColorGroup");
  assert.equal(add.safety, "write");
  const declared = new Set(add.params.map((p) => p.name));
  for (const name of ["color_group", "slots", "slot_index"]) assert.ok(declared.has(name), name);
  for (const name of ["material_type", "material_tid", "material_name", "material_unit"]) {
    assert.ok(declared.has(name), name);
  }
  assert.ok(add.notes.some((n) => n.includes("not from a live exchange")));

  const edit = getEndpoint("v5_machine_material_editUserColorGroup");
  assert.equal(edit.safety, "write");
  assert.ok(edit.params.some((p) => p.name === "group_id"));

  const del = getEndpoint("v5_machine_material_deleteUserColorGroup");
  assert.equal(del.safety, "destructive");

  const shelves = getEndpoint("v2_printer_getExternalShelves");
  assert.equal(shelves.safety, "read");
  assert.ok(shelves.notes.some((n) => n.includes("external_shelves")));

  const properties = getEndpoint("v5_printer_properties_query");
  assert.equal(properties.safety, "read");

  const farmTasks = getEndpoint("farm_printer_createBulkTask");
  const names = farmTasks.params.map((p) => p.name);
  assert.deepEqual(names, ["filePath", "taskType"]);
});

test("read endpoints are callable without confirmation and reach the client as query", async () => {
  const client = new RecordingClient({ code: 1, data: { count: 3 } });
  const result = await callEndpoint(client, "v2_message_getMessageCount", {});
  assert.equal(client.calls.length, 1);
  assert.deepEqual(
    { method: client.calls[0].method, path: client.calls[0].path, params: client.calls[0].params },
    { method: "GET", path: "/v2/message/getMessageCount", params: undefined },
  );
  assert.equal(result.endpoint, "v2_message_getMessageCount");
  assert.equal(result.safety, "read");
  assert.deepEqual(result.data, { code: 1, data: { count: 3 } });
});

test("read params are validated: a wrong type is refused before the client is touched", async () => {
  const client = new RecordingClient();
  await assert.rejects(
    callEndpoint(client, "v3_material_getTypeNameAndSkuListByVerNum", { ver_num: "latest" }),
    (error) => {
      assert.ok(error instanceof CloudEndpointError);
      assert.equal(error.code, "INVALID_PARAMS");
      return true;
    },
  );
  assert.equal(client.calls.length, 0, "an invalid call must never reach the transport");
});

test("write endpoints are refused without confirm:true + confirm_word EXECUTE", async () => {
  const client = new RecordingClient();
  for (const [id, params] of [
    ["v5_machine_material_addUserColorGroup", { material_type: "PLA" }],
    ["v5_machine_material_addUserColorGroup", { confirm: true, confirm_word: "yes" }],
    ["v5_machine_material_addUserColorGroup", { confirm: false, confirm_word: CONFIRM_WORD }],
  ]) {
    await assert.rejects(callEndpoint(client, id, params), (error) => {
      assert.ok(error instanceof CloudEndpointError);
      assert.equal(error.code, "CONFIRMATION_REQUIRED");
      assert.equal(error.details.safety, "write");
      assert.equal(error.details.expected_confirm_word, "EXECUTE");
      return true;
    });
  }
  assert.equal(client.calls.length, 0, "a refused call must never reach the transport");
});

test("destructive endpoints are refused without the full confirmation", async () => {
  const client = new RecordingClient();
  for (const id of [
    "v5_machine_material_deleteUserColorGroup",
    "farm_message_bulkDelete",
    "work_index_delFiles",
  ]) {
    await assert.rejects(callEndpoint(client, id, { group_id: 1 }), (error) => {
      assert.equal(error.code, "CONFIRMATION_REQUIRED");
      assert.equal(error.details.safety, "destructive");
      return true;
    });
  }
  assert.equal(client.calls.length, 0);
});

test("confirmed write passes through with the meta fields stripped from the wire", async () => {
  const client = new RecordingClient();
  const result = await callEndpoint(client, "v5_machine_material_addUserColorGroup", {
    confirm: true,
    confirm_word: "EXECUTE",
    material_type: "PLA",
    material_name: "My spool",
    color_group: { color: [212, 185, 150, 255] },
  });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].method, "POST");
  assert.equal(client.calls[0].path, "/v5/machine_material/addUserColorGroup");
  const body = client.calls[0].params;
  assert.equal(body.material_type, "PLA");
  assert.ok(!("confirm" in body), "confirm must not reach the wire");
  assert.ok(!("confirm_word" in body), "confirm_word must not reach the wire");
  assert.equal(result.safety, "write");
});

test("an unknown endpoint id is refused with a typed error", async () => {
  const client = new RecordingClient();
  await assert.rejects(callEndpoint(client, "v2_printer_launchMissiles", {}), (error) => {
    assert.equal(error.code, "UNKNOWN_ENDPOINT");
    assert.ok(error.message.includes("93"));
    return true;
  });
  assert.equal(client.calls.length, 0);
});

test("a client without rawApi is refused with a typed error", async () => {
  await assert.rejects(callEndpoint({}, "farm_group_list", {}), (error) => {
    assert.equal(error.code, "INVALID_CLIENT");
    return true;
  });
});

test("injectable client proves the flow: read, then confirmed material write", async () => {
  const client = new RecordingClient();
  const read = await callEndpoint(client, "v3_material_getTypeNameAndSkuListByVerNum", {
    ver_num: 12,
  });
  assert.equal(read.data.code, 1);
  const write = await callEndpoint(client, "v5_machine_material_editUserColorGroup", {
    confirm: true,
    confirm_word: "EXECUTE",
    group_id: 7,
    material_type: "PETG",
  });
  assert.equal(write.endpoint, "v5_machine_material_editUserColorGroup");
  assert.deepEqual(client.calls[0].query, { ver_num: 12 });
  assert.equal(client.calls[1].params.group_id, 7);
  assert.equal(client.calls.length, 2);
});

test("credential-shaped keys are redacted from every response", async () => {
  const client = new RecordingClient({
    code: 1,
    data: {
      access_token: "eyJ.secret.value",
      refresh_token: "other",
      nested: { password: "hunter2", nickname: "keep me" },
      signed_urls: ["https://bucket/..."],
    },
  });
  const result = await callEndpoint(client, "farm_group_list", {});
  assert.equal(JSON.stringify(result).includes("eyJ"), false, "token value must not leak");
  assert.equal(result.data.data.access_token, "[redacted]");
  assert.equal(result.data.data.refresh_token, "[redacted]");
  assert.equal(result.data.data.nested.password, "[redacted]");
  assert.equal(result.data.data.nested.nickname, "keep me");
  assert.equal(result.data.data.signed_urls[0], "https://bucket/...");
});

test("redactSensitive handles arrays and cycles safely", () => {
  const cyclic = { name: "a" };
  cyclic.self = cyclic;
  assert.equal(redactSensitive(cyclic).self, "[circular]");
  assert.deepEqual(redactSensitive([{ api_key: "k" }]), [{ api_key: "[redacted]" }]);
});

test("param schemas are loose: undeclared keys pass through", () => {
  const entry = getEndpoint("farm_group_list");
  const parsed = paramSchemaFor(entry).parse({ anything: "goes" });
  assert.equal(parsed.anything, "goes");
});
