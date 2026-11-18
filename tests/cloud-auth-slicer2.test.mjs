/**
 * Cloud auth lane for Anycubic Slicer Next 2.0.0.3+ — scripts/anycubic-cloud.mjs.
 *
 * The protocol change (docs/research/cloud-auth-2026-11-18.md):
 *  - POST /v3/public/loginWithAccessToken answers `code 0, "Failed to get user
 *    info"` for every token. The account JWT is accepted DIRECTLY as XX-Token
 *    by the /v2/* endpoints, so login() keeps the exchange first (older
 *    slicers still work that way) and falls back to the JWT when the server
 *    refuses it at the application level.
 *  - /work/printer/getPrinters is no longer served; printers come from
 *    GET /v2/printer/printersStatus, with the old route as a fallback.
 *
 * Everything here is fixture-based: a fake fetch replaces the network, and no
 * token in this file is real (they are synthetic HS512-shaped JWTs).
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AnycubicCloud,
  extractPrinterEntries,
  mapPrinterEntry,
  parseTokenRecordText,
  readTokenRecordFile,
  serializeTokenRecord,
} from "../scripts/anycubic-cloud.mjs";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function makeJwt(claims = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "HS512", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      user_id: 4242,
      sub: "00000000-0000-0000-0000-000000000000",
      mode: "prod",
      exp: Math.floor(Date.now() / 1000) + 86_400,
      ...claims,
    }),
  ).toString("base64url");
  return `${header}.${payload}.synthetic-signature`;
}

const ACCOUNT_JWT = makeJwt();
const SESSION_TOKEN = "session-token-from-workbench";

const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

function makeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const href = String(url);
    const call = {
      url: href,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body,
    };
    calls.push(call);
    for (const [needle, handler] of Object.entries(routes)) {
      if (href.includes(needle)) {
        return typeof handler === "function" ? handler(call) : handler;
      }
    }
    throw new Error(`unexpected request ${href}`);
  };
  return { impl, calls, urls: () => calls.map((c) => c.url) };
}

function newCloud(fetchImpl, log = () => {}) {
  return new AnycubicCloud({ access_token: ACCOUNT_JWT, fetchImpl, log });
}

/* ------------------------------------------------------------------ */
/* 1. login keeps the legacy session exchange first                    */
/* ------------------------------------------------------------------ */

test("login keeps the workbench session exchange first for older slicers", async () => {
  const net = makeFetch({
    "/v3/public/loginWithAccessToken": reply({ code: 1, data: { token: SESSION_TOKEN } }),
    "/user/profile/userInfo": reply({
      code: 1,
      data: { id: 4242, user_email: "user@example.invalid" },
    }),
  });
  const logs = [];
  const cloud = newCloud(net.impl, (line) => logs.push(line));

  const result = await cloud.login();

  assert.equal(result.authSource, "session");
  assert.equal(cloud.xxToken, SESSION_TOKEN);
  assert.equal(cloud.user.id, 4242);
  assert.equal(net.calls[0].url.includes("/v3/public/loginWithAccessToken"), true);
  assert.equal(
    net.calls[0].body.includes(ACCOUNT_JWT),
    true,
    "the exchange still posts the account JWT — the legacy path is unchanged",
  );
  assert.equal(
    logs.some((line) => /account access_token directly/.test(line)),
    false,
  );
});

/* ------------------------------------------------------------------ */
/* 2. 2.0.0.3: the exchange is refused -> the account JWT is XX-Token  */
/* ------------------------------------------------------------------ */

test("login falls back to the account JWT when the exchange answers code 0", async () => {
  const net = makeFetch({
    // The exact 2.0.0.3 answer: HTTP 200, code 0, no session token.
    "/v3/public/loginWithAccessToken": reply({ code: 0, msg: "Failed to get user info" }),
    // The workbench profile route refuses the raw JWT too.
    "/user/profile/userInfo": reply({ code: 10001, msg: "login information has expired" }),
  });
  const logs = [];
  const cloud = newCloud(net.impl, (line) => logs.push(line));

  const result = await cloud.login();

  assert.equal(result.authSource, "account_jwt");
  assert.equal(cloud.xxToken, ACCOUNT_JWT, "the account JWT becomes the XX-Token");
  assert.equal(cloud.authSource, "account_jwt");
  assert.match(cloud.authReason, /Failed to get user info/);

  const reasonLine = logs.find((line) => /account access_token directly as XX-Token/.test(line));
  assert.ok(reasonLine, "the fallback must be named in a log line");
  assert.match(reasonLine, /Slicer Next >= 2\.0\.0\.3/);
  assert.match(reasonLine, /Failed to get user info/, "the log line carries the server's reason");

  // Identity survives without the profile route: it comes from the JWT claims.
  assert.equal(cloud.user.id, 4242);
  assert.ok(logs.some((line) => /identity taken from JWT claims/.test(line)));
});

test("the fallback token is what /v2 printer calls send as XX-Token", async () => {
  const net = makeFetch({
    "/v3/public/loginWithAccessToken": reply({ code: 0, msg: "Failed to get user info" }),
    "/user/profile/userInfo": reply({ code: 0, msg: "Failed to get user info" }),
    "/v2/printer/printersStatus": reply({
      code: 1,
      data: [{ id: 7, key: "PRINTER_KEY_PLACEHOLDER", machine_type: "Kobra S1", device_status: 1 }],
    }),
  });
  const cloud = newCloud(net.impl);
  await cloud.login();
  await cloud.listPrinters();

  const printerCall = net.calls.find((c) => c.url.includes("/v2/printer/printersStatus"));
  assert.ok(printerCall);
  assert.equal(printerCall.headers["XX-Token"], ACCOUNT_JWT);
});

/* ------------------------------------------------------------------ */
/* 3. only an application-level refusal is a fallback signal           */
/* ------------------------------------------------------------------ */

test("login keeps failing loudly on a transport or HTTP error — no silent downgrade", async () => {
  const net = makeFetch({
    "/v3/public/loginWithAccessToken": reply({ code: 500, msg: "gateway down" }, 502),
  });
  const logs = [];
  const cloud = newCloud(net.impl, (line) => logs.push(line));

  await assert.rejects(cloud.login(), /HTTP 502/);
  assert.equal(cloud.xxToken, null);
  assert.equal(
    logs.some((line) => /account access_token directly/.test(line)),
    false,
  );
});

/* ------------------------------------------------------------------ */
/* 4. printer listing: v2 first, mapped to the PrinterInfo contract     */
/* ------------------------------------------------------------------ */

test("listPrinters prefers /v2/printer/printersStatus and maps the contract", async () => {
  const net = makeFetch({
    "/v3/public/loginWithAccessToken": reply({ code: 0, msg: "Failed to get user info" }),
    "/user/profile/userInfo": reply({ code: 0, msg: "Failed to get user info" }),
    "/v2/printer/printersStatus": reply({
      code: 1,
      data: {
        list: [
          {
            id: 7,
            key: "PRINTER_KEY_PLACEHOLDER",
            machine_type: "Kobra S1",
            device_status: 1,
            name: "Workshop printer",
            model: "Kobra S1",
          },
          { printer_id: 8, dev_id: "SECOND_KEY_PLACEHOLDER", deviceStatus: 0 },
        ],
      },
    }),
    "/work/printer/getPrinters": reply({ code: 1, data: [] }),
  });
  const cloud = newCloud(net.impl);
  await cloud.login();
  const printers = await cloud.listPrinters();

  assert.deepEqual(printers, [
    {
      id: 7,
      key: "PRINTER_KEY_PLACEHOLDER",
      machine_type: "Kobra S1",
      device_status: 1,
      name: "Workshop printer",
      model: "Kobra S1",
      online: true,
    },
    {
      // Only the fields either payload documents are mapped — nothing invented.
      id: 8,
      key: "SECOND_KEY_PLACEHOLDER",
      machine_type: "",
      device_status: 0,
      name: null,
      model: null,
      online: false,
    },
  ]);
  assert.equal(
    net.urls().filter((u) => u.includes("/work/printer/getPrinters")).length,
    0,
    "the old route must not be called when v2 answers",
  );
});

test("listPrinters accepts a bare data array (the other v2 envelope)", async () => {
  const net = makeFetch({
    "/v2/printer/printersStatus": reply({
      data: [{ id: 9, key: "THIRD_KEY_PLACEHOLDER", machine_type: "Kobra 3", status: 1 }],
    }),
  });
  const cloud = newCloud(net.impl);
  const printers = await cloud.listPrinters();

  assert.equal(printers.length, 1);
  assert.equal(printers[0].id, 9);
  assert.equal(printers[0].key, "THIRD_KEY_PLACEHOLDER");
  assert.equal(printers[0].machine_type, "Kobra 3");
  assert.equal(printers[0].online, true);
});

test("listPrinters keeps the old /work/printer/getPrinters when v2 fails", async () => {
  const net = makeFetch({
    "/v2/printer/printersStatus": reply({ code: 404, msg: "No route" }, 404),
    "/work/printer/getPrinters": reply({
      code: 1,
      data: {
        list: [
          { id: 7, key: "PRINTER_KEY_PLACEHOLDER", machine_type: "Kobra S1", device_status: 1 },
        ],
      },
    }),
  });
  const logs = [];
  const cloud = newCloud(net.impl, (line) => logs.push(line));
  const printers = await cloud.listPrinters();

  assert.equal(printers.length, 1);
  assert.equal(printers[0].id, 7);
  assert.deepEqual(
    net.urls().map((u) => (u.includes("printersStatus") ? "v2" : "legacy")),
    ["v2", "legacy"],
    "v2 is tried first, the old route is the fallback",
  );
  assert.ok(logs.some((line) => /falling back to \/work\/printer\/getPrinters/.test(line)));
});

test("an empty v2 list is a success — it does not trigger the old route", async () => {
  const net = makeFetch({
    "/v2/printer/printersStatus": reply({ code: 1, data: [] }),
    "/work/printer/getPrinters": reply({ code: 1, data: [{ id: 99 }] }),
  });
  const cloud = newCloud(net.impl);
  const printers = await cloud.listPrinters();

  assert.deepEqual(printers, []);
  assert.equal(net.urls().filter((u) => u.includes("/work/")).length, 0);
});

/* ------------------------------------------------------------------ */
/* 5. payload helpers behave on both shapes                            */
/* ------------------------------------------------------------------ */

test("extractPrinterEntries understands data[] and data.list only", () => {
  assert.deepEqual(extractPrinterEntries([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(extractPrinterEntries({ list: [{ id: 2 }] }), [{ id: 2 }]);
  assert.equal(extractPrinterEntries({ printers: [{ id: 3 }] }), null);
  assert.equal(extractPrinterEntries(null), null);
});

test("mapPrinterEntry drops non-objects and defaults unknown fields to empty", () => {
  assert.equal(mapPrinterEntry(null), null);
  assert.equal(mapPrinterEntry("printer"), null);
  assert.deepEqual(mapPrinterEntry({}), {
    id: 0,
    key: "",
    machine_type: "",
    device_status: 0,
    name: null,
    model: null,
    online: false,
  });
});

/* ------------------------------------------------------------------ */
/* 6. DPAPI token store: written WITHOUT a BOM, repaired on read       */
/* ------------------------------------------------------------------ */

test("token records serialise without a BOM and round-trip through JSON.parse", () => {
  const text = serializeTokenRecord({ encrypted: "ciphertext", sub: "sub-placeholder" });
  assert.notEqual(text.charCodeAt(0), 0xfeff, "a BOM breaks the store's JSON.parse");
  assert.equal(text.startsWith("{"), true);
  assert.deepEqual(JSON.parse(text), { encrypted: "ciphertext", sub: "sub-placeholder" });
});

test("parseTokenRecordText names a BOM instead of throwing on it", () => {
  const clean = parseTokenRecordText('{"encrypted":"x"}');
  assert.deepEqual(clean, { record: { encrypted: "x" }, bom: false });
  const bommed = parseTokenRecordText('\uFEFF{"encrypted":"x"}');
  assert.deepEqual(bommed, { record: { encrypted: "x" }, bom: true });
  assert.throws(() => parseTokenRecordText("{not json"), SyntaxError);
});

test("a BOM'd cloud-token.json is repaired on read, not silently ignored", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "anycubic-token-bom-"));
  const file = path.join(dir, "cloud-token.json");
  try {
    writeFileSync(file, '\uFEFF{"encrypted":"ciphertext","sub":"sub-placeholder"}');
    const first = await readTokenRecordFile(file);

    assert.equal(first.repaired, true);
    assert.equal(first.record.encrypted, "ciphertext");
    const rewritten = readFileSync(file, "utf8");
    assert.notEqual(rewritten.charCodeAt(0), 0xfeff, "the store must be rewritten BOM-free");
    assert.deepEqual(JSON.parse(rewritten), { encrypted: "ciphertext", sub: "sub-placeholder" });

    const second = await readTokenRecordFile(file);
    assert.equal(second.repaired, false, "the repair is idempotent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
