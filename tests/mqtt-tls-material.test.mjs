/**
 * resources/mqtt-tls — the mTLS identity is operator-supplied and the plugin
 * fails CLOSED without it.
 *
 * The cloud MQTT broker needs ca.crt / client.crt / client.key. This repo does
 * not ship them (see resources/mqtt-tls/README.md). Three invariants:
 *
 *  1. The tree never contains the identity: no cert/key file is committed, the
 *     folder is gitignored, and the only file in it is the README.
 *  2. A missing folder throws a typed, actionable refusal
 *     (`MQTT_TLS_MATERIAL_MISSING`) that names every absent file — never a raw
 *     ENOENT, never a silent fallback to plain TLS.
 *  3. A partial folder names only what is missing, so the operator can finish
 *     the extraction instead of guessing.
 *
 * Fixtures here are synthetic PEM *shapes* (never real key material).
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AnycubicCloud,
  MqttTlsMaterialError,
  readMqttTlsMaterial,
} from "../scripts/anycubic-cloud.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tlsDir = path.join(root, "resources", "mqtt-tls");

function emptyResources() {
  return mkdtempSync(path.join(tmpdir(), "anycubic-mqtt-tls-"));
}

/* ------------------------------------------------------------------ */
/* 1. The identity is never shipped                                   */
/* ------------------------------------------------------------------ */

test("the repository ships no mTLS material — only the folder README", () => {
  for (const file of ["ca.crt", "client.crt", "client.key"]) {
    assert.equal(
      existsSync(path.join(tlsDir, file)),
      false,
      `${file} must not be committed — the identity is operator-supplied (resources/mqtt-tls/README.md)`,
    );
  }
  assert.deepEqual(
    readdirSync(tlsDir).sort(),
    ["README.md"],
    "resources/mqtt-tls/ must contain the README only; the code path depends on the folder existing",
  );
});

test(".gitignore keeps the extracted identity out of git", () => {
  const ignore = readFileSync(path.join(root, ".gitignore"), "utf8");
  const lines = ignore.split(/\r?\n/).map((l) => l.trim());
  assert.ok(
    lines.includes("resources/mqtt-tls/*"),
    ".gitignore must ignore resources/mqtt-tls/* (with a README exception)",
  );
});

/* ------------------------------------------------------------------ */
/* 2. Missing folder → typed refusal, not ENOENT                      */
/* ------------------------------------------------------------------ */

test("absent folder throws MQTT_TLS_MATERIAL_MISSING naming all three files", () => {
  const dir = emptyResources();
  let caught;
  try {
    readMqttTlsMaterial(dir);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "must throw when the identity is absent");
  assert.equal(caught.name, "MqttTlsMaterialError");
  assert.ok(caught instanceof MqttTlsMaterialError);
  assert.equal(caught.code, "MQTT_TLS_MATERIAL_MISSING");
  assert.deepEqual(caught.missing, ["ca.crt", "client.crt", "client.key"]);
  for (const file of ["ca.crt", "client.crt", "client.key"]) {
    assert.match(caught.message, new RegExp(file.replace(".", "\\.")));
  }
  assert.match(caught.message, /resources\/mqtt-tls\/README\.md/);
  assert.match(caught.message, /never\s+committed/);
  // A raw ENOENT would leak the operator's filesystem layout into an MCP error.
  assert.doesNotMatch(caught.message, /ENOENT|no such file/i);
});

test("partial folder names only the missing files", () => {
  const resourcesDir = emptyResources();
  const dir = path.join(resourcesDir, "mqtt-tls");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "ca.crt"),
    "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n",
  );
  assert.throws(
    () => readMqttTlsMaterial(resourcesDir),
    (error) => {
      assert.equal(error.code, "MQTT_TLS_MATERIAL_MISSING");
      assert.deepEqual(error.missing, ["client.crt", "client.key"]);
      assert.match(error.message, /these files are/);
      return true;
    },
  );
});

/* ------------------------------------------------------------------ */
/* 3. connectMqtt refuses before any network I/O                      */
/* ------------------------------------------------------------------ */

test("connectMqtt fails closed with the typed refusal (no socket opened)", async () => {
  const cloud = new AnycubicCloud({
    access_token: "synthetic-token",
    resources_dir: emptyResources(),
  });
  cloud.xxToken = "synthetic-xx-token"; // skip the login precondition
  assert.equal(cloud.user, null, "refusal must not depend on a resolved account");
  await assert.rejects(
    () => cloud.connectMqtt({ id: "synthetic-printer" }),
    (error) => {
      assert.equal(error.code, "MQTT_TLS_MATERIAL_MISSING");
      assert.match(error.message, /MQTT_TLS_MATERIAL_MISSING/);
      return true;
    },
  );
});
