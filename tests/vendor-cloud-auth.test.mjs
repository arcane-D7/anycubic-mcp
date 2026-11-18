/**
 * The SHIPPED bundle carries the Slicer Next 2.0.0.3 cloud-auth fix.
 *
 * `vendor/server.mjs` is the versioned base `scripts/build.mjs` copies to
 * `dist/server.mjs`; it is a frozen esbuild-style bundle that registers 115 MCP
 * tools and connects a stdio transport on import, so it cannot be imported as a
 * library. To prove the fix is IN THE BUNDLE (not only in the hand-written
 * client under scripts/), this test imports the bundle's own `src/cloud.ts` and
 * `src/token-store.ts` sections as a module and drives them with fixtures.
 *
 * The section slices are delimited by the bundle's `// src/<file>.ts` markers.
 * If a refactor moves those markers the test fails here, loudly — that is the
 * point: the assertions below must read the same code `dist/` runs.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(root, "vendor", "server.mjs");
const bundle = readFileSync(bundlePath, "utf8");

const SECTION_START = "// src/cloud.ts";
const SECTION_END = "// src/token-watcher.ts";

let cached;

/** Import the bundle's cloud + token-store sections as an ES module. */
async function cloudSections() {
  if (cached) return cached;
  const start = bundle.indexOf(SECTION_START);
  const end = bundle.indexOf(SECTION_END);
  assert.ok(
    start >= 0 && end > start,
    `vendor/server.mjs no longer carries the '${SECTION_START}' → '${SECTION_END}' sections`,
  );
  const source =
    bundle.slice(start, end) +
    "\nexport { loginWithAccessToken, getPrinters, TokenStore, tokenRecordText, decodeJwtPayload };\n";
  cached = await import(
    `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`
  );
  return cached;
}

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

const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function makeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const href = String(url);
    calls.push({ url: href, method: init?.method ?? "GET", headers: init?.headers ?? {} });
    for (const [needle, handler] of Object.entries(routes)) {
      if (href.includes(needle)) return typeof handler === "function" ? handler(href) : handler;
    }
    throw new Error(`unexpected request ${href}`);
  };
  impl.calls = calls;
  return impl;
}

async function withConsoleError(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

/* ------------------------------------------------------------------ */
/* 1. login: legacy exchange first, account JWT as the 2.0.0.3 fallback */
/* ------------------------------------------------------------------ */

test("bundle loginWithAccessToken keeps the session exchange first", async () => {
  const { loginWithAccessToken } = await cloudSections();
  const fetchImpl = makeFetch({
    "/v3/public/loginWithAccessToken": reply({
      code: 1,
      data: { token: "session-token", user_id: 4242 },
    }),
  });
  const { result, lines } = await withConsoleError(() =>
    loginWithAccessToken(ACCOUNT_JWT, { fetchImpl, region: "en" }),
  );

  assert.equal(result.authSource, "session");
  assert.equal(result.token, "session-token");
  assert.equal(result.userId, 4242);
  assert.equal(lines.length, 0, "the legacy path is silent");
});

test("bundle loginWithAccessToken falls back to the account JWT on code 0 and names it", async () => {
  const { loginWithAccessToken } = await cloudSections();
  const fetchImpl = makeFetch({
    "/v3/public/loginWithAccessToken": reply({ code: 0, msg: "Failed to get user info" }),
  });
  const { result, lines } = await withConsoleError(() =>
    loginWithAccessToken(ACCOUNT_JWT, { fetchImpl, region: "en" }),
  );

  assert.equal(result.authSource, "account_jwt");
  assert.equal(result.token, ACCOUNT_JWT, "the account JWT itself becomes XX-Token");
  assert.match(result.authReason, /Failed to get user info/);
  assert.equal(result.userId, 4242, "identity comes from the JWT's own claims");
  const line = lines.find((l) => /account access_token directly as XX-Token/.test(l));
  assert.ok(line, "the reason must be logged, naming the fallback");
  assert.match(line, /Slicer Next >= 2\.0\.0\.3/);
  assert.match(line, /\[cloud\]/);
});

test("bundle loginWithAccessToken still fails on HTTP and transport errors", async () => {
  const { loginWithAccessToken } = await cloudSections();
  const httpFailure = makeFetch({
    "/v3/public/loginWithAccessToken": reply({ code: 10001, msg: "expired" }, 401),
  });
  await assert.rejects(
    loginWithAccessToken(ACCOUNT_JWT, { fetchImpl: httpFailure }),
    /loginWithAccessToken failed: 401/,
  );

  const transportFailure = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    loginWithAccessToken(ACCOUNT_JWT, { fetchImpl: transportFailure }),
    /fetch failed/,
  );
});

/* ------------------------------------------------------------------ */
/* 2. printer listing: /v2/printer/printersStatus then the old route    */
/* ------------------------------------------------------------------ */

test("bundle getPrinters reads /v2/printer/printersStatus into the PrinterInfo contract", async () => {
  const { getPrinters } = await cloudSections();
  const fetchImpl = makeFetch({
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
  });
  const devices = await getPrinters({ token: ACCOUNT_JWT, region: "en" }, { fetchImpl });

  assert.deepEqual(devices, [
    {
      id: 7,
      key: "PRINTER_KEY_PLACEHOLDER",
      machineType: "Kobra S1",
      deviceStatus: 1,
      name: "Workshop printer",
      model: "Kobra S1",
      online: true,
    },
    {
      id: 8,
      key: "SECOND_KEY_PLACEHOLDER",
      machineType: "",
      deviceStatus: 0,
      name: undefined,
      model: undefined,
      online: false,
    },
  ]);
  assert.equal(fetchImpl.calls.length, 1);
  assert.equal(
    fetchImpl.calls[0].headers["XX-Token"],
    ACCOUNT_JWT,
    "the v2 route is called with the account JWT as XX-Token",
  );
});

test("bundle getPrinters keeps /work/printer/getPrinters as the fallback", async () => {
  const { getPrinters } = await cloudSections();
  const fetchImpl = makeFetch({
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
  const { result: devices, lines } = await withConsoleError(() =>
    getPrinters({ token: ACCOUNT_JWT, region: "en" }, { fetchImpl }),
  );

  assert.equal(devices.length, 1);
  assert.equal(devices[0].id, 7);
  assert.equal(devices[0].machineType, "Kobra S1");
  assert.deepEqual(
    fetchImpl.calls.map((c) => (c.url.includes("printersStatus") ? "v2" : "legacy")),
    ["v2", "legacy"],
  );
  assert.ok(lines.some((l) => /falling back to \/work\/printer\/getPrinters/.test(l)));
});

test("bundle getPrinters treats an empty v2 list as success", async () => {
  const { getPrinters } = await cloudSections();
  const fetchImpl = makeFetch({
    "/v2/printer/printersStatus": reply({ code: 1, data: [] }),
  });
  const devices = await getPrinters({ token: ACCOUNT_JWT, region: "en" }, { fetchImpl });
  assert.deepEqual(devices, []);
  assert.equal(fetchImpl.calls.length, 1);
});

/* ------------------------------------------------------------------ */
/* 3. the DPAPI token store                                            */
/* ------------------------------------------------------------------ */

test("bundle token store writes a BOM-free record", async () => {
  const { tokenRecordText } = await cloudSections();
  const text = tokenRecordText({ encrypted: "ciphertext", sub: "sub-placeholder" });
  assert.notEqual(text.charCodeAt(0), 0xfeff);
  assert.deepEqual(JSON.parse(text), { encrypted: "ciphertext", sub: "sub-placeholder" });
  // The save path must go through that serialiser, never JSON.stringify direct.
  assert.equal(
    /writeFile\(tmp, JSON\.stringify\(record, null, 2\)/.test(bundle),
    false,
    "TokenStore.save must serialise through tokenRecordText",
  );
});

test("bundle token store repairs a BOM'd cloud-token.json on load", async () => {
  const { TokenStore } = await cloudSections();
  const dir = mkdtempSync(path.join(tmpdir(), "anycubic-vendor-token-bom-"));
  const file = path.join(dir, "cloud-token.json");
  try {
    writeFileSync(file, '\uFEFF{"encrypted":"ciphertext","sub":"sub-placeholder"}');
    const store = new TokenStore(dir, path.join(dir, "unused-token-crypt.ps1"));

    const { result: record, lines } = await withConsoleError(() => store.load());
    assert.equal(record.encrypted, "ciphertext");
    assert.ok(lines.some((l) => /carried a UTF-8 BOM; rewritten without it/.test(l)));

    const rewritten = readFileSync(file, "utf8");
    assert.notEqual(rewritten.charCodeAt(0), 0xfeff, "the repaired file must be BOM-free");
    assert.deepEqual(JSON.parse(rewritten), { encrypted: "ciphertext", sub: "sub-placeholder" });

    const { result: again, lines: secondLines } = await withConsoleError(() => store.load());
    assert.equal(again.encrypted, "ciphertext");
    assert.equal(secondLines.length, 0, "the repair happens once");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bundle token store still reports a corrupt file as no token", async () => {
  const { TokenStore } = await cloudSections();
  const dir = mkdtempSync(path.join(tmpdir(), "anycubic-vendor-token-corrupt-"));
  try {
    writeFileSync(path.join(dir, "cloud-token.json"), "{not json");
    const store = new TokenStore(dir, path.join(dir, "unused-token-crypt.ps1"));
    assert.equal(await store.load(), null);
    writeFileSync(path.join(dir, "cloud-token.json"), JSON.stringify({ capturedAt: "x" }));
    assert.equal(await store.load(), null, "a record without `encrypted` is not a token");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
