/**
 * architecture-exceptions.mjs — programmable, reasoned exceptions to the
 * check-architecture rules.
 *
 * An exception is a DECISION, not silence. Each entry relaxes exactly one rule
 * for one path and must carry a `reason` a reviewer can evaluate:
 *
 *   { rule: 5, path: "resources/mqtt-tls/client.key",
 *     reason: "OWNER DECISION 2026-11-17 — publish the ecosystem mTLS identity;
 *              personal tokens stay out" }
 *
 * `path` is the exact repo-relative path (forward slashes). `pathPrefix` may be
 * used instead to relax a whole folder.
 *
 * Semantics (enforced here, tested in tests/architecture-exceptions.test.mjs):
 *  - an exception applies ONLY to violations that carry a path; existential
 *    failures ("vendor/server.mjs is missing", "resources/mqtt-tls/ is
 *    missing") have no subject and cannot be excepted;
 *  - every exception must match at least one violation in the run, otherwise
 *    the check fails: an unused exception is a decision whose subject is gone;
 *  - two exceptions for the same rule + path/prefix are rejected;
 *  - every applied exception is printed with its reason, so a green gate is
 *    never silent about what was waived.
 */

/**
 * The live exception list. Empty means: every rule, every path, no waivers.
 *
 * @type {Array<{rule: number, path?: string, pathPrefix?: string, reason: string}>}
 */
export const ARCHITECTURE_EXCEPTIONS = [
  // Empty today. The shape is documented above; add one object per waiver.
];

/**
 * Split violations into "still failing" and "suppressed by an exception".
 * Pure: no filesystem, no clock — trivially testable.
 *
 * @param {Array<{rule: number, path: string | null, message: string}>} violations
 * @param {Array<{rule: number, path?: string, pathPrefix?: string, reason: string}>} exceptions
 * @returns {{
 *   remaining: Array<{rule: number, path: string | null, message: string}>,
 *   applied: Array<{rule: number, path: string, reason: string, violations: number}>,
 *   unused: Array<{rule: number, path?: string, pathPrefix?: string, reason: string}>,
 *   duplicates: Array<{rule: number, path?: string, pathPrefix?: string, reason: string}>,
 * }}
 */
export function applyArchitectureExceptions(violations, exceptions) {
  const seen = new Set();
  const duplicates = [];
  for (const exception of exceptions) {
    const key = `${exception.rule}:${exception.pathPrefix ?? "="}${exception.path ?? ""}`;
    if (seen.has(key)) duplicates.push(exception);
    else seen.add(key);
  }

  const live = exceptions.filter((exception) => !duplicates.includes(exception));
  const applied = [];
  const remaining = [];

  for (const violation of violations) {
    const match = live.find((exception) => {
      if (violation.rule !== exception.rule) return false;
      if (violation.path === null) return false; // existential failures have no subject
      if (exception.pathPrefix) return violation.path.startsWith(exception.pathPrefix);
      return violation.path === exception.path;
    });
    if (!match) {
      remaining.push(violation);
      continue;
    }
    const entry = applied.find(
      (a) => a.rule === match.rule && a.path === (match.path ?? match.pathPrefix),
    );
    if (entry) entry.violations += 1;
    else
      applied.push({
        rule: match.rule,
        path: match.path ?? match.pathPrefix,
        reason: match.reason,
        violations: 1,
      });
  }

  const matchedKeys = new Set(applied.map((a) => `${a.rule}:${a.path}`));
  const unused = live.filter(
    (exception) => !matchedKeys.has(`${exception.rule}:${exception.path ?? exception.pathPrefix}`),
  );

  return { remaining, applied, unused, duplicates };
}
