# Probe print: cloud start end-to-end + live MQTT telemetry during a job

Date: 2026-11-20 (machine timestamps). Unit: Anycubic Kobra S1 (cloud id <PRINTER_ID>),
ACE attached. Two probe prints of the same 15 mm cube (54 layers, 0.28 mm, est. 12m43s),
both physically completed. Evidence: `docs/evidence/mqtt-probe-print2-2026-11-20.jsonl`
(sanitized; job end + cooldown window) plus poc-output fragments (gitignored).

## Cloud print start: fixed and validated (3 real bugs found live)

1. **SDK stdio children get a sanitized env.** The MCP SDK's StdioClientTransport
   launches the server with PATH/HOME-style defaults only, stripping
   `ANYCUBIC_CLOUD_TOKEN`. Fixed in `scripts/anycubic-cli.mjs` + `scripts/mcp-call.mjs`
   (pass `env: { ...process.env }`).
2. **`remote_name` must carry the extension.** An extensionless name makes the cloud
   claim answer `Unsupported file format`.
3. **`account_print_local` never forwarded `confirm`/`confirm_word` to the inner
   `cloudPrintStart` gate**, so every confirmed call died at the second gate: the tool
   was unusable via MCP. Fixed (forwarded after the tool's own outer gate validates).
4. The upload -> cloud gcode processing -> start chain exceeds the MCP client request
   timeout: the order still lands server-side (task created). **Never retry on a
   timeout** — check `account_print_history` first (new tasks appear with lag; the
   second probe's task was absent from history minutes after completion).
   Reliable path: `account_file_upload` -> wait for `gcodeId` in `account_files` ->
   `printer_print_start` with that gcode_id.

## ACE slot mapping: `ams_index` is 0-based

`ams_box_mapping: {"0": {"ams_index": 2}}` fed the PHYSICAL slot 3 (owner-observed).
Display slot N = `ams_index: N-1`. Probe 2 used `ams_index: 1` = slot 2 (custom NFC tag,
as intended).

## Live telemetry during a job (MQTT)

- **`axis/query` answers with the live head position** — mid-job and parked after the
  end: `x=47, y=276, z=12.38` (parked at job end; z tracks the last layer). Coordinates
  are MACHINE-frame: `y=276` on a 250 mm bed means an origin offset is required for
  bed-relative positions. **No E axis exists in any read source** (confirmed in-job).
- **`tempature` auto reports flow ~1 per 2 s while the printer is hot** (cooldown curve
  155 -> 140 C captured) and stop when cold; idle traffic is zero (sweep 2026-11-18).
  The printer is thermally gated, not cadence gated.
- **Nozzle standby target after a job is 140 C** (not 0).
- `file/listLocal` lists the uploaded gcode on printer-local storage; `listUdisk` [].
- No `print/report` device replies were observed in either window (acked, silent; the
  print topic stays reference-class for live data).

## Session discipline (deterministic clientId)

The broker accepts only `md5(email+"pcf")` as clientId, so any new session DISPLACES
the previous one: the sweep died the moment `printer_print_start`'s manager acquired
the identity. Correct capture sequence, now proven: **start the print first, confirm
the task id, THEN launch the sweep** (it takes over the identity for the whole job).
Probe 2 lost the mid-job motion window to this + the sweep crash below; the start
fragment (run 1, first ~60 s of the job) and the end+cooldown fragment (run 4) are
both captured. A third probe with the fixed sweep would yield the full curve.

## Sweep hardening (background contexts)

The sweep's DPAPI decrypt child (PowerShell) printed `stdin is not a tty` and killed
the script in background/pipe contexts: needs `-NonInteractive` AND
`stdio: ["ignore", "pipe", "pipe"]`. Both applied to the poc-output sweep script.

## Post-mortem: probe 2 spaghetti (owner-reported, 2026-11-20)

Task 144090770 ended `print_status: 3, reason: "User initiated"` (the printer's AI
spaghetti detection stopped the job; the owner cleaned the plate and cancelled).
Root cause, found in the v1 gcode: **slicing without `--load-filaments` emits NO
nozzle-temperature command at all** — the v1 gcode carried only `M140 S45` (bed)
plus the two end-of-print `S0` lines. The printer ran the job at its standby
target (140 C, observed live in the cooldown telemetry): PLA at 140 C is
underextrusion, which prints a marginal cube on a forgiving spool (probe 1, by
luck) and spaghetti on the next (probe 2).

Fix, verified in the re-sliced `probe-cube-v2.gcode.3mf` with
`--load-filaments "Anycubic PLA @Anycubic Kobra S1 0.4 nozzle.json"`:
`M104 S210` + `M140 S55`, 54 layers. **Rule: never send a job whose gcode does
not carry an explicit nozzle heat command (assert M104/M109 S>=190 for PLA)
before the first extrusion.**
