/**
 * cloud-auth-shared.mjs — the facts both cloud-auth lanes must agree on.
 *
 * Why this module exists: the Slicer Next 2.0.0.3 fallback and the DPAPI token
 * record format are implemented twice, in `scripts/anycubic-cloud.mjs` (the
 * client) and in the frozen bundle `vendor/server.mjs` (which cannot import
 * anything from `scripts/`). `scripts/auth-login.mjs` — the first-install tool
 * and the `auth_setup` MCP tool — needs the SAME fallback decision, and it may
 * not import `anycubic-cloud.mjs`: that module imports `mqtt` at load time and
 * `anycubic-cloud.mjs` already imports `decodeJwtPayload` from `auth-login.mjs`,
 * so the reverse import would be both a cycle and an `mqtt` dependency for the
 * shipped bundle, which loads `auth-login.mjs` at startup.
 *
 * The bundle keeps its own copy by necessity (it is frozen and dependency-free).
 * Everything under `scripts/` shares this one implementation.
 */
import { readFile, writeFile } from "node:fs/promises";

/** How the XX-Token was obtained. */
export const AUTH_SOURCE = Object.freeze({
  /** Legacy workbench session from /v3/public/loginWithAccessToken. */
  SESSION: "session",
  /** Slicer Next >= 2.0.0.3: the account access_token itself is the XX-Token. */
  ACCOUNT_JWT: "account_jwt",
});

/**
 * Is a failed session exchange the 2.0.0.3 application-level refusal — i.e. a
 * reason to fall back — rather than a transport or HTTP fault?
 *
 * The 2.0.0.3 exchange answers HTTP 200 with `code 0` and no `data.token`.
 * Accepts either an `AnycubicCloudError` (which carries `.http`) or a plain
 * failure descriptor `{ http, code, message }`. Anything that is not a clean
 * HTTP 200 is NOT a fallback signal: a transport fault or a 4xx/5xx must keep
 * failing loudly, or an expired token would hide behind a confusing /v2 error.
 *
 * @param {{http?: number|string, code?: number|string, message?: string}|null|undefined} failure
 * @returns {boolean}
 */
export function isApplicationRefusal(failure) {
  return Number(failure?.http) === 200;
}

/** One-line reason a fallback happened, from whatever the exchange answered. */
export function describeExchangeRefusal(failure) {
  if (!failure) return "the session exchange returned no token";
  if (failure.message) return String(failure.message).slice(0, 200);
  return `the session exchange returned no session token (code=${failure.code ?? "unknown"})`;
}

/**
 * The canonical log line for the fallback. One implementation so the CLI, the
 * MCP tool and the tests all name it the same way.
 * @param {string} reason
 */
export function describeAccountJwtFallback(reason) {
  return (
    `cloud auth: ${reason} — using the account access_token directly as XX-Token ` +
    `(Slicer Next >= 2.0.0.3 serves /v2/* with it; the session exchange is kept first for older slicers)`
  );
}

/**
 * The fallback outcome: the account JWT becomes the XX-Token.
 * @param {string} accessToken
 * @param {string} reason
 * @returns {{token: string, authSource: string, authReason: string}}
 */
export function accountJwtFallback(accessToken, reason) {
  return {
    token: accessToken,
    authSource: AUTH_SOURCE.ACCOUNT_JWT,
    authReason: reason,
  };
}

// ---- DPAPI token-store record (BOM safety) -----------------------------
// cloud-token.json is JSON.parse'd by the MCP TokenStore, by the auth CLI and
// by `auth_setup`. JSON.parse throws on a leading BOM (U+FEFF), so a store
// written by an editor or a copy/paste can look "empty" forever. These helpers
// own the record format for every scripts/ caller: writes never emit a BOM,
// and a read strips one and reports it so the caller can rewrite the file.

/** Serialise a token record exactly as the store writes it — never with a BOM. */
export function serializeTokenRecord(record) {
  const text = JSON.stringify(record, null, 2);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse a token record, tolerating (and reporting) a leading BOM.
 * @returns {{record: any, bom: boolean}} `bom` true means the file must be rewritten.
 */
export function parseTokenRecordText(raw) {
  const text = String(raw ?? "");
  const bom = text.charCodeAt(0) === 0xfeff;
  return { record: JSON.parse(bom ? text.slice(1) : text), bom };
}

/**
 * Read a token-store file, rewriting it without a BOM when one is found.
 * A corrupt file keeps failing to JSON.parse — the caller decides how loud.
 * @returns {Promise<{record: any, repaired: boolean}>}
 */
export async function readTokenRecordFile(file) {
  const raw = await readFile(file, "utf8");
  const { record, bom } = parseTokenRecordText(raw);
  if (bom) await writeFile(file, serializeTokenRecord(record), { mode: 0o600 });
  return { record, repaired: bom };
}
