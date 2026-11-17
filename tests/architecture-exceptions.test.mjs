/**
 * architecture-exceptions — the programmable waiver list for
 * scripts/check-architecture.mjs.
 *
 * An exception is a decision, not silence: it relaxes ONE rule for ONE path,
 * it must carry a written reason, it is printed on every green run, and an
 * exception that never matches anything fails the check so the list cannot
 * rot. These tests pin those guarantees.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyArchitectureExceptions } from "../scripts/architecture-exceptions.mjs";

const violation = (rule, path, message = "synthetic") => ({ rule, path, message });

test("an exact-path exception suppresses only its own violation", () => {
  const violations = [
    violation(5, "resources/mqtt-tls/client.key"),
    violation(5, "resources/mqtt-tls/client.crt"),
  ];
  const { remaining, applied, unused, duplicates } = applyArchitectureExceptions(violations, [
    {
      rule: 5,
      path: "resources/mqtt-tls/client.key",
      reason: "OWNER DECISION 2026-11-17 — the ecosystem mTLS identity is published",
    },
  ]);
  assert.deepEqual(
    remaining.map((v) => v.path),
    ["resources/mqtt-tls/client.crt"],
    "the sibling file must keep failing",
  );
  assert.equal(applied.length, 1);
  assert.equal(applied[0].violations, 1);
  assert.match(applied[0].reason, /OWNER DECISION/);
  assert.equal(unused.length, 0);
  assert.equal(duplicates.length, 0);
});

test("pathPrefix relaxes a whole folder", () => {
  const violations = [
    violation(7, "resources/mqtt-tls/ca.crt"),
    violation(7, "resources/mqtt-tls/client.key"),
  ];
  const { remaining, applied } = applyArchitectureExceptions(violations, [
    { rule: 7, pathPrefix: "resources/mqtt-tls/", reason: "folder-wide waiver" },
  ]);
  assert.equal(remaining.length, 0);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].violations, 2);
});

test("exceptions never suppress a different rule", () => {
  const violations = [violation(6, "resources/mqtt-tls/client.key")];
  const { remaining, applied, unused } = applyArchitectureExceptions(violations, [
    { rule: 5, path: "resources/mqtt-tls/client.key", reason: "wrong rule" },
  ]);
  assert.equal(remaining.length, 1, "a rule 6 violation is not waived by a rule 5 exception");
  assert.equal(applied.length, 0);
  assert.equal(unused.length, 1, "the mismatched exception reports as unused");
});

test("exceptions cannot suppress an existential failure (no path, no subject)", () => {
  const violations = [violation(2, null, "vendor/server.mjs is missing")];
  const { remaining, unused } = applyArchitectureExceptions(violations, [
    { rule: 2, path: "vendor/server.mjs", reason: "attempting to waive a missing file" },
  ]);
  assert.equal(remaining.length, 1, "existential failures always fail");
  assert.equal(unused.length, 1, "and the exception reports as unused");
});

test("an exception that matches nothing is reported as unused", () => {
  const { unused } = applyArchitectureExceptions(
    [],
    [{ rule: 4, path: "scripts/legacy.mjs", reason: "kept too long" }],
  );
  assert.equal(unused.length, 1);
  assert.match(unused[0].reason, /kept too long/);
});

test("duplicates for the same rule+path are rejected", () => {
  const violations = [violation(5, "resources/mqtt-tls/client.key")];
  const exceptions = [
    { rule: 5, path: "resources/mqtt-tls/client.key", reason: "first" },
    { rule: 5, path: "resources/mqtt-tls/client.key", reason: "second" },
  ];
  const { applied, duplicates } = applyArchitectureExceptions(violations, exceptions);
  assert.equal(duplicates.length, 1, "the second entry is named as a duplicate");
  assert.equal(applied.length, 1);
  assert.equal(applied[0].reason, "first", "the first entry wins");
});
