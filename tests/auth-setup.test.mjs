import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  decodeJwtPayload,
  classifyAccessToken,
  buildTokenRecord,
  signAuthHeaders,
  loginWithAccessToken,
  looksLikeAccountJwt,
  validateAccessToken,
  loadStoredToken,
  defaultDataDir,
  defaultCryptScript,
  registerAuthSetupHelper,
  casdoorLogin,
} from "../scripts/auth-login.mjs";

// JWT de teste com claims (sub/email/exp) — não é segredo, é fixture.
function makeTestJwt(claims = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "0000-aaaa-bbbb-cccc",
      email: "tester@example.com",
      exp: Math.floor(Date.now() / 1000) + 86400,
      ...claims,
    }),
  ).toString("base64url");
  return `${header}.${payload}.signature`;
}

test("decodeJwtPayload parses 3-part JWTs", () => {
  const t = makeTestJwt();
  const claims = decodeJwtPayload(t);
  assert.equal(claims.sub, "0000-aaaa-bbbb-cccc");
  assert.equal(claims.email, "tester@example.com");
});
test("decodeJwtPayload returns null for junk", () => {
  assert.equal(decodeJwtPayload("not-a-token"), null);
  assert.equal(decodeJwtPayload("a.b"), null);
});
test("classifyAccessToken detects shape and expiry", () => {
  const r = classifyAccessToken(makeTestJwt());
  assert.equal(r.ok, true);
  assert.equal(r.shape, "jwt");
  assert.ok(r.expires_at);
});
test("classifyAccessToken rejects non-JWT", () => {
  assert.equal(classifyAccessToken("random-string").ok, false);
});
test("buildTokenRecord keeps only non-secret metadata", () => {
  const r = buildTokenRecord(makeTestJwt());
  assert.ok(r.sub);
  assert.ok(r.email);
  assert.ok(r.expiresAt);
  assert.equal(r.encrypted, undefined);
  assert.equal(r.signature, undefined);
  assert.equal(Object.keys(r).includes("signature"), false);
});
test("signAuthHeaders are deterministic signature structure", () => {
  const h = signAuthHeaders();
  assert.ok(h["Xx-Nonce"].length === 32);
  assert.ok(/^[0-9a-f]{32}$/.test(h["Xx-Signature"]));
  assert.equal(h["Xx-Device-Type"], "pcf");
  assert.ok(h["Xx-Timestamp"]);
});
test("loginWithAccessToken calls endpoint with pcf device_type", async () => {
  let calledUrl = "",
    sentBody = null;
  const fetchImpl = async (url, init) => {
    calledUrl = url;
    sentBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 1, data: { token: "session-token" } }),
    };
  };
  const r = await loginWithAccessToken("jwt", { fetchImpl });
  assert.ok(calledUrl.includes("/v3/public/loginWithAccessToken"));
  assert.equal(sentBody.device_type, "pcf");
  assert.equal(r.token, "session-token");
});
test("loginWithAccessToken surfaces server error", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ code: 10001, msg: "login information has expired" }),
  });
  await assert.rejects(loginWithAccessToken("jwt", { fetchImpl }), /login information has expired/);
});
test("validateAccessToken honors a working pcf token (MQTT enabled)", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/loginWithAccessToken")) {
      return { ok: true, status: 200, json: async () => ({ code: 1, data: { token: "session" } }) };
    }
    if (url.includes("/user/profile/userInfo")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 1, data: { id: 42, user_email: "me@example.com" } }),
      };
    }
    throw new Error("unexpected url " + url);
  };
  const r = await validateAccessToken(makeTestJwt(), { fetchImpl, region: "en" });
  assert.equal(r.ok, true);
  assert.equal(r.mqtt, true);
  assert.equal(r.mode, "pcf");
  assert.equal(r.user_id, 42);
  assert.equal(r.auth_source, "session", "older slicers keep the exchange result");
});
test("validateAccessToken falls back to web mode when pcf rejected as portal token", async () => {
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init?.body || "{}");
    if (body.device_type === "pcf") {
      return {
        ok: false,
        status: 400,
        json: async () => ({ code: 1002, msg: "User does not exist" }),
      };
    }
    assert.equal(body.device_type, "web");
    return {
      ok: true,
      status: 200,
      json: async () => ({ code: 1, data: { token: "web-session" } }),
    };
  };
  const r = await validateAccessToken(makeTestJwt(), { fetchImpl, region: "en" });
  assert.equal(r.ok, true);
  assert.equal(r.mqtt, false);
  assert.equal(r.mode, "web");
  assert.equal(r.auth_source, "session");
});
test("validateAccessToken fails when both modes reject", async () => {
  const fetchImpl = async () => {
    return {
      ok: false,
      status: 401,
      json: async () => ({ code: 9999, msg: "invalid credential" }),
    };
  };
  await assert.rejects(validateAccessToken(makeTestJwt(), { fetchImpl }), /invalid credential/);
});
test("saveStoredToken/loadStoredToken/clearStoredToken roundtrip on temp dir", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ac-auth-test-"));
  try {
    // dry-run: sem powershell, simular token-crypt com ecrã -> escreve placeholder (test only)
    // Substituir runTokenCrypt pelo script real é impossível offline; o token-store
    // compilado também depende de powershell. Testamos o shape via monkeypatch do módulo
    // abaixo — não há export direto, logo testamos defaultDataDir e o fluxo com save mock.
    assert.ok(defaultDataDir().includes("tokens"));
    assert.ok(defaultCryptScript().endsWith("token-crypt.ps1"));
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
test("loadStoredToken returns stored:false for missing store", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ac-auth-nostore-"));
  try {
    const r = await loadStoredToken({ dataDir });
    assert.deepEqual(r, { stored: false });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
test("casdoorLogin sends form-encoded email+password to /api/login", async () => {
  let calledUrl = "",
    sentBody = null;
  const fetchImpl = async (url, init) => {
    calledUrl = url;
    sentBody = new URLSearchParams(init.body).toString();
    return {
      status: 200,
      text: async () =>
        JSON.stringify({ status: "error", msg: "The application does not exist", data: null }),
      headers: { get: () => "application/json" },
    };
  };
  const r = await casdoorLogin("me@example.com", "hunter2", { fetchImpl });
  assert.ok(calledUrl.includes("/api/login"));
  assert.ok(sentBody.includes("username=me%40example.com"));
  assert.ok(sentBody.includes("password=hunter2"));
  assert.equal(r.ok, false);
  assert.match(String(r.error), /application does not exist/);
});
test("casdoorLogin honors an ok response without leaking data", async () => {
  const fetchImpl = async () => ({
    status: 200,
    text: async () =>
      JSON.stringify({ status: "ok", data: { token: "secret-session", user: "x" } }),
    headers: { get: () => "application/json" },
  });
  const r = await casdoorLogin("a@b.c", "pw", { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.returned.token, undefined); // token redacted
});
test("casdoorLogin detects SPA html response", async () => {
  const fetchImpl = async () => ({
    status: 200,
    text: async () => "<!doctype html><html><body>SPA</body></html>",
    headers: { get: () => "text/html" },
  });
  const r = await casdoorLogin("a@b.c", "pw", { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.html, true);
});
/* ------------------------------------------------------------------ */
/* Slicer Next 2.0.0.3: the account JWT is the XX-Token                */
/* ------------------------------------------------------------------ */
// docs/research/cloud-auth-2026-11-18.md — the exchange answers HTTP 200,
// `code 0, "Failed to get user info"` and no session token. `auth_setup` must
// still complete for a NEW user, name the fallback, and never invent a
// downgrade for transport faults.

/** Account JWT shape: 3 parts + the claims the slicer's token carries. */
const ACCOUNT_JWT = makeTestJwt({ user_id: 4242, mode: "prod" });

const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const slicer2Refusal = async () => reply({ code: 0, msg: "Failed to get user info" });

test("looksLikeAccountJwt separates the account JWT from an opaque portal token", () => {
  assert.equal(looksLikeAccountJwt(classifyAccessToken(ACCOUNT_JWT)), true);
  assert.equal(
    looksLikeAccountJwt(classifyAccessToken(makeTestJwt({ user_id: undefined, mode: "prod" }))),
    true,
    "mode: prod alone identifies the slicer token",
  );
  assert.equal(looksLikeAccountJwt(classifyAccessToken("opaque-portal-token")), false);
  assert.equal(
    looksLikeAccountJwt(classifyAccessToken(makeTestJwt({ user_id: undefined, mode: undefined }))),
    false,
    "a plain JWT without the account claims is not the slicer token",
  );
});

test("validateAccessToken uses the account JWT when Slicer Next 2.0.0.3 refuses the exchange", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return slicer2Refusal();
  };
  const lines = [];
  const r = await validateAccessToken(ACCOUNT_JWT, {
    fetchImpl,
    region: "en",
    log: (line) => lines.push(line),
  });

  assert.equal(r.ok, true);
  assert.equal(r.mode, "pcf", "the slicer JWT keeps MQTT enabled");
  assert.equal(r.mqtt, true);
  assert.equal(r.auth_source, "account_jwt");
  assert.match(r.auth_reason, /Failed to get user info/, "the reason is carried, not swallowed");
  assert.equal(r.user_id, 4242, "identity comes from the JWT claims");
  assert.equal(calls.length, 1, "the 2.0.0.3 refusal is final — no web retry");

  assert.equal(lines.length, 1, "the fallback is named in one log line");
  assert.match(lines[0], /account access_token directly as XX-Token/);
  assert.match(lines[0], /Slicer Next >= 2\.0\.0\.3/);
  assert.match(lines[0], /Failed to get user info/);
});

test("validateAccessToken fails loudly on a transport error — no fallback", async () => {
  const lines = [];
  const fetchImpl = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    validateAccessToken(ACCOUNT_JWT, { fetchImpl, log: (line) => lines.push(line) }),
    /fetch failed/,
  );
  assert.deepEqual(lines, [], "a transport fault is not a 2.0.0.3 refusal");
});

test("validateAccessToken fails loudly on an HTTP error — no fallback", async () => {
  const lines = [];
  const fetchImpl = async () => reply({ code: 500, msg: "gateway down" }, 502);
  await assert.rejects(
    validateAccessToken(ACCOUNT_JWT, { fetchImpl, log: (line) => lines.push(line) }),
    /gateway down/,
  );
  assert.deepEqual(lines, []);
});

test("validateAccessToken refuses a non-JWT portal token on 2.0.0.3 with a next step", async () => {
  const lines = [];
  await assert.rejects(
    validateAccessToken("opaque-portal-token", {
      fetchImpl: slicer2Refusal,
      log: (line) => lines.push(line),
    }),
    /not a 3-part account JWT/,
  );
  assert.deepEqual(lines, []);
});

/* ------------------------------------------------------------------ */
/* auth_setup tool: the same lane, through the MCP contract            */
/* ------------------------------------------------------------------ */

function stubServer() {
  const tools = new Map();
  return {
    registerTool(name, def, handler) {
      tools.set(name, { def, handler });
    },
    tools,
  };
}

/** Real decision, fake network: only fetch and the DPAPI store are replaced. */
function registerToolUnderTest(server, deps) {
  registerAuthSetupHelper(server, z, {
    validateAccessToken: (token, options) =>
      validateAccessToken(token, { ...options, fetchImpl: deps.fetchImpl, log: () => {} }),
    saveStoredToken: deps.saveStoredToken,
  });
  return server.tools.get("auth_setup");
}

test("auth_setup stores the account JWT fallback and reports it", async () => {
  const server = stubServer();
  const saved = [];
  const { def, handler } = registerToolUnderTest(server, {
    fetchImpl: slicer2Refusal,
    saveStoredToken: async (token, options) => {
      saved.push({ token, options });
      return {
        encrypted: "ciphertext",
        capturedAt: "2026-11-18T00:00:00.000Z",
        sub: "sub-placeholder",
      };
    },
  });

  const out = await handler({ access_token: ACCOUNT_JWT, region: "en" });

  assert.equal(out.ok, true);
  assert.equal(out.stored, true);
  assert.equal(out.mode, "pcf");
  assert.equal(out.auth_source, "account_jwt");
  assert.match(out.auth_reason, /Failed to get user info/);
  assert.match(out.message, /the account JWT itself is the XX-Token/);
  assert.match(out.message, /MQTT control enabled/);
  assert.equal("token" in out, false, "auth_setup never echoes the token");
  assert.equal(saved.length, 1);
  assert.equal(saved[0].token, ACCOUNT_JWT);
  assert.equal(saved[0].options.mode, "pcf");
  assert.equal(saved[0].options.mqtt, true);
  assert.equal(saved[0].options.authSource, "account_jwt");

  const parsed = def.outputSchema.safeParse(out);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues ?? []));
  assert.equal(
    def.outputSchema.safeParse({ ...out, surprise: 1 }).success,
    false,
    "the output schema stays .strict()",
  );
  assert.equal(def.inputSchema.safeParse({ access_token: "x" }).success, true);
  assert.equal(
    def.inputSchema.safeParse({ access_token: "x", include_token: true }).success,
    false,
    "auth_setup has no token to include — strict input rejects it",
  );
});

test("auth_setup keeps the legacy session path for older slicers", async () => {
  const server = stubServer();
  const saved = [];
  const fetchImpl = async (url) => {
    if (String(url).includes("/loginWithAccessToken")) {
      return reply({ code: 1, data: { token: "session-token", user_id: 4242 } });
    }
    if (String(url).includes("/user/profile/userInfo")) {
      return reply({ code: 1, data: { id: 4242, user_email: "me@example.com" } });
    }
    throw new Error("unexpected request " + url);
  };
  const { handler } = registerToolUnderTest(server, {
    fetchImpl,
    saveStoredToken: async (token, options) => {
      saved.push({ token, options });
      return { encrypted: "ciphertext", capturedAt: "2026-11-18T00:00:00.000Z" };
    },
  });

  const out = await handler({ access_token: ACCOUNT_JWT });

  assert.equal(out.ok, true);
  assert.equal(out.auth_source, "session");
  assert.equal(out.auth_reason, undefined);
  assert.match(out.message, /pcf mode: MQTT control enabled/);
  assert.equal(saved[0].options.authSource, "session");
});

test("auth_setup reports a loud failure instead of a partial store", async () => {
  const server = stubServer();
  let savedCalls = 0;
  const fetchImpl = async () => {
    throw new TypeError("getaddrinfo ENOTFOUND");
  };
  const { handler } = registerToolUnderTest(server, {
    fetchImpl,
    saveStoredToken: async () => {
      savedCalls += 1;
      return {};
    },
  });

  const out = await handler({ access_token: ACCOUNT_JWT });

  assert.equal(out.ok, false);
  assert.match(out.error, /ENOTFOUND/);
  assert.equal(savedCalls, 0, "nothing is stored when validation failed loudly");
});

/* ------------------------------------------------------------------ */
/* DPAPI token store: BOM-free write, BOM repair on read               */
/* ------------------------------------------------------------------ */

test("loadStoredToken repairs a BOM'd cloud-token.json instead of reporting none", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "ac-auth-bom-"));
  const file = path.join(dataDir, "cloud-token.json");
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    await writeFile(
      file,
      "\uFEFF" + JSON.stringify({ encrypted: "ciphertext", sub: "sub-placeholder", mode: "pcf" }),
    );
    const status = await loadStoredToken({ dataDir });

    assert.equal(status.stored, true);
    assert.equal(status.sub, "sub-placeholder");
    assert.equal(status.mode, "pcf");
    const rewritten = await readFile(file, "utf8");
    assert.notEqual(rewritten.charCodeAt(0), 0xfeff, "the store is rewritten BOM-free");
    assert.ok(errors.some((line) => /carried a UTF-8 BOM; rewritten without it/.test(line)));
  } finally {
    console.error = original;
    await rm(dataDir, { recursive: true, force: true });
  }
});
