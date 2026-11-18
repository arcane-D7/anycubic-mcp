/**
 * Anycubic Cloud Real Client (workbench API + MQTT).
 *
 * Reverse-engineered protocol, cross-validated live on hardware (2026-09-04):
 *  - Login:  POST {API}/v3/public/loginWithAccessToken {device_type:"pcf", access_token: <JWT>}
 *            -> data.token = XX-Token session
 *  - Signed headers (all calls): Xx-Device-Type/Nonce/Signature/Timestamp/Version,
 *    Xx-Signature = md5(app_id + ts + version + secret + nonce + app_id)
 *  - Printers: GET {API}/work/printer/getPrinters (XX-Token)
 *  - Orders:   POST {API}/work/operation/sendOrder {printer_id, order_type, ...}
 *  - MQTT: mqtts://mqtt-universe.anycubic.com:8883, mutual TLS (shared slicer identity),
 *    username "user|pcf|<email>|<md5(clientId+pwd+clientId)>", password = RSA-PKCS1v15(XX-Token, CA key) b64
 *  - Topics: anycubic/anycubicCloud/v1/printer/app/<machine_type>/<key>/#  (reports)
 *            anycubic/anycubicCloud/v1/printer/public/<machine_type>/<key>/<type>  (commands)
 *
 * Identity constants originate from WaresWichall/hass-anycubic_cloud + Nino6689/anycubic-cloud-api
 * (GPL-3.0), which extracted them from Anycubic's own slicer. This is a shared client
 * identity, not a per-user secret.
 *
 * Slicer Next 2.0.0.3 changed the cloud auth lane (reported 2026-11-18 by an
 * external user's agent; see docs/research/cloud-auth-2026-11-18.md):
 *  - /v3/public/loginWithAccessToken now answers `code 0, "Failed to get user
 *    info"` for every combination tried (16: token shape, device type, header
 *    case, base path). The account JWT is accepted DIRECTLY as `XX-Token` by
 *    the /v2/* endpoints, so login() keeps the session exchange first (old
 *    slicers still work that way) and lets it fail into the account JWT.
 *  - /work/printer/getPrinters is no longer served; printers come from
 *    GET /v2/printer/printersStatus. The old route stays as a fallback.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import mqtt from "mqtt";
import { decodeJwtPayload } from "./auth-login.mjs";
import {
  AUTH_SOURCE,
  accountJwtFallback,
  describeAccountJwtFallback,
  describeExchangeRefusal,
  isApplicationRefusal,
} from "./cloud-auth-shared.mjs";
export {
  AUTH_SOURCE,
  accountJwtFallback,
  describeAccountJwtFallback,
  describeExchangeRefusal,
  isApplicationRefusal,
  parseTokenRecordText,
  readTokenRecordFile,
  serializeTokenRecord,
} from "./cloud-auth-shared.mjs";

const AC_AID = "f9b3528877c94d5c9c5af32245db46ef";
const AC_SEC = "0cf75926606049a3937f56b0373b99fb";
const AC_VER = "V3.0.0";
const BASE = "https://cloud-universe.anycubic.com";
const API_ROOT = `${BASE}/p/p/workbench/api`;
const MQTT_HOST = "mqtt-universe.anycubic.com";
const MQTT_PORT = 8883;
const TOPIC_PRE = "anycubic/anycubicCloud/v1";

// Legacy control IDs require revalidation; do not infer safety from this map.
// Read IDs below were corrected and tested on 2026-09-10.
// START_PRINT/PAUSE/RESUME/STOP follow the Nino6689/anycubic-cloud-api
// AnycubicOrderID IntEnum (1/2/3/4). START_PRINT=1 and STOP_PRINT=4 were
// LIVE-VALIDATED 2026-09-11 (task <TASK_ID> started the physical Kobra S1;
// STOP_PRINT cleared residual task <TASK_ID>). 1240 answered "Operation
// successful" but never created a task.
export const ORDER = Object.freeze({
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

const MATERIAL_TYPES = ["PLA", "PETG", "ABS", "PACF", "PC", "ASA", "HIPS", "PA", "PLA SE"];

export class AnycubicCloudError extends Error {
  constructor(message, code, http) {
    super(message);
    this.name = "AnycubicCloudError";
    this.code = code;
    this.http = http;
  }
}

// ---- MQTT mutual-TLS material (operator-supplied, never distributed) -------
// The cloud MQTT broker requires the slicer's shared mutual-TLS identity:
// `ca.crt`, `client.crt`, `client.key`. Those files are NOT shipped with this
// repository (see resources/mqtt-tls/README.md): the operator extracts them
// from the official Anycubic Slicer Next install into `resources/mqtt-tls/`.
//
// When they are absent the plugin must fail CLOSED with a typed, actionable
// refusal that names the missing files and the extraction step. A raw ENOENT
// leaks the operator's filesystem layout into an MCP error string and says
// nothing about how to fix it; a silent fallback to a non-mTLS connection is
// worse (the broker would reject it, or a future broker would not).
const MQTT_TLS_FILES = ["ca.crt", "client.crt", "client.key"];

export class MqttTlsMaterialError extends AnycubicCloudError {
  constructor(dir, missing) {
    super(
      `MQTT_TLS_MATERIAL_MISSING: cloud MQTT needs the Anycubic slicer's mutual-TLS identity, and ` +
        `${missing.length === MQTT_TLS_FILES.length ? "none of its files are" : "these files are"} ` +
        `present in resource dir "${dir}": ${missing.join(", ")}. ` +
        `Extract ca.crt, client.crt and client.key from the official Anycubic Slicer Next install ` +
        `into resources/mqtt-tls/ (see resources/mqtt-tls/README.md); they stay local and are never ` +
        `committed. Cloud MQTT is disabled until then — LAN MQTT reads and the read-only cloud HTTP ` +
        `order path keep working without these files.`,
      "MQTT_TLS_MATERIAL_MISSING",
    );
    this.name = "MqttTlsMaterialError";
    this.dir = dir;
    this.missing = missing;
  }
}

/**
 * Read the mTLS trio, or throw MqttTlsMaterialError naming exactly what is
 * missing. Never returns a partial set and never falls back to plain TLS.
 * @param {string} resourcesDir path to the plugin's `resources/` directory
 * @returns {{caPem: string, cert: Buffer, key: Buffer}}
 */
export function readMqttTlsMaterial(resourcesDir) {
  const dir = path.join(resourcesDir, "mqtt-tls");
  const missing = MQTT_TLS_FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length) throw new MqttTlsMaterialError(dir, missing);
  return {
    caPem: fs.readFileSync(path.join(dir, "ca.crt"), "utf8"),
    cert: fs.readFileSync(path.join(dir, "client.crt")),
    key: fs.readFileSync(path.join(dir, "client.key")),
  };
}

export class AnycubicCloud {
  constructor({ access_token, resources_dir, log, fetchImpl }) {
    this.access_token = access_token ?? null; // slicer JWT (access_token)
    this.resources_dir = resources_dir;
    this.log = log ?? (() => {});
    // Injectable for fixture-based tests (the repo's other cloud clients take
    // the same option); defaults to global fetch at call time.
    this.fetchImpl = fetchImpl ?? null;
    this.xxToken = null;
    // "session" (loginWithAccessToken exchanged one) or "account_jwt" (Slicer
    // Next >= 2.0.0.3 fallback: the account JWT is the XX-Token).
    this.authSource = null;
    this.authReason = null;
    this.user = null;
    this.msgid = 0;
  }

  // ---- signed headers -------------------------------------------------
  #authHeaders(withToken) {
    const nonce = crypto.randomUUID().replace(/-/g, "").slice(0, 32);
    const ts = Date.now().toString();
    const sig = crypto
      .createHash("md5")
      .update(`${AC_AID}${ts}${AC_VER}${AC_SEC}${nonce}${AC_AID}`)
      .digest("hex");
    const h = {
      "Xx-Device-Type": "pcf",
      "Xx-Is-Cn": "1",
      "Xx-Nonce": nonce,
      "Xx-Signature": sig,
      "Xx-Timestamp": ts,
      "Xx-Version": AC_VER,
      "XX-LANGUAGE": "US",
      "Content-Type": "application/json",
    };
    if (withToken && this.xxToken) h["XX-Token"] = this.xxToken;
    return h;
  }

  async #send(method, endpoint, { body, query, withToken = true } = {}) {
    const url = new URL(API_ROOT + endpoint);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const res = await (this.fetchImpl ?? fetch)(url, {
      method,
      headers: this.#authHeaders(withToken),
      signal: AbortSignal.timeout(15000),
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* non-JSON */
    }
    return { res, json };
  }

  async #api(method, endpoint, { body, query, withToken = true } = {}) {
    const { res, json } = await this.#send(method, endpoint, { body, query, withToken });
    if (!res.ok)
      throw new AnycubicCloudError(`HTTP ${res.status} on ${endpoint}`, json?.code, res.status);
    if (json && json.code !== 1)
      throw new AnycubicCloudError(json.msg || `code ${json.code}`, json.code, res.status);
    return json;
  }

  // ---- session --------------------------------------------------------
  /**
   * Acquire the XX-Token used by every signed call.
   *
   * Old path first: exchange the account JWT via
   * POST /v3/public/loginWithAccessToken. Slicer Next 2.0.0.3 answers
   * `code 0, "Failed to get user info"` to that exchange for every token, so
   * when the server REFUSES the exchange at the application level (HTTP 200,
   * no session token) the account JWT itself becomes the XX-Token — the /v2/*
   * endpoints accept it directly. A transport failure or a real HTTP error is
   * NOT a fallback signal: it keeps failing loudly.
   */
  async login() {
    if (!this.access_token) {
      throw new AnycubicCloudError("access_token is required for login()", "NO_ACCESS_TOKEN");
    }
    let sessionReason = null;
    let refusal = null;
    try {
      const res = await this.#api("POST", "/v3/public/loginWithAccessToken", {
        body: { device_type: "pcf", access_token: this.access_token },
        withToken: false,
      });
      const token = res?.data?.token ?? res?.data?.access_token;
      if (token) {
        this.xxToken = token;
        this.authSource = AUTH_SOURCE.SESSION;
      } else {
        refusal = {
          http: 200,
          code: res?.code ?? "unknown",
          message:
            `loginWithAccessToken returned no session token ` +
            `(code=${res?.code ?? "unknown"}; ${String(res?.msg ?? "no message").slice(0, 120)})`,
        };
      }
    } catch (error) {
      // Only an application-level refusal (HTTP 200, no token) is a fallback
      // signal; a transport fault or a real HTTP error keeps failing loudly.
      if (!isApplicationRefusal(error)) throw error;
      refusal = {
        http: 200,
        code: error.code ?? "unknown",
        message: `loginWithAccessToken refused the exchange (code=${error.code ?? "unknown"}; ${error.message})`,
      };
    }

    if (!this.xxToken) {
      sessionReason = describeExchangeRefusal(refusal);
      const fallback = accountJwtFallback(this.access_token, sessionReason);
      this.xxToken = fallback.token;
      this.authSource = fallback.authSource;
      this.authReason = fallback.authReason;
      this.log(describeAccountJwtFallback(sessionReason));
    }

    // Identity is best effort: /user/profile/userInfo is a workbench route and
    // may refuse the raw JWT. Validate the token anyway — the callers that
    // matter (/v2 printers, orders) do not need the profile — and fall back to
    // the JWT's own claims (user_id/email) for MQTT's user name.
    try {
      const user = await this.#api("GET", "/user/profile/userInfo");
      this.user = user.data;
    } catch (error) {
      if (this.authSource !== "account_jwt") throw error;
      const claims = decodeJwtPayload(this.access_token) ?? {};
      this.user = {
        id: claims.user_id ?? claims.sub,
        user_email: claims.email ?? claims.user_email,
      };
      this.log(
        `cloud auth: user profile unavailable on the account-JWT fallback (${error.message}); ` +
          `identity taken from JWT claims`,
      );
    }
    this.log(`login ok: user=${this.user?.id ?? "unknown"} auth=${this.authSource}`);
    return { xxToken: this.xxToken, user: this.user, authSource: this.authSource };
  }

  // ---- printers --------------------------------------------------------
  /**
   * List the printers bound to the account.
   *
   * Slicer Next 2.0.0.3: GET /v2/printer/printersStatus answers with the
   * account JWT (or a legacy session token) as XX-Token. The old workbench
   * route /work/printer/getPrinters is kept as a fallback so older
   * deployments keep working; both paths are mapped to the same PrinterInfo
   * shape this module's callers already read.
   */
  async listPrinters() {
    const viaV2 = await this.#printersFromV2();
    if (viaV2) return viaV2;
    const res = await this.#api("GET", "/work/printer/getPrinters");
    return extractPrinterEntries(res?.data) ?? [];
  }

  /** @returns {Promise<object[]|null>} null when the v2 route is unusable. */
  async #printersFromV2() {
    try {
      const { res, json } = await this.#send("GET", "/v2/printer/printersStatus");
      if (!res.ok) {
        this.log(
          `printers: /v2/printer/printersStatus HTTP ${res.status} — falling back to /work/printer/getPrinters`,
        );
        return null;
      }
      const entries = extractPrinterEntries(json?.data);
      if (!entries) {
        this.log(
          `printers: /v2/printer/printersStatus carried no printer list ` +
            `(code=${json?.code ?? "unknown"}; ${String(json?.msg ?? "no message").slice(0, 120)}) — ` +
            `falling back to /work/printer/getPrinters`,
        );
        return null;
      }
      return entries.map(mapPrinterEntry).filter(Boolean);
    } catch (error) {
      this.log(
        `printers: /v2/printer/printersStatus failed (${error.message}) — falling back to /work/printer/getPrinters`,
      );
      return null;
    }
  }

  /**
   * Raw workbench call that merges auth headers (XX-Token + Xx-* signature).
   * Used by the upload flow (lockStorageSpace / newUploadFile / AWS PUT).
   */
  async rawApi(method, endpoint, { params, query } = {}) {
    const url = new URL(API_ROOT + endpoint);
    if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const res = await (this.fetchImpl ?? fetch)(url, {
      method,
      headers: this.#authHeaders(true),
      signal: AbortSignal.timeout(15000),
      body: params ? JSON.stringify(params) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!json || json.code !== 1)
      throw new AnycubicCloudError(json?.msg ?? `HTTP ${res.status}`, json?.code, res.status);
    return json;
  }

  /** Public alias of the signed auth headers (XX-Token included) for ad-hoc probes. */
  authHeadersPublic() {
    return this.#authHeaders(true);
  }

  // ---- orders (cloud) --------------------------------------------------
  #nextMsgid() {
    return crypto.randomUUID();
  }

  /**
   * Send an order via the cloud workbench.
   * ⚠ Wire quirks (validated against the real API, mirroring hass-anycubic):
   *  - Project-level orders (START_PRINT=1, PAUSE=2, RESUME=3, STOP=4) keep
   *    order_id as an INTEGER and take `projectId` (e.g. 0 for a new task, or
   *    the task id for STOP). START_PRINT was live-validated 2026-09-11: with
   *    order_id=1 + full slice_param + ams_info mapping the device started
   *    (task <TASK_ID> reached `printing`); the old 1240 hypothesis answered
   *    "Operation successful" yet never created a task.
   *  - Printer-level orders (MOVE_AXLE, SET_TEMPERATURE, ...) stringify the
   *    order_id and must OMIT project_id (MOVE_AXLE silently ignored when
   *    project_id:0 is present).
   */
  async sendOrder(printer, order_id, order_data, { projectId, extra } = {}) {
    // Project-level control orders (START/PAUSE/RESUME/STOP) keep order_id as
    // an INTEGER on the wire (AnycubicProjectCtrlOrderRequest, live-validated
    // 2026-09-11). Printer-level orders take the stringified form.
    const projectControl = order_id === 1 || order_id === 2 || order_id === 3 || order_id === 4;
    const body = {
      printer_id: printer.id,
      order_id: projectControl ? order_id : String(order_id),
      msgid: this.#nextMsgid(),
      timestamp: Date.now(),
      data: order_data ?? {},
      ...(projectId !== undefined ? { project_id: projectId } : {}),
      ...extra,
    };
    const res = await this.#api("POST", "/work/operation/sendOrder", { body });
    return res.data;
  }

  // HTTP read orders work with the corrected IDs. Earlier claims that HTTP
  // ignores printer-level requests came from testing an incorrect order map.
  // Control wrappers below remain legacy and need independent validation.
  async publishCommand(printer, type, action, data, client) {
    const topic = `anycubic/anycubicCloud/v1/pc/printer/${printer.machine_type}/${printer.key}/${type}`;
    const msgid = this.#nextMsgid();
    await new Promise((resolve, reject) =>
      client.publish(
        topic,
        JSON.stringify({
          type,
          action,
          timestamp: Date.now(),
          msgid,
          data: data ?? {},
        }),
        (error) => (error ? reject(error) : resolve()),
      ),
    );
    return msgid;
  }

  setTemperature(printer, { nozzle, bed }) {
    const data = { type: 2, target_hotbed_temp: bed ?? 0, target_nozzle_temp: nozzle ?? 0 };
    return this.sendOrder(printer, ORDER.SET_TEMPERATURE, data);
  }
  setFanSpeed(printer, { fan, aux, box }) {
    // slicer sends exactly one key per call
    const data =
      fan != null
        ? { fan_speed_pct: fan }
        : aux != null
          ? { aux_fan_speed_pct: aux }
          : box != null
            ? { box_fan_level: box }
            : {};
    return this.sendOrder(printer, ORDER.SET_FAN_SPEED, data);
  }
  setLight(printer, on, { light_type = 2, brightness = 100 } = {}) {
    return this.sendOrder(printer, ORDER.SET_LIGHT_STATUS, {
      type: light_type,
      status: on ? 1 : 0,
      brightness: on ? brightness : 0,
    });
  }
  setAiDetection(printer, enabled, current = {}) {
    return this.sendOrder(printer, ORDER.SET_AI_SETTINGS, {
      ai_settings: {
        status: enabled ? 3 : 0,
        type: current.type ?? 2,
        count: current.count ?? 60,
        sensitivity_level: current.sensitivity_level ?? [1, 1],
        notice_type: current.notice_type ?? [0, 1],
      },
    });
  }
  moveAxis(printer, { axis, move_type, distance = 0 }) {
    return this.sendOrder(printer, ORDER.MOVE_AXLE, { axis, move_type, distance });
  }
  setAceSlot(printer, slotIndex, { material, r, g, b }, boxId = 0) {
    return this.sendOrder(printer, ORDER.MULTI_COLOR_BOX_SET_SLOT, {
      multi_color_box: [
        { id: boxId, slots: [{ color: [r, g, b], index: slotIndex, type: material }] },
      ],
    });
  }
  aceDry(printer, { status, target_temp, duration, box_id = 0 }) {
    return this.sendOrder(printer, ORDER.MULTI_COLOR_BOX_DRY, {
      multi_color_box: [
        { drying_status: { status, target_temp, duration, remain_time: 0 }, id: box_id },
      ],
    });
  }
  aceAutoFeed(printer, enabled, boxId = 0) {
    return this.sendOrder(printer, ORDER.MULTI_COLOR_BOX_AUTO_FEED, {
      multi_color_box: [{ id: boxId, auto_feed: enabled ? 1 : 0 }],
    });
  }
  aceGetInfo(printer) {
    return this.sendOrder(printer, ORDER.MULTI_COLOR_BOX_GET_INFO, {});
  }
  listLocalFiles(printer) {
    return this.sendOrder(printer, ORDER.LIST_LOCAL_FILES, {});
  }

  // ---- MQTT telemetry --------------------------------------------------
  async connectMqtt(printer, { onEvent, durationMs = 0 } = {}) {
    if (!this.xxToken) throw new AnycubicCloudError("login() required before MQTT");
    const { caPem, cert, key } = readMqttTlsMaterial(this.resources_dir);

    // password = RSA-PKCS1v15(XX-Token, CA pubkey) -> base64
    // node-forge is CJS: import the default export correctly under ESM
    const forgeMod = await import("node-forge");
    const forge = forgeMod.default ?? forgeMod;
    const caCert = forge.pki.certificateFromPem(caPem);
    const caPubPem = forge.pki.publicKeyToPem(caCert.publicKey);
    const rsaPub = crypto.createPublicKey(caPubPem);
    const password = crypto
      .publicEncrypt(
        { key: rsaPub, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.from(this.xxToken, "utf8"),
      )
      .toString("base64");

    const email = this.user.user_email || String(this.user.id);
    // Broker rejects randomized IDs (live test: CONNACK 5, Not authorized).
    // Serialize diagnostic sessions: this fixed identity can displace a peer.
    const clientId = crypto
      .createHash("md5")
      .update(email + "pcf")
      .digest("hex");
    const sigMd5 = crypto
      .createHash("md5")
      .update(`${clientId}${password}${clientId}`)
      .digest("hex");
    const username = `user|pcf|${email}|${sigMd5}`;

    const topics = [
      `${TOPIC_PRE}/printer/app/${printer.machine_type}/${printer.key}/#`,
      `${TOPIC_PRE}/+/public/${printer.machine_type}/${printer.key}/#`,
    ];

    return new Promise((resolve, reject) => {
      const client = mqtt.connect({
        host: MQTT_HOST,
        port: MQTT_PORT,
        protocol: "mqtts",
        clientId,
        username,
        password,
        ca: [caPem],
        cert,
        key,
        // The vendor client certificate uses a legacy signature. Scope OpenSSL
        // compatibility to this broker; certificate/hostname verification stays on.
        ciphers: "DEFAULT@SECLEVEL=0",
        rejectUnauthorized: true,
        protocolVersion: 4,
        clean: true,
        keepalive: 60,
      });
      const connectTimer = setTimeout(() => {
        client.end(true);
        reject(new AnycubicCloudError("mqtt connect/subscription timeout", "TIMEOUT"));
      }, 15000);
      client.on("error", (e) => {
        clearTimeout(connectTimer);
        this.log(`mqtt error: ${e.message}`);
        client.end(true);
        reject(e);
      });
      client.on("connect", () => {
        this.log("mqtt connected");
        client.subscribe(topics, { qos: 0 }, (error, granted) => {
          clearTimeout(connectTimer);
          if (error || granted?.some((g) => g.qos === 128)) {
            client.end(true);
            reject(error ?? new AnycubicCloudError("mqtt subscription refused"));
          } else resolve(client);
        });
      });
      client.on("message", (topic, payload) => {
        let data = null;
        try {
          data = JSON.parse(payload.toString());
        } catch {
          return;
        }
        // ignore bare acks {msgid: ...}
        const parts = topic.split("/");
        const suffix = parts.slice(-2).join("/");
        if (parts.at(-1) === "response" && data && Object.keys(data).length === 1) return;
        onEvent?.({ topic: suffix, data, raw: topic, ts: Date.now() });
      });
      if (durationMs > 0)
        setTimeout(() => {
          client.end(true);
          resolve(null);
        }, durationMs);
    });
  }
}

// ---- printer payload mapping (Slicer Next 2.0.0.3) ---------------------
// /v2/printer/printersStatus and /work/printer/getPrinters disagree on field
// names, so both are normalised to the shape this module's callers read:
// { id, key, machine_type, device_status, name, model, online } (snake_case,
// like the workbench payload, because printer.machine_type feeds the MQTT
// topics). Only fields either payload actually documents are mapped — an
// unknown field is not invented.

/** The printer array inside a workbench/v2 reply, or null when there is none. */
export function extractPrinterEntries(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.list)) return data.list;
  return null;
}

/** One printer entry from either payload shape → the PrinterInfo contract above. */
export function mapPrinterEntry(item) {
  if (!item || typeof item !== "object") return null;
  const deviceStatus = Number(item.device_status ?? item.deviceStatus ?? item.status ?? 0) || 0;
  return {
    id: Number(item.id ?? item.printer_id ?? 0) || 0,
    key: String(item.key ?? item.dev_id ?? item.sn ?? item.device_id ?? ""),
    machine_type: String(item.machine_type ?? item.machineType ?? ""),
    device_status: deviceStatus,
    name: item.name ?? item.device_name ?? null,
    model: item.model ?? item.model_name ?? null,
    online: Boolean(item.online ?? deviceStatus === 1),
  };
}

// ---- DPAPI token-store record (BOM safety) -----------------------------
// The record format lives in `cloud-auth-shared.mjs` so the client, the
// first-install CLI and `auth_setup` write and read the same bytes; it is
// re-exported above. cloud-token.json must never carry a BOM: JSON.parse
// throws on U+FEFF, so a BOM'd store would read as "no token stored" forever.

export function findSlicerJwt(logDir) {
  // Agnostic resolution: expand %APPDATA% and ignore inert placeholder paths
  // (sanitized docs/templates), so the same code works on any machine.
  let dir = logDir;
  if (dir && dir.includes("%APPDATA%")) dir = dir.replace("%APPDATA%", process.env.APPDATA ?? "");
  if (!dir || dir.includes("<") || dir.startsWith("<")) return null;
  try {
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith("debug_"))
      .sort();
    for (const f of files.reverse()) {
      try {
        const txt = fs.readFileSync(path.join(dir, f), "utf8");
        const m = txt.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        if (m) return m[0];
      } catch {
        /* unreadable */
      }
    }
  } catch {
    /* no log dir */
  }
  return null;
}

export const ANYCUBIC_MATERIALS = MATERIAL_TYPES;
