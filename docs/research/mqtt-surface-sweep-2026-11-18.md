# Cloud MQTT surface sweep — Kobra S1 (2026-11-18)

**Status:** research record from a live, read-only capture. **No print was
started, no motion, heat, feed, delete or settings write was published.** The one
info report in the window says `state: "free"`, so the machine was idle
throughout: motion/tool-position evidence is a **gap this record names, not a
result it invents**.

**Evidence:**

- `docs/evidence/mqtt-surface-sweep-2026-11-18.json` — the 15-minute capture,
  sanitized (printer key, id, LAN IP, filenames and msgids are placeholders).
- `docs/evidence/mqtt-read-probes-2026-11-18.json` — 13 targeted read probes
  (the per-type table in §8).

**Probe code** lives in `poc-output/` (gitignored, operator-local):
`mqtt-sweep.mjs` (window capture), `read-probe.mjs` (one-shot read queries),
`clientid-probe.mjs` (identity matrix), `mqtt-reconcile.mjs` (offline
reconciliation against `scripts/printer-property-catalog.mjs`).

## 1. Connection constraints the broker actually enforces

### 1.1 Client id: deterministic only

The broker accepts exactly one identity: `md5(<account email> + "pcf")`. Four
shapes were tried against the live broker, each with a username signature
recomputed for that exact id:

| clientId shape                     | Length | Result                     |
| ---------------------------------- | ------ | -------------------------- |
| `md5(email + "pcf")` (vendor form) | 32     | **CONNECT rc=0**           |
| `md5(email + "pcf" + salt)`        | 32     | CONNACK 5 — Not authorized |
| `md5(email + "pcf") + "-sweep-…"`  | 47     | CONNACK 5 — Not authorized |
| random 32-hex                      | 32     | CONNACK 5 — Not authorized |

**Consequence, and it is a hard one:** a unique per-probe client id is
**impossible** on this broker — the signature is not the gate, the id itself is.
Any diagnostic session must therefore take the deterministic identity, and any
other client holding it (Slicer Next, an in-flight `printer_read_all`) is
displaced for the duration. No Slicer Next process was running when the sweep was
prepared, and the session was never displaced during the 15 minutes — no close
event, no reconnect, no error.

### 1.2 Subscription ACL: per-key `app` and `public` only

Twelve filters were subscribed one at a time (`SUBACK 128` = refused). The whole
granted surface is **one printer key, both report namespaces, and any model
segment**:

| Filter                                             | Grant   |
| -------------------------------------------------- | ------- |
| `printer/app/<mt>/<key>/#`                         | qos 0   |
| `printer/public/<mt>/<key>/#`                      | qos 0   |
| `printer/public/+/<key>/#`                         | qos 0   |
| `printer/app/+/<key>/#`                            | qos 0   |
| `printer/app/<mt>/+/#` (other printer, same model) | REFUSED |
| `printer/public/<mt>/+/#`                          | REFUSED |
| `printer/+/<mt>/<key>/#`                           | REFUSED |
| `printer/<mt>/<key>/#`                             | REFUSED |
| `pc/printer/<mt>/<key>/#` (own command echo)       | REFUSED |
| `printer/#`                                        | REFUSED |
| `anycubic/anycubicCloud/v1/#`                      | REFUSED |
| `#`                                                | REFUSED |

So "subscribe to the widest thing the broker accepts" is answered: it is
`printer/{app,public}/+/<key>/#`, and the sweep used it (which is why every
message arrived twice — one delivery per matching subscription; 31 duplicates
were suppressed by `(topic, payload)` within 3 s).

### 1.3 A publish ack is a cloud receipt, not a device reply

Every publish gets `{ "msgid": "…" }` on `…/<key>/response`, whether or not the
device does anything. In §8, **13 publishes produced 13 acks and 2 device
reports**. Treating the ack as success is exactly the HTTP `sendOrder` mistake
(10115) in MQTT form.

## 2. Idle traffic profile

15 minutes, 31 messages, 10 unique topics:

| Fact                           | Value                                                      |
| ------------------------------ | ---------------------------------------------------------- |
| Unsolicited messages           | **0**                                                      |
| Retained messages              | **0**                                                      |
| Device reports                 | 14 (all replies, all within ~1 s of the publish)           |
| Cloud acks                     | 17 (one per publish)                                       |
| Report topics                  | `public/<mt>/<key>/{type}/report` for 9 types + `response` |
| `status` / `workReport` pushes | 0                                                          |

This **contradicts the catalog's `info` cadence hint ("slow (~30 s push)")**:
on an idle printer there is no periodic push at all. A listener that waits for
`info` will see nothing; every read must be polled. `status` remains push-only
and was never emitted while idle, consistent with a print-time channel.

## 3. Reconciliation against the property catalog

`scripts/printer-property-catalog.mjs` declares 119 MQTT paths. The capture
matched **97 (81.5 %)**; the 22 unmatched split into "source never answered"
and "field not emitted by this firmware":

| Source / action         | Messages | Catalog | Observed | Missing                                                                          |
| ----------------------- | -------- | ------- | -------- | -------------------------------------------------------------------------------- |
| `info/report`           | 1        | 43      | 43       | —                                                                                |
| `tempature/query`       | 1        | 7       | 6        | `taskid`                                                                         |
| `fan/query`             | 1        | 3       | 3        | —                                                                                |
| `light/query`           | 1        | 3       | 3        | —                                                                                |
| `peripherie/query`      | 1        | 3       | 3        | —                                                                                |
| `aiSettings/query`      | 1        | 5       | 5        | —                                                                                |
| `multiColorBox/getInfo` | 5        | 25      | 25       | —                                                                                |
| `axis/query`            | 1        | 3       | 3        | —                                                                                |
| `file/listLocal`        | 1        | 11      | 6        | 5 legacy flat fields (`filename`, `fileSize`, `fileKey`, `path`, `thumbnailUrl`) |
| `file/listUdisk`        | 1        | 11      | 1        | `records[]` empty (see §6)                                                       |
| `extfilbox/*`           | 0        | 5       | 0        | whole source (see §5)                                                            |
| `print/query`           | 0        | 9       | 0        | whole source (see §5)                                                            |
| `status`                | 0        | 2       | 0        | push-only, idle (see §2)                                                         |

`extra` fields reported by the reconciler are two artifacts, not discoveries:

- `info.last_project` — the key exists with a `null` value; every declared
  `last_project.*` path is simply absent while idle.
- `file.records` on the empty `listUdisk` reply — the array is present but empty,
  so no `records[]` element path can match.

**No genuinely uncatalogued live field was found.** The 119-path map holds for
everything that answered.

## 4. ACE / `multiColorBox` — the full live payload

`getInfo` answered five times (initial + four 180 s re-polls). The **`data`
payload was byte-identical across all five**; only the envelope `msgid` changed.
72 leaf paths, 25/25 catalogued.

Box level:

| Field                                          | Value                                                       |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `head_tools_model`                             | `0`                                                         |
| `multi_color_box[].id` / `model_id` / `status` | `0` / `<ACE_MODEL_ID>` / `1`                                |
| `auto_feed` / `loaded_slot`                    | `0` / `-1`                                                  |
| `temp` / `humidity`                            | `27` / `22`                                                 |
| `feed_status`                                  | `code 200`, `type -1`, `current_status -1`, `slot_index -1` |
| `drying_status`                                | `status 0`, `target_temp 0`, `duration 0`, `remain_time 0`  |

Slots (four, `index` 0–3):

| Slot | `sku`        | `type` | `color` (RGB) | `color_group` (RGBA) | `edit_status` | `status` | `icon_type` | `consumables_percent` |
| ---- | ------------ | ------ | ------------- | -------------------- | ------------- | -------- | ----------- | --------------------- |
| 0    | `AHPLLB-107` | PLA    | 212, 185, 150 | 212, 185, 150, 255   | 0             | 5        | 0           | **50**                |
| 1    | `""`         | PETG   | 141, 118, 109 | 141, 118, 109, 255   | 0             | 5        | 0           | 0                     |
| 2    | `""`         | PLA    | 0, 187, 49    | 0, 187, 49, 255      | **1**         | 5        | 0           | 0                     |
| 3    | `""`         | PETG   | 242, 239, 206 | 242, 239, 206, 255   | 0             | 5        | 0           | 0                     |

Three findings that matter for any tag/NFC work:

1. **`sku` is the only per-slot material identifier in the MQTT report.** There
   is no tag UID, no NFC serial, no spool fingerprint, no per-tag timestamp. A
   spool that a tag identifies is indistinguishable in this payload from the same
   type+colour entered by hand, except for `sku` and `edit_status`.
2. **`edit_status: 0` is not proof of an RFID tag.** Slots 1 and 3 carry
   `edit_status: 0` with an empty `sku` — 0 is the default, not "tag read". Only
   a non-empty `sku` proves the tag path ran. (`docs/research/ace-nfc-filament-2026-11-18.md`
   reads `edit_status` as the tag-`source` field; the live payload narrows that:
   the field alone does not distinguish tagged from untagged.)
3. **`consumables_percent` is only populated on the tagged slot** (`50` on slot
   0; `0` on the three slots without a SKU). It is not a usable spool-level gauge
   for untagged/manual slots.

`status: 5` on every slot with `loaded_slot: -1` and `feed_status` all `-1` is
the idle signature; this record does not claim what `5` means during a feed.

## 5. `extfilbox` and `print` — still silent

| Source      | Payloads tried                    | Attempts | Device reports |
| ----------- | --------------------------------- | -------- | -------------- |
| `extfilbox` | `query {}` ×2, `reportInfo {}` ×2 | 4        | **0**          |
| `print`     | `query {}`                        | 2        | **0**          |

All four `extfilbox` attempts and both `print/query` attempts were acked by the
cloud and ignored by the device. The catalog rates both `reference`. This sweep
does not upgrade them: **a timeout is not proof the capability is absent**, and
an idle printer is the worst possible witness for either. On this firmware and
this machine they stay unverified.

## 6. File lane

`file/listLocal` answered with the documented shape:

```json
{ "list_mode": 0, "records": [ { "is_dir": false, "filename": "…", "timestamp": 1794…, "size": 16861969, "plate_number": 2 } ] }
```

Only the `records[]` shape is emitted; the five legacy flat paths the catalog
also declares (`filename`, `fileSize`, `fileKey`, `path`, `thumbnailUrl`) never
appeared.

`file/listUdisk` **does work** on this firmware (already `live` in the catalog,
now independently confirmed twice):

- `{ "path": "" }` → device error `10112 "path is empty"` — the same validation
  as `listLocal`.
- `{ "path": "/", "page": 1, "page_size": 100, "list_mode": 0 }` → `{ "list_mode": 0, "records": [] }`.

`peripherie` reports `udisk: 1`, so an empty listing with a present U-disk is
either "the stick holds no print files" or `udisk: 1` means "USB supported".
This record cannot distinguish those; it reports the observed empty list.

## 7. Tool position (X/Y/Z/E) — the gap this lane cannot close

`axis/query` answered:

```json
{ "coordinates": { "x": 0, "y": 0, "z": 0 } }
```

- X/Y/Z exist and are catalogued. All three are `0` — an idle, unparked machine
  (or a machine whose position is only meaningful mid-motion). **This is not a
  motion trail**: one sample at rest says nothing about live tracking, offsets or
  units.
- **There is no `e` (extruder) coordinate in the reply at all.** No other read
  source in the answered set carries one (`print/query` is silent, `info` while
  idle has `project`/`last_project` null). Tool-head E position is **not exposed**
  by any read this sweep could reach.
- `print` reports `settings.*` (the catalog's 9 paths) only during a job; with
  `print/query` silent there is no idle substitute.

**Decision left to the owner:** a controlled probe print is the only way to
capture live coordinates, `print/query`'s payload and the `status/workReport`
push channel. This lane did not start one, by design.

## 8. Unobserved protocol types, probed read-only

The Slicer Next binary's own type registry holds 21 types
(`docs/research/slicer-binary-surface-2026-11-18.md` §3.2), most of which have
never been seen on the wire. Eight FDM-relevant ones were queried with
query/list actions from the same action registry — empty `data`, one type per
publish, 6 s window each:

| Type            | Action               | Cloud ack | Device report |
| --------------- | -------------------- | --------- | ------------- |
| `filament`      | `queryInfo`          | yes       | **none**      |
| `network`       | `getSignalStrength`  | yes       | **none**      |
| `preheating`    | `queryInfo`          | yes       | **none**      |
| `levelling`     | `queryInfo`          | yes       | **none**      |
| `autoOperation` | `queryInfo`          | yes       | **none**      |
| `screenSaver`   | `queryInfo`          | yes       | **none**      |
| `status`        | `queryInfo`          | yes       | **none**      |
| `video`         | `videoThumbnailList` | yes       | **none**      |

A negative here is weak evidence by construction (wrong action, wrong payload,
or push-only), but it does establish two things: those topics are routable
through the broker, and **the ack proves nothing**. In particular
`filament/queryInfo` — the natural home for a `FilamentType` report — did not
answer, so a per-spool/filament identity report remains unobserved.

Note the inversion: the five types our tools actually use and that answered
(`info`, `fan`, `axis`, `aiSettings`, `file`) are **not** in the SDK registry;
the registry types are, and were silent. That is consistent with the sibling
doc's reading — our names are firmware aliases — and it means "add the missing
registry types" is not a cheap win on an idle machine.

## 9. What is new, what is confirmed, what stayed out

**New (this sweep is the first evidence):**

- The granted ACL is exactly `printer/{app,public}/+/<key>/#`; every wider form,
  including `printer/#` and `pc/printer/<mt>/<key>/#`, is `SUBACK 128`.
- A unique client id is impossible: three non-vendor shapes (salted 32-hex,
  suffixed, random 32-hex) all get `CONNACK 5`. Diagnostics must take the shared
  identity and accept that they displace a peer.
- Idle traffic is zero. The `info` "~30 s push" cadence hint is wrong; reads must
  be polled. No retained state exists on these topics.
- `edit_status: 0` does not mean "RFID tag"; two untagged slots report it.
  `consumables_percent` is populated only on the tagged slot.
- `sku` is the only spool identity in `multiColorBox`; there is no tag UID.
- A publish ack is cloud-level: 13/13 acks vs 2/13 device reports.
- Overlapping wildcards deliver duplicate messages (one per matching filter).

**Confirmed (was documented, now re-measured live):**

- `multiColorBox` coverage is complete at 25/25; the box is idle
  (`loaded_slot -1`, `feed_status -1`, `auto_feed 0`) and stable across 5 polls.
- `file/listUdisk` answers and validates `path` like `listLocal` (`10112` empty).
- `file/listLocal` emits `records[]` only, not the five legacy flat fields.
- `info` carries all 43 catalogued paths, with `project`/`last_project` null when
  idle; `features.*` (12 booleans) unchanged.
- `axis/query` carries X/Y/Z only, all `0` at rest.
- `response` acks are bare `{msgid}` with no code or state.

**Out of scope / still open:**

- Live X/Y/Z during motion and any E coordinate (needs a controlled print).
- `print/query`, `print.settings.*`, `status/workReport` (print-time only).
- `extfilbox` (5 paths) — three payloads, zero replies.
- `filament`/`FilamentType` report and any per-spool fingerprint.
- The other 13 registry types (`resin`, `exposure`, `airpure`, `releaseFilm`,
  `smartResinVat`, `lastWill`, …) — not valid for this FDM machine or push-only.
- HTTP-side `ace` payload (33 fields) — out of this lane; already catalogued.

## 10. Reproduce

```bash
# 15-minute passive window + read-only queries (one printer identity at a time)
node poc-output/mqtt-sweep.mjs --minutes 15 --out poc-output/mqtt-sweep.jsonl

# targeted read probes (every action is a query/list; nothing moves or heats)
node poc-output/read-probe.mjs '[{"type":"extfilbox","action":"query","data":{}}]' \
  --out poc-output/read-probes.jsonl

# offline reconciliation against the committed catalog
node poc-output/mqtt-reconcile.mjs poc-output/mqtt-sweep.jsonl
```

Requirements: the operator's `resources/mqtt-tls/{ca.crt,client.crt,client.key}`
and a valid stored cloud token (DPAPI). Both stay operator-local and gitignored.
The sweep takes the deterministic `md5(email+"pcf")` identity — do not run it
while a Slicer Next session or another MQTT tool is open.
