import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXIT,
  formatTable,
  helpFor,
  main,
  normalizeDeviceRow,
  normalizeOnline,
  parseCli,
  parseJsonArgs,
  parsePrinterRef,
  redact,
  renderAccountStatus,
  renderPrinters,
  renderStatus,
  renderTools,
  resolveTool,
  suggestTools,
  unwrapReply,
  UsageError,
} from "../scripts/anycubic-cli.mjs";

// --------------------------------------------------------------------------
// A fake MCP runtime: no server is spawned, no network is touched.
// --------------------------------------------------------------------------

const REGISTRY = [
  {
    name: "account_devices",
    description: "List the printers bound to the logged-in Anycubic account (remote print).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "account_token_status",
    description: "Report whether a token is stored and when it expires.",
    inputSchema: { type: "object", properties: { include_token: { type: "boolean" } } },
  },
  {
    name: "discover_printers",
    description: "Scan the local subnet for Anycubic printers.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "echo",
    description: "Return the arguments unchanged.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "printer_status",
    description: "Read a printer's live LAN status.",
    inputSchema: { type: "object", properties: {} },
  },
];

const DEVICES_REPLY = {
  structuredContent: {
    ok: true,
    count: 1,
    devices: [
      {
        key: "K3S-0001",
        name: "Kobra S1",
        modelId: "20025",
        deviceStatus: "online",
        // The server includes the cloud session token; the CLI must never print it.
        token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.c2VjcmV0LXNpZ25hdHVyZQ",
      },
    ],
    token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.c2VjcmV0LXNpZ25hdHVyZQ",
  },
};

const STATUS_REPLY = {
  structuredContent: {
    ok: true,
    status: {
      online: true,
      dev_id: "K3S-0001",
      gcode_state: "printing",
      mc_percent: 42,
      nozzle_temper: 210,
      nozzle_target_temper: 215,
      bed_temper: 60,
      bed_target_temper: 60,
      speed_lvl: 2,
      wifi_signal: -55,
      raw: { print: { gcode_state: "printing" } },
    },
  },
};

const ACCOUNT_REPLY = {
  structuredContent: {
    ok: true,
    stored: true,
    sub: "account-0001",
    email: "operator@example.test",
    expires_at: "2026-12-01T00:00:00.000Z",
    captured_at: "2026-11-18T10:00:00.000Z",
    source: "slicer",
  },
};

async function runCli(argv, { tools = REGISTRY, reply = {}, connect } = {}) {
  const calls = [];
  const stdout = [];
  const stderr = [];
  let connects = 0;
  const connectFn = async () => {
    connects += 1;
    if (connect) return connect();
    return {
      listTools: async () => tools,
      callTool: async (name, args) => {
        calls.push({ name, arguments: args });
        if (typeof reply === "function") return reply(name, args);
        if (name === "account_devices" && reply.devices === undefined) {
          return reply?.structuredContent ? reply : DEVICES_REPLY;
        }
        return reply;
      },
      close: async () => {},
    };
  };
  const code = await main(argv, {
    connect: connectFn,
    out: (text) => stdout.push(text),
    err: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join(""), calls, connects };
}

function lines(text) {
  return text.split("\n").filter(Boolean);
}

// --------------------------------------------------------------------------
// Usage, help and exit codes (no spawn)
// --------------------------------------------------------------------------

test("no arguments prints usage on stderr and exits 2 without spawning", async () => {
  const result = await runCli([]);
  assert.equal(result.code, EXIT.USAGE);
  assert.equal(result.connects, 0);
  assert.match(result.stderr, /usage:/);
  assert.match(result.stderr, /anycubic account status/);
  assert.equal(result.stdout, "");
});

test("--help prints usage on stdout and exits 0 without spawning", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, EXIT.OK);
  assert.equal(result.connects, 0);
  assert.match(result.stdout, /anycubic tools/);
  assert.match(result.stdout, /exit codes:/);
});

test("each command answers --help before any spawn", async () => {
  for (const argv of [
    ["tools", "--help"],
    ["call", "--help"],
    ["printers", "--help"],
    ["status", "--help"],
    ["account", "--help"],
    ["account", "status", "--help"],
  ]) {
    const result = await runCli(argv);
    assert.equal(result.code, EXIT.OK, `${argv.join(" ")} should exit 0`);
    assert.equal(result.connects, 0, `${argv.join(" ")} must not spawn the server`);
    assert.match(result.stdout, /usage: anycubic/, `${argv.join(" ")} should print its usage`);
  }
});

test("help <command> prints that command's usage; unknown targets exit 2", async () => {
  const ok = await runCli(["help", "printers"]);
  assert.equal(ok.code, EXIT.OK);
  assert.match(ok.stdout, /anycubic printers \[--lan\]/);
  const whole = await runCli(["help"]);
  assert.equal(whole.code, EXIT.OK);
  assert.match(whole.stdout, /anycubic — human subcommands/);
  const bad = await runCli(["help", "print"]);
  assert.equal(bad.code, EXIT.USAGE);
  assert.match(bad.stderr, /unknown command "print"/);
});

test("unknown command and unknown option are usage errors (exit 2)", async () => {
  const unknownCommand = await runCli(["print"]);
  assert.equal(unknownCommand.code, EXIT.USAGE);
  assert.equal(unknownCommand.connects, 0);
  assert.match(unknownCommand.stderr, /unknown command "print"/);

  const unknownOption = await runCli(["tools", "--lan"]);
  assert.equal(unknownOption.code, EXIT.USAGE);
  assert.equal(unknownOption.connects, 0);
  assert.match(unknownOption.stderr, /unknown option --lan for `tools`/);
});

test("account with no or unknown subcommand is a usage error", async () => {
  const empty = await runCli(["account"]);
  assert.equal(empty.code, EXIT.USAGE);
  assert.match(empty.stderr, /account needs a subcommand/);
  const bogus = await runCli(["account", "bogus"]);
  assert.equal(bogus.code, EXIT.USAGE);
  assert.match(bogus.stderr, /unknown account subcommand "bogus"/);
});

// --------------------------------------------------------------------------
// Argument validation before the spawn
// --------------------------------------------------------------------------

test("positional arity is enforced before any spawn", async () => {
  for (const argv of [
    ["tools", "extra"],
    ["printers", "192.0.2.1"],
    ["account", "status", "x"],
  ]) {
    const result = await runCli(argv);
    assert.equal(result.code, EXIT.USAGE, `${argv.join(" ")} should be exit 2`);
    assert.equal(result.connects, 0);
    assert.match(result.stderr, /takes no arguments/);
  }
});

test("call validates the tool name and the JSON object arguments", async () => {
  const noTool = await runCli(["call"]);
  assert.equal(noTool.code, EXIT.USAGE);
  assert.match(noTool.stderr, /call needs a tool name/);

  const badJson = await runCli(["call", "echo", "{not json"]);
  assert.equal(badJson.code, EXIT.USAGE);
  assert.equal(badJson.connects, 0);
  assert.match(badJson.stderr, /json-args is not valid JSON/);

  const arrayJson = await runCli(["call", "echo", "[1,2]"]);
  assert.equal(arrayJson.code, EXIT.USAGE);
  assert.match(arrayJson.stderr, /json-args must be a JSON object/);

  const badName = await runCli(["call", "Echo"]);
  assert.equal(badName.code, EXIT.USAGE);
  assert.match(badName.stderr, /is not a tool name/);

  const tooMany = await runCli(["call", "echo", "{}", "{}"]);
  assert.equal(tooMany.code, EXIT.USAGE);
  assert.match(tooMany.stderr, /at most two arguments/);
});

test("call unknown tool fails on usage with registry-backed suggestions", async () => {
  const result = await runCli(["call", "printer_stat"]);
  assert.equal(result.code, EXIT.USAGE);
  assert.equal(result.connects, 1, "the registry is consulted to name candidates");
  assert.equal(result.calls.length, 0, "no tool is invoked");
  assert.match(result.stderr, /unknown tool "printer_stat"/);
  assert.match(result.stderr, /printer_status/);
});

test("parseJsonArgs defaults to an empty object and rejects scalars", () => {
  assert.deepEqual(parseJsonArgs(undefined), {});
  assert.deepEqual(parseJsonArgs('{"a":1}'), { a: 1 });
  assert.throws(() => parseJsonArgs("42"), UsageError);
  assert.throws(() => parseJsonArgs("null"), UsageError);
});

test("status printer references validate before the spawn", async () => {
  const missing = await runCli(["status"]);
  assert.equal(missing.code, EXIT.USAGE);
  assert.match(missing.stderr, /status needs a printer/);

  const ipWithoutId = await runCli(["status", "192.0.2.10"]);
  assert.equal(ipWithoutId.code, EXIT.USAGE);
  assert.equal(ipWithoutId.connects, 0);
  assert.match(ipWithoutId.stderr, /needs the printer id/);

  const idWithoutIp = await runCli(["status", "K3S-0001"]);
  assert.equal(idWithoutIp.code, EXIT.USAGE);
  assert.equal(idWithoutIp.connects, 0);
  assert.match(idWithoutIp.stderr, /cannot tell what "K3S-0001" is/);

  const badPort = await runCli(["status", "K3S-0001@192.0.2.10", "--mqtt-port", "0"]);
  assert.equal(badPort.code, EXIT.USAGE);
  assert.match(badPort.stderr, /--mqtt-port expects an integer 1\.\.65535/);

  const slow = await runCli(["status", "K3S-0001@192.0.2.10", "--timeout", "60000"]);
  assert.equal(slow.code, EXIT.USAGE);
  assert.match(slow.stderr, /--timeout for status is 500\.\.20000 ms/);

  const conflict = await runCli(["status", "K3S-0001@192.0.2.10", "--id", "OTHER"]);
  assert.equal(conflict.code, EXIT.USAGE);
  assert.equal(conflict.connects, 0);
  assert.match(conflict.stderr, /contradicts the reference/);
});

test("parsePrinterRef accepts the three documented shapes", () => {
  assert.deepEqual(parsePrinterRef("K3S-0001@192.0.2.10"), {
    dev_id: "K3S-0001",
    dev_ip: "192.0.2.10",
  });
  assert.deepEqual(parsePrinterRef("192.0.2.10", { dev_id: "K3S-0001" }), {
    dev_id: "K3S-0001",
    dev_ip: "192.0.2.10",
  });
  assert.deepEqual(parsePrinterRef("K3S-0001", { dev_ip: "192.0.2.10" }), {
    dev_id: "K3S-0001",
    dev_ip: "192.0.2.10",
  });
  assert.throws(() => parsePrinterRef("K3S-0001@not a host"), UsageError);
  assert.throws(() => parsePrinterRef("@192.0.2.10"), UsageError);
});

test("printers rejects contradictory filters and out-of-range LAN timeouts", async () => {
  const both = await runCli(["printers", "--online", "--offline"]);
  assert.equal(both.code, EXIT.USAGE);
  assert.equal(both.connects, 0);
  assert.match(both.stderr, /mutually exclusive/);

  const withLan = await runCli(["printers", "--lan", "--online"]);
  assert.equal(withLan.code, EXIT.USAGE);
  assert.match(withLan.stderr, /cannot be combined with --lan/);

  const slow = await runCli(["printers", "--lan", "--timeout", "20000"]);
  assert.equal(slow.code, EXIT.USAGE);
  assert.match(slow.stderr, /LAN discovery is 100\.\.15000 ms/);

  const tooShort = await runCli(["printers", "--timeout", "100"]);
  assert.equal(tooShort.code, EXIT.USAGE);
  assert.match(tooShort.stderr, /account list is 500\.\.30000 ms/);
});

test("parseCli carries the requested output modes", () => {
  const plan = parseCli(["printers", "--json", "--quiet"]);
  assert.equal(plan.command, "printers");
  assert.equal(plan.json, true);
  assert.equal(plan.quiet, true);
  assert.equal(parseCli(["tools"]).json, false);
});

// --------------------------------------------------------------------------
// Registry-driven tool resolution
// --------------------------------------------------------------------------

test("resolveTool picks the first registered candidate, never a missing one", () => {
  assert.equal(
    resolveTool(["account_devices", "discover_printers"], ["discover_printers"]),
    "discover_printers",
  );
  assert.equal(
    resolveTool(["account_devices", "discover_printers"], ["discover_printers", "account_devices"]),
    "account_devices",
  );
  assert.equal(resolveTool(["printer_status"], ["discover_printers"]), null);
});

test("suggestTools stays close to the mistyped name", () => {
  assert.deepEqual(suggestTools("printer_stat", ["printer_status", "account_devices"]), [
    "printer_status",
  ]);
  assert.deepEqual(suggestTools("zzz", ["printer_status"]), []);
});

test("printers resolves account_devices when the registry has it", async () => {
  const result = await runCli(["printers"]);
  assert.equal(result.code, EXIT.OK);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0].name, "account_devices");
  assert.deepEqual(result.calls[0].arguments, {});
  assert.match(result.stdout, /Kobra S1/);
  assert.match(result.stdout, /1 printer \(account\)/);
  assert.match(result.stdout, /ONLINE/);
});

test("printers falls back to discover_printers when the account tool is absent", async () => {
  const tools = REGISTRY.filter((tool) => tool.name !== "account_devices");
  const result = await runCli(["printers"], {
    tools,
    reply: {
      structuredContent: {
        ok: true,
        count: 1,
        printers: [
          { ip: "192.0.2.10", dev_id: "K3S-0001", firmware: "1.2.3", online: true, reached: "lan" },
        ],
      },
    },
  });
  assert.equal(result.code, EXIT.OK);
  assert.equal(result.calls[0].name, "discover_printers");
  assert.match(result.stdout, /1 printer \(LAN\)/);
  assert.match(result.stdout, /192\.0\.2\.10/);
  assert.match(result.stdout, /1\.2\.3/);
});

test("printers --lan forces LAN discovery even when the account tool exists", async () => {
  const result = await runCli(["printers", "--lan"], {
    reply: { structuredContent: { ok: true, count: 0, printers: [] } },
  });
  assert.equal(result.calls[0].name, "discover_printers");
  assert.match(result.stdout, /no printers answered on the LAN/);
});

test("printers maps --online/--offline/--region/--timeout to tool arguments", async () => {
  const online = await runCli(["printers", "--online", "--region", "en", "--timeout", "5000"]);
  assert.deepEqual(online.calls[0].arguments, {
    device_status: true,
    region: "en",
    timeout_ms: 5000,
  });
  const offline = await runCli(["printers", "--offline"]);
  assert.deepEqual(offline.calls[0].arguments, { device_status: false });
});

test("a build missing every printer-list tool fails with exit 1", async () => {
  const tools = REGISTRY.filter((tool) => tool.name === "echo");
  const result = await runCli(["printers"], { tools });
  assert.equal(result.code, EXIT.TOOL_ERROR);
  assert.equal(result.calls.length, 0);
  assert.match(result.stderr, /registers none of account_devices, discover_printers/);
});

test("a failing account list reports the tool error plus the LAN hint", async () => {
  const result = await runCli(["printers"], {
    reply: { structuredContent: { ok: false, error: "no stored token: run account_login first" } },
  });
  assert.equal(result.code, EXIT.TOOL_ERROR);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /no stored token/);
  assert.match(result.stderr, /printers --lan/);
});

// --------------------------------------------------------------------------
// Output: human, --json, --quiet
// --------------------------------------------------------------------------

test("tools lists aligned names and one-line descriptions under 80 columns", async () => {
  const result = await runCli(["tools"]);
  assert.equal(result.code, EXIT.OK);
  const text = lines(result.stdout);
  assert.ok(text.length >= REGISTRY.length);
  for (const line of text) assert.ok(line.length <= 80, `line over 80 columns: ${line}`);
  assert.ok(text[0].startsWith("account_devices"));
  assert.ok(text.some((line) => line.includes("account_devices") && line.includes("logged-in")));
  assert.equal(text.at(-1), "5 tools");
});

test("tools --quiet prints names only, one per line", async () => {
  const result = await runCli(["tools", "--quiet"]);
  assert.deepEqual(lines(result.stdout), [
    "account_devices",
    "account_token_status",
    "discover_printers",
    "echo",
    "printer_status",
  ]);
});

test("tools --json prints the registry entries and keeps schema field names", async () => {
  const result = await runCli(["tools", "--json"]);
  const parsed = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed));
  assert.equal(parsed.length, REGISTRY.length);
  assert.ok(parsed.every((entry) => typeof entry.name === "string"));
  const tokenStatus = parsed.find((entry) => entry.name === "account_token_status");
  assert.ok(
    tokenStatus.inputSchema.properties.include_token,
    "redaction must not rename a schema property such as include_token",
  );
});

test("call renders a readable tree and passes the JSON object through", async () => {
  const result = await runCli(["call", "echo", '{"a":1,"nested":{"b":"two"}}'], {
    reply: { structuredContent: { a: 1, nested: { b: "two" } } },
  });
  assert.equal(result.code, EXIT.OK);
  assert.deepEqual(result.calls[0], { name: "echo", arguments: { a: 1, nested: { b: "two" } } });
  assert.match(result.stdout, /a: 1/);
  assert.match(result.stdout, /nested:/);
  assert.match(result.stdout, /b: two/);
});

test("call --json prints the parsed tool result", async () => {
  const result = await runCli(["call", "echo", '{"a":1}', "--json"], {
    reply: { structuredContent: { ok: true, echo: { a: 1 } } },
  });
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, echo: { a: 1 } });
});

test("a tool error prints the tool's message on stderr and exits 1", async () => {
  const result = await runCli(["call", "echo"], {
    reply: { isError: true, content: [{ type: "text", text: "boom: printer busy" }] },
  });
  assert.equal(result.code, EXIT.TOOL_ERROR);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /boom: printer busy/);
});

test("a server that cannot start exits 1 with the reason", async () => {
  const result = await runCli(["tools"], {
    connect: () => {
      throw new Error("spawn ENOTFOUND");
    },
  });
  assert.equal(result.code, EXIT.TOOL_ERROR);
  assert.match(result.stderr, /cannot start the MCP server: spawn ENOTFOUND/);
});

test("printers --json is the raw result with the token redacted", async () => {
  const result = await runCli(["printers", "--json"]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.devices[0].token, "[redacted]");
  assert.equal(parsed.devices[0].key, "K3S-0001", "the dev_id key is identity, not a secret");
  assert.doesNotMatch(result.stdout, /eyJhbGciOiJIUzI1NiJ9/);
});

test("printers table truncates wide values to 80 columns", () => {
  const data = {
    ok: true,
    devices: [
      {
        name: "A very long printer name that cannot possibly fit in the column",
        modelId: "20025-EXTREMELY-LONG-MODEL-IDENTIFIER",
        key: "K3S-0001-WITH-A-VERY-LONG-SERIAL-NUMBER",
        deviceStatus: "online",
      },
    ],
  };
  const text = renderPrinters(data, { source: "account_devices" });
  for (const line of lines(text)) assert.ok(line.length <= 80, `line over 80 columns: ${line}`);
  assert.match(text, /A very long printer/);
});

test("printers --quiet prints rows without the count header", async () => {
  const result = await runCli(["printers", "--quiet"]);
  assert.equal(result.code, EXIT.OK);
  assert.doesNotMatch(result.stdout, /printer \(account\)/);
  assert.match(result.stdout, /Kobra S1/);
});

test("renderPrinters names an empty list honestly", () => {
  assert.equal(
    renderPrinters({ ok: true, devices: [] }, { source: "account_devices" }),
    "no printers on the account",
  );
  assert.equal(
    renderPrinters({ ok: true, devices: [] }, { source: "account_devices", quiet: true }),
    "",
  );
});

// --------------------------------------------------------------------------
// status and account status
// --------------------------------------------------------------------------

test("status resolves printer_status and renders the live report", async () => {
  const result = await runCli(["status", "K3S-0001@192.0.2.10", "--mqtt-port", "9883"], {
    reply: STATUS_REPLY,
  });
  assert.equal(result.code, EXIT.OK);
  assert.deepEqual(result.calls[0], {
    name: "printer_status",
    arguments: { dev_id: "K3S-0001", dev_ip: "192.0.2.10", mqtt_port: 9883 },
  });
  assert.match(result.stdout, /printer\s+K3S-0001\s+online/);
  assert.match(result.stdout, /state\s+printing/);
  assert.match(result.stdout, /progress\s+42%/);
  assert.match(result.stdout, /nozzle\s+210 \/ 215 °C/);
  assert.match(result.stdout, /bed\s+60 \/ 60 °C/);
  assert.doesNotMatch(result.stdout, /raw:/, "the raw report is machine data, not human output");
});

test("status --json prints the raw payload", async () => {
  const result = await runCli(["status", "K3S-0001@192.0.2.10", "--json"], { reply: STATUS_REPLY });
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.status.dev_id, "K3S-0001");
  assert.equal(parsed.status.raw.print.gcode_state, "printing");
});

test("status --quiet prints the one-line summary", async () => {
  const result = await runCli(["status", "K3S-0001@192.0.2.10", "--quiet"], {
    reply: STATUS_REPLY,
  });
  assert.equal(result.stdout.trim(), "printer  K3S-0001  online");
});

test("an offline printer prints its report on stdout and exits 1", async () => {
  const result = await runCli(["status", "K3S-0001@192.0.2.10"], {
    reply: {
      structuredContent: {
        ok: false,
        status: { online: false, dev_id: "K3S-0001", error: "timeout waiting for printer report" },
      },
    },
  });
  assert.equal(result.code, EXIT.TOOL_ERROR);
  assert.match(result.stdout, /K3S-0001\s+offline/);
  assert.match(result.stdout, /error\s+timeout waiting for printer report/);
  assert.match(result.stderr, /printer offline: timeout waiting for printer report/);
});

test("a build without printer_status cannot run status", async () => {
  const tools = REGISTRY.filter((tool) => tool.name !== "printer_status");
  const result = await runCli(["status", "K3S-0001@192.0.2.10"], { tools });
  assert.equal(result.code, EXIT.TOOL_ERROR);
  assert.match(result.stderr, /registers none of printer_status/);
});

test("account status asks for metadata only and renders it", async () => {
  const result = await runCli(["account", "status"], { reply: ACCOUNT_REPLY });
  assert.equal(result.code, EXIT.OK);
  assert.deepEqual(result.calls[0], {
    name: "account_token_status",
    arguments: { include_token: false },
  });
  assert.match(result.stdout, /token\s+stored/);
  assert.match(result.stdout, /operator@example\.test/);
  assert.match(result.stdout, /expires\s+2026-12-01T00:00:00\.000Z/);
  assert.doesNotMatch(result.stdout, /"token":/);
});

test("account status with no token says so without failing", async () => {
  const result = await runCli(["account", "status"], {
    reply: { structuredContent: { ok: true, stored: false } },
  });
  assert.equal(result.code, EXIT.OK);
  assert.match(result.stdout, /token\s+not stored/);
  assert.match(result.stdout, /account_capture_token/);
});

test("account status redacts a token even if the tool echoes one", async () => {
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.c2VjcmV0LXNpZ25hdHVyZQ";
  const reply = {
    structuredContent: { ok: true, stored: true, email: "operator@example.test", token },
  };
  const human = await runCli(["account", "status"], { reply });
  assert.doesNotMatch(human.stdout, /eyJhbGciOiJIUzI1NiJ9/);
  assert.doesNotMatch(human.stdout, /c2VjcmV0LXNpZ25hdHVyZQ/);
  const json = await runCli(["account", "status", "--json"], { reply });
  assert.equal(JSON.parse(json.stdout).token, "[redacted]");
});

// --------------------------------------------------------------------------
// Pure renderers and helpers
// --------------------------------------------------------------------------

test("redact masks token-ish keys and JWT-shaped values, at any depth", () => {
  const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJvcGVyYXRvciJ9.c2VjcmV0LXNpZ25hdHVyZQ";
  const redacted = redact({
    ok: true,
    key: "K3S-0001",
    auth: { access_token: token, region: "en" },
    list: [{ password: "hunter2" }, { note: token }],
    apiKey: "abc",
    access_code: "1234",
  });
  assert.equal(redacted.ok, true);
  assert.equal(redacted.key, "K3S-0001");
  assert.equal(redacted.auth.access_token, "[redacted]");
  assert.equal(redacted.auth.region, "en");
  assert.equal(redacted.list[0].password, "[redacted]");
  assert.equal(redacted.list[1].note, "[redacted]");
  assert.equal(redacted.apiKey, "[redacted]");
  assert.equal(redacted.access_code, "[redacted]");
});

test("redact survives a circular payload", () => {
  const payload = { name: "loop" };
  payload.self = payload;
  assert.equal(redact(payload).self, "[circular]");
});

test("formatTable aligns columns and respects the width budget", () => {
  const table = formatTable(
    [
      { name: "a", value: "1" },
      { name: "longer-name", value: "2" },
    ],
    [
      { key: "name", label: "NAME" },
      { key: "value", label: "VALUE" },
    ],
  );
  assert.equal(table, "NAME         VALUE\na            1\nlonger-name  2");
  const wide = formatTable(
    [{ a: "x".repeat(60), b: "y".repeat(60) }],
    [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
    ],
    { maxWidth: 40 },
  );
  for (const line of wide.split("\n")) assert.ok(line.length <= 40);
});

test("renderTools keeps descriptions on one line", () => {
  const text = renderTools([
    { name: "short", description: "two\nlines   with   spaces" },
    { name: "a-much-longer-tool-name", description: "x".repeat(200) },
  ]);
  const [first, second] = text.split("\n");
  assert.match(first, /two lines with spaces/);
  assert.ok(second.length <= 80);
  assert.ok(second.endsWith("…"));
});

test("renderTools keeps the whole line under 80 even for a very long tool name", () => {
  const text = renderTools([
    { name: "short", description: "fine" },
    { name: "x".repeat(50), description: "y".repeat(120) },
  ]);
  for (const line of text.split("\n"))
    assert.ok(line.length <= 80, `line over 80 columns: ${line}`);
});

test("renderStatus tolerates a bare status object and unknown fields", () => {
  const text = renderStatus({ online: true, dev_id: "K3S-0001", filament: "PLA" });
  assert.match(text, /printer\s+K3S-0001\s+online/);
  assert.match(text, /filament PLA/);
});

test("renderAccountStatus never prints a token field", () => {
  const text = renderAccountStatus({
    stored: true,
    email: "operator@example.test",
    token: "leak-me",
  });
  assert.doesNotMatch(text, /leak-me/);
  assert.match(text, /token\s+stored/);
});

test("normalizeOnline maps the shapes the tools use, and refuses to guess", () => {
  assert.equal(normalizeOnline(true), true);
  assert.equal(normalizeOnline("online"), true);
  assert.equal(normalizeOnline("offline"), false);
  assert.equal(normalizeOnline(1), true);
  assert.equal(normalizeOnline(0), false);
  assert.equal(normalizeOnline("printing"), null, "a print state is not an online flag");
});

test("normalizeDeviceRow reads account and LAN field shapes", () => {
  assert.deepEqual(
    normalizeDeviceRow({ key: "K3S-0001", name: "S1", modelId: "20025", deviceStatus: "online" }),
    {
      name: "S1",
      model: "20025",
      id: "K3S-0001",
      ip: undefined,
      firmware: undefined,
      reached: undefined,
      online: true,
    },
  );
  const lan = normalizeDeviceRow({
    ip: "192.0.2.10",
    dev_id: "K3S-0001",
    firmware: "1.2.3",
    online: true,
    reached: "lan",
  });
  assert.equal(lan.ip, "192.0.2.10");
  assert.equal(lan.id, "K3S-0001");
  assert.equal(lan.firmware, "1.2.3");
  assert.equal(normalizeDeviceRow("nope"), null);
});

test("unwrapReply prefers structuredContent, then parses JSON text", () => {
  assert.deepEqual(unwrapReply({ structuredContent: { a: 1 } }), { a: 1 });
  assert.deepEqual(unwrapReply({ content: [{ type: "text", text: '{"b":2}' }] }), { b: 2 });
  assert.equal(unwrapReply({ content: [{ type: "text", text: "plain words" }] }), "plain words");
  assert.deepEqual(unwrapReply({}), {});
});

test("helpFor falls back to the full usage for unknown names", () => {
  assert.match(helpFor("status"), /anycubic status <printer>/);
  assert.match(helpFor("nope"), /anycubic — human subcommands/);
});
