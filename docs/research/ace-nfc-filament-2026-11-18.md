# Anycubic ACE NFC filament tags: protocol, format, and the custom-filament paths (2026-11-18)

**Status:** research record only. **No tag was written and no printer was touched
for this document.** Everything below is either (a) measured by a third party on
real hardware and published with the method, (b) present in this repository's own
captures, or (c) explicitly labelled as inference. The one hardware experiment
that settles the remaining question is in
[§11](#11-recommendation) — it costs one blank tag.

**Scope:** ACE / ACE Pro (the four-spool box) and ACE 2 Pro, attached to a Kobra
S1 (`model_id` 40002 in this repo's MQTT property map). Question: can
**third-party / custom filament** be made recognisable, and through which
channel.

**Evidence convention.** `[MEASURED]` = someone published the method and the raw
bytes/logs. `[REPO]` = already true of this codebase. `[REPORTED]` = claimed by a
tool author or vendor help page without the underlying measurement shown.
`[INFERRED]` = my reading of the above, falsifiable. `[OPEN]` = genuinely
unknown.

## 0. Bottom line

- The tag format is **fully public and fully writable**. The ACE's acceptance
  test is a four-byte header on page 4 (`7B 00 65 00`) — **there is no
  cryptography, no signature, no key, no checksum** anywhere in the Anycubic
  RFID path `[MEASURED]`.
- A tag we write in that layout is **indistinguishable from a factory tag**,
  because there is nothing to distinguish. Multiple independent writers
  (Android, iOS, Windows, ESP32) have shipped this since March 2025.
- This is the **opposite** of the Bambu AMS case that usually gets cited as the
  analogue: Bambu tags are MIFARE Classic 1K with HKDF-derived keys and
  RSA-signed payloads, so custom Bambu tags are impossible. Anycubic has no such
  gate, and the same firmware will happily read a $0.30 NTAG213.
- The ACE reports **material type + colour + SKU** per slot, and **never reports
  a per-spool unique ID**, not even for official spools. That is a real
  limitation for inventory, but it does not block "my filament is recognised".
- The repo already carries the second-best path: `multiColorBox/setInfo`
  (`ace_set_slot`) writes type + colour per slot over MQTT with no tag at all.
  It cannot write a SKU, so the slicer shows a manual filament rather than a
  product. It is `evidence: mapping` — never live-validated here.

## 1. Where the reader lives, and who talks to whom

```
tag (13.56 MHz, ISO 14443A)
  → MFRC522-class reader IC        inside the ACE box, NOT the printer
  → ACE MCU                        STM32F103/GD32F303-class Cortex-M3
  → USB CDC JSON-RPC (gen 1)  /  RS-485 230400 baud protobuf (ACE 2 Pro)
  → printer host (Klipper / klipper-go)
  → MQTT `multiColorBox` + HTTP `ace`  →  Slicer Next / this repo
```

`[MEASURED]` The front end is a **generic MFRC522-class ISO 14443A reader**: the
firmware programs the classic register set (TxControl `0x14`, ModWidth `0x24`,
RFCfg gain `0x26`) and runs the standard anticollision/SELECT cascade. The
`VersionReg` reads `0x18` rather than a genuine NXP `0x91`/`0x92`, i.e. a
register-compatible clone. It will enumerate **any** compliant tag — the
restriction is entirely in firmware, not in the radio
([ace2-pro-firmware-research/docs/03](https://github.com/Simon-CR/ace2-pro-firmware-research/blob/master/docs/03-rfid-and-tags.md)).

`[MEASURED]` The gen-1 ACE Pro speaks **USB CDC with JSON-RPC frames**
(`FF AA` + length + JSON + CRC-16/MCRF4XX + `FE`), and exposes `enable_rfid` /
`disable_rfid` as first-class methods
([Kobra-S1/ACEPRO PROTOCOL.md](https://github.com/Kobra-S1/ACEPRO/blob/dev/PROTOCOL.md)).
The ACE 2 Pro replaced this with **RS-485 at 230400 baud and Protocol Buffers**
— which is why every pre-2026 driver (ValgACE, DuckACE, BunnyACE, ACEPROSV08)
only ever worked with the first generation
([README](https://github.com/Simon-CR/ace2-pro-firmware-research)).

`[REPO]` On the printer side this repo already reads the result of that chain:
MQTT `multiColorBox` (`action: getInfo`, activity-gated) and HTTP
`/v2/printer/getMultiColorBoxInfo` (33 catalogued fields), plus `extfilbox` for
the single external spool holder.

`[OPEN]` **Antenna topology.** Three sources describe it three ways: two reader
chips each serving one antenna per _pair_ of slots (1&3, 2&4); the same author's
later correction saying gen 1 has one channel per slot; and the popular writeup
saying the readers sit in the fins _between_ slots 1&2 and 3&4. What all sources
agree on, and what matters operationally: **a spool needs one tag on each face**,
and **two tags inside the same field cause an anticollision failure (`code 4`)**
rather than a read. Official Anycubic spools ship two tags with different UIDs.

## 2. The tag

`[MEASURED]` Required: **MIFARE Ultralight C compatible**, i.e. the NTAG family.
Tested and working: **NTAG213, NTAG215**. Minimum **36 pages / 144 bytes** of
user read/write area — NTAG213 is exactly that, so it fits with zero headroom.
NTAG215 (504 B) and NTAG216 (888 B) are the comfortable choices
([DnG-Crafts/ACE-RFID](https://github.com/DnG-Crafts/ACE-RFID),
[SimplyPrint](https://help.simplyprint.io/en/article/the-anycubic-material-standard-nfcrfid-for-the-anycubic-ace-js3oty/)).

`[MEASURED]` Not NDEF. The payload is written as a **raw byte stream into the
user pages**, not into an NDEF message. The capability container on page 3 stays
at the factory `E1 10 12 00`, and the ACE never parses NDEF.

`[MEASURED]` A tag that fails the header gate produces an **honest failure**:
the ACE returns `rfid: 1` (present, not identified) with empty `sku`/`brand`.
It does not guess. (A patched community build got this wrong once and returned
NDEF JSON as if it were a filament — that is a firmware bug, not stock
behaviour.)

## 3. The payload

Page = 4 bytes. Labels below are **decimal page numbers**; every published dump
uses hex labels for the same pages (e.g. `[Page 14]` = page 20 = colour).

| Page      | Bytes | Field                                | Notes                                                                                             |
| --------- | ----- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 0–2       | 12    | UID + BCC                            | factory, read-only                                                                                |
| 3         | 4     | Capability Container (`E1 10 12 00`) | factory, do not touch                                                                             |
| **4**     | 4     | **Header `7B 00 65 00`**             | u16 LE magic `123`, version `101` ×2. `0x64` = v1, `0x65` = v2                                    |
| **5–9**   | 20    | **SKU**, ASCII, NUL-padded           | e.g. `AHPLPBK-102`                                                                                |
| **10–14** | 20    | **Brand**, ASCII, NUL-padded         | `AC` = Anycubic. All zero on v1 tags                                                              |
| **15–19** | 20    | **Material type**, ASCII, NUL-padded | `PLA`, `PLA+`, `PETG`, `ABS`, `ASA`, `TPU`; HS PLA uses `PLA?High?Speed` across the full 20 bytes |
| **20**    | 4     | **Colour**, **A B G R**              | `FF 4F A8 89` = `#89a84f`, alpha `0xFF`                                                           |
| 21–23     | 12    | zero                                 | unused                                                                                            |
| **24**    | 4     | Nozzle min/max, u16 LE               | `C8 00 D2 00` = 200–210 °C                                                                        |
| 25–28     | 16    | zero                                 | the HS PLA variant reuses 23–28 for three speed/nozzle pairs                                      |
| **29**    | 4     | Bed min/max, u16 LE                  | `32 00 3C 00` = 50–60 °C                                                                          |
| **30**    | 4     | Diameter (×100) + length (m), u16 LE | `AF 00 4A 01` = 1.75 mm, 330 m                                                                    |
| **31**    | 4     | Weight, u16 LE grams + `00 00`       | `E8 03` = 1000 g                                                                                  |
| 32–39     | 32    | zero in every published dump         | free on NTAG213; nothing reads it                                                                 |

Sources: the byte-for-byte dumps in
[Molodos/format.md](https://github.com/Molodos/anycubic-nfc-filament/blob/main/format.md)
(v1 Spring Leaf, v2 Bright White PLA+, reconstructed HS PLA) and the page table
in [DnG-Crafts/ACE-RFID](https://github.com/DnG-Crafts/ACE-RFID). They agree, and
the ESP32 reference writer writes exactly these 13 pages and nothing else.

**No checksum, no length field, no signature.** The `7B 00 65 00` header is the
whole of the format's self-description; an entire write is 13 page-writes with
no authentication step. `[MEASURED]` — the Arduino reference implementation
writes pages 4, 5–9, 10–14, 15–19, 20, 24, 29, 30, 31 and never computes a
digest.

### Version differences

- **v1** (`0x64`): no brand field, no speed field. Still read by current
  firmware.
- **v2** (`0x65`): adds brand at page 10 and (PLA+ only, optional) a
  print-speed range at pages 23–24. Every current writer emits v2. **Write v2.**
- The 4th colour byte is `0xFF` in every genuine dump. One ACE-2-Pro-oriented
  Chinese tool claims it must be `0xD4` and that the order is `R G B D4` rather
  than `A B G R`; that same table is also off by one on the bed/diameter/weight
  pages, so treat the claim as `[OPEN]` and prefer the dumps. If a written tag
  reads back with the wrong colour on an ACE 2 Pro, this is the first thing to
  test.

## 4. The acceptance gate

`[MEASURED]` From static analysis of the ACE 2 Pro image (V1.1.31) plus
before/after flashing on hardware:

> The acceptance gate is purely structural — **there is no cryptography of any
> kind** in the RFID path. No signature, no HMAC over tag data, no MIFARE
> sector-key crypto. The only "auth" calls are the ISO 14443A anticollision
> handshake. A tag is accepted if it selects cleanly as 14443A with a valid BCC,
> and **page 4 begins `7B 00 65 00`**. … Everything after that is the plain
> Anycubic page layout. A tag written in the Anycubic layout is
> indistinguishable from a factory tag, because there is nothing to distinguish.

The header is compared against `123` as the external gate; `456` is the
firmware's internal "already validated" sentinel written back into its slot
record. Gen-1 behaviour matches: an unrecognised tag yields `rfid: 1` with empty
fields, never a rejection at the radio layer.

**Consequence:** anyone can produce acceptable tags with an ordinary NTAG213/215
and no keys. This is not a vulnerability being exploited — it is a format with
no authenticity notion at all, which is also why the vendor's own "only official
filament" behaviour is enforced by _nothing but_ the absence of tags on third
party spools.

## 5. What actually reaches the printer (and what we already read)

The ACE's own report, per slot, is the N033 surface. Anycubic documents this
part officially — the protocol document lives in the vendor's own
[ANYCUBIC-3D/Kobra3](https://github.com/ANYCUBIC-3D/Kobra3) repository
(`docs/N033料盒通信协议.md`) and is mirrored by DnG-Crafts. Fields:

| Field                           | Meaning                                                  |
| ------------------------------- | -------------------------------------------------------- |
| `index`                         | slot 0–3                                                 |
| `sku`                           | SKU string read from the tag                             |
| `brand`                         | brand string read from the tag                           |
| `type`                          | material type string read from the tag                   |
| `color`                         | `[R,G,B]` (legacy) plus `colors: [[R,G,B,A]]`            |
| `source`                        | `0` unknown, `1` RFID, `2` user-defined, `3` no material |
| `extruder_temp` / `hotbed_temp` | min/max from the tag                                     |
| `diameter`, `total`, `current`  | 1.75 mm, spool length, remaining                         |
| `rfid`                          | `0` no info, `1` failed, `2` identified, `3` identifying |

`[REPO]` This repository already reads all of it, at two layers:

- **MQTT** `multiColorBox` (`scripts/printer-property-catalog.mjs:252`):
  `slots[].index / type / sku / color / color_group / edit_status / status /
icon_type / consumables_percent`, plus ACE hardware state (`model_id` 40002 =
  ACE Pro, `temp`, `humidity`, `loaded_slot`, `feed_status`, `drying_status`).
  `edit_status` is the `source` field: **`0` = RFID tag, `1` = manually
  entered** — the direct, in-repo proof that the tag path works on this printer
  family.
- **HTTP** `ace` = `/v2/printer/getMultiColorBoxInfo`
  (`scripts/printer-http-property-catalog.mjs`, 33 fields), same slot set.
- **`extfilbox`** is the _external single-spool holder_, not the ACE: `type`,
  `color`, `loaded`, `status_type`, `current_status`. No SKU, no tag.

`printer_material_catalog` is not a tag or slot structure at all: it exposes a
**9-item hardcoded vocabulary** (`PLA, PETG, ABS, PACF, PC, ASA, HIPS, PA,
PLA SE`, `scripts/anycubic-cloud.mjs:96`) as the set of `type` values the write
paths accept. It is the writable contract, not a registry.

## 6. What is not in the protocol

`[MEASURED]/[REPORTED]` **No per-spool ID ever reaches a client.** The UID is
read by the reader, but the ACE's slot record exposes only the parsed fields;
`get_filament_info` returns no UID. SimplyPrint states this from the integrator
side: the ACE "does **not** report a unique per-spool ID — not even for tags
SimplyPrint writes", which is why it cannot auto-create or auto-assign spools the
way it does for Bambu. The UID does exist inside the slot record
(`rfid` flag at `+0x16`, a 14-char ASCII hex UID field at `+0x3C` in the
community firmware) — getting it out required a **firmware patch**.

`[MEASURED]` Temperatures in the tag are parsed but not authoritative: the
Klipper ACE driver keeps a **built-in material→temperature table** and sets
temperatures from that rather than from the tag. This is why one tool author
concluded "only the SKU and colour matter" — the bytes are there, the consumers
mostly ignore them. Slicer Next does the same, resolving to a **built-in
filament profile** by material type.

`[INFERRED]` The SKU's job is narrow and downstream: the **type string** drives
which profile the Prepare tab selects on sync; the **SKU** drives which product
name the Workbench tab shows. An unknown SKU displays as `?` in the Workbench
while still syncing correctly in Prepare — that is Molodos's documented FAQ
answer, and it is the behaviour you would predict if the SKU were looked up in a
catalogue rather than validated. See [§9](#9-what-is-actually-unsettled).

## 7. Cloud involvement

`[INFERRED, strong]` **Tag reading is entirely local.** The radio, the parser
and the slot state all live in the ACE; the printer host reads it over the local
serial/RS-485 link. Nothing in the read path needs the cloud — a printer with no
WAN link still reads tags and still shows material and colour on its screen.

The cloud sees the _result_: the printer reports slot state upward (this repo's
cloud MQTT `public/...` reports and the `ace` HTTP read are both cloud-side views
of the same slot table), and the Slicer resolves a SKU to a product entry for
display.

`[OPEN]` There is **no evidence of a writable cloud material registry** — no
endpoint that would let a user register "my filament" server-side. This repo
catalogues 9 cloud HTTP endpoints and none is a filament definition; the
material vocabulary it knows is a hardcoded 9-entry list. Conclusion: the cloud
is a **display resolver, not a registration channel**. Do not plan against it.

## 8. The Bambu analogue, and why it inverts the conclusion

The Bambu AMS case is the usual reference for "can I tag my own spools", and it
is worth stating precisely because the answer is the opposite:

|                       | Anycubic ACE                      | Bambu AMS                                     |
| --------------------- | --------------------------------- | --------------------------------------------- |
| Tag                   | NTAG213/215, MIFARE Ultralight    | MIFARE Classic 1K                             |
| Keys                  | none                              | per-tag keys derived from UID via HKDF-SHA256 |
| Integrity             | none (4-byte header only)         | RSA signature over the payload                |
| Custom tags           | **work** — several shipping tools | **impossible**; printer rejects unsigned tags |
| Community work needed | read the page layout              | derive keys, then still cannot forge          |

Sources: [Bambu-Research-Group/RFID-Tag-Guide](https://github.com/Bambu-Research-Group/RFID-Tag-Guide)
(keys are derived from the UID; tags are signed and a modified tag is rejected),
and the ACE side as cited above. The architectural lesson transfers — a
positional byte layout, a display catalogue keyed on SKU, no per-spool identity —
but the _difficulty_ does not: Bambu needed cryptanalysis, Anycubic needs a
13-page write.

## 9. What is actually unsettled

These are the claims worth not repeating as fact:

1. **"The ACE validates the SKU."** `[REPORTED]` by SimplyPrint, and
   `[REPORTED]` more strongly by another tool author ("only Anycubic SKUs can be
   used, as the ACE Pro only understands these"). It **contradicts** the
   `[MEASURED]` firmware analysis, which found the only gate to be the page-4
   header and no other comparison. `[INFERRED]` Both can be true: the ACE accepts
   any string, and the _slicer_ fails to resolve an unknown SKU, which the user
   experiences as "not recognised". Every working tool hedges by writing a real
   Anycubic SKU. **This is the single cheapest thing to settle with one tag.**
2. **Colour byte `0xFF` vs `0xD4`, and `A B G R` vs `R G B D4`.** Every genuine
   dump says `0xFF` + ABGR; one ACE-2-Pro tool says `0xD4` + RGBD4. Unresolved,
   generation-dependent at most.
3. **Antenna/reader topology** (§1). Operational rules are consistent even where
   the wiring description is not.
4. **Whether `type` is truncated to 4 characters.** One integrator says
   "4-character material type"; the HS PLA dump carries `PLA?High?Speed` in the
   same 20-byte field. The field is 20 bytes; some _consumer_ may compare only
   the first token. Note this repo's own vocabulary contains `PLA SE` (6) — a
   concrete test case.
5. **Pages 32–39.** Zero in every dump and plausibly free. `[OPEN]` whether the
   ACE tolerates non-zero bytes there. Untested; do not use as a private payload
   until proven.

## 10. Four paths to "my own filament is recognised"

### (a) Write ACE-format tags — **viable, proven, cheap**

Hardware, in order of convenience:

| Writer                                               | Notes                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| Android phone, NFC, **Web NFC in Chrome**            | zero install, no cable; the path a small in-house tool should target |
| Android/iOS app (several exist)                      | fastest to validate the format on the owner's machine today          |
| **ACR122U** / ACR1252U / ACR1552U USB reader + PC/SC | scriptable from Node via a PC/SC binding; the desktop path           |
| ESP32/ESP8266/Pico W + RC522                         | standalone, no PC; the reference implementation exists               |

Data to write: the 13 page-writes in §3, v2 header, real-or-plausible Anycubic
SKU, type ≤4 chars, ABGR colour, temps from our own profile. Tags: 2 per spool,
one per face. Cost: ~USD 0.30–0.64 per spool for NTAG213 stickers.

**Licence note (binding, per house policy).** The _format_ is a fact and can be
implemented clean-room from the byte table above. The _code_ in the community
projects is not automatically reusable: verify each repository's licence before
copying anything; if it is GPL/AGPL, study behaviour and re-implement. No licence
was verified for this document.

### (b) Override slot → material over MQTT — **viable, already in the repo, limited**

`multiColorBox/setInfo` accepts
`{multi_color_box: [{id, slots: [{index, type, color: [r,g,b]}]}]}` and is the
legitimate "manual filament" path — the same thing the touchscreen does. This
repo already has both halves: `setAceSlot()` in `scripts/anycubic-cloud.mjs:464`
and the `ace_set_slot` bus command
(`scripts/printer-command-bus-catalog.mjs:16`, `safety: state`,
`evidence: mapping` — **no live validation exists**).

Limits, and they are structural: the payload has **no `sku` field**, so the slot
becomes `edit_status: 1` / `source: 2` — a manual filament with a type and a
colour, not a product. It also cannot survive a tag read: put a tag in the slot
and the ACE's own value is what the slot reports. It is a good fallback and a
good _complement_, not a substitute.

### (c) Cloud-side material registry — **does not exist**

See §7. Nothing to build against.

### (d) Patch the ACE firmware — **rejected for this goal**

Community firmware exists and can be made to parse arbitrary tag formats
(OpenSpool NDEF, Bambu, vendor-specific), and gen-1/ACE 2 can both be flashed
(this is how the UID gets exposed at all). It is also: a hardware-bricking
operation, version-locked to one image, and **gains nothing here** — a native
Anycubic-format tag is already indistinguishable from factory, so the patch buys
foreign _formats_, not custom _filaments_. Keep it as a documented possibility,
not a plan.

## 11. Recommendation

**Write tags. (a) as the product path, (b) as the no-hardware fallback.**

Staged, with the decision gate first because it is nearly free:

- **Phase 0 — settle it in one tag (30 min, no code).** Take one NTAG215, write
  it with any existing app: type `PETG`, a real PETG SKU, a colour, and a
  deliberately wrong temperature range. Load it. Then check, in this order:
  (i) `edit_status == 0` and `type`/`color` match what was written →
  the tag path is confirmed on the owner's hardware; (ii) whether the slicer's
  Prepare tab selects a PETG profile and the Workbench shows a product or `?` →
  settles §9.1 (SKU resolution vs validation) and the value of chasing exact
  SKUs; (iii) whether the wrong temperature range changes anything downstream →
  settles whether temps are worth writing carefully. Read the slot through
  `printer_read_all`, not through the printer screen: the raw `edit_status` is
  the evidence.
- **Phase 1 — in-repo encoder/decoder, no hardware.** A pure module
  `tags → fields` and `fields → 44 bytes`, with the three published dumps as
  fixtures (v1 Spring Leaf, v2 Bright White, HS PLA) and a round-trip test. This
  is where the format lives; it is testable offline and it is the piece every
  later transport shares.
- **Phase 2 — one writer transport.** Web NFC page (Android Chrome, zero
  install) first; ACR122U behind a small CLI second. Both consume Phase 1.
- **Phase 3 — catalogue.** Material type (≤4 chars, from the 9-item vocabulary
  where it applies), SKU (real Anycubic SKU per material, or the documented
  `AH/PL…-1NN` pattern), ABGR colour, temps and length from the owner's own
  filament profiles rather than the generic table.
- **Phase 4 — read-back verification.** Re-read the tag after writing and assert
  the bytes; a write that was not read back is a claim, not a fact.
- **Never**: pages 0–3, the NTAG lock/config pages (NTAG213 41–44, NTAG215
  130–134), or two tags on the same face.

Non-claims to keep in the report: this document did not write a tag, did not
verify SKU validation, did not verify the `0xD4` variant, and did not test
non-zero bytes at pages 32–39.

## References

Primary, measured:

- DnG-Crafts/ACE-RFID — page layout, tag types, ACE response shape, Arduino
  reference writer: <https://github.com/DnG-Crafts/ACE-RFID>
- Molodos/anycubic-nfc-filament — byte-for-byte dumps of v1/v2/HS tags, SKU
  list, Workbench `?` behaviour: <https://github.com/Molodos/anycubic-nfc-filament>
  and <https://github.com/Molodos/anycubic-nfc-filament/blob/main/format.md>
- Simon-CR/ace2-pro-firmware-research — firmware analysis, **"no cryptography of
  any kind"**, header gate, MFRC522 clone, Bambu read-only proof:
  <https://github.com/Simon-CR/ace2-pro-firmware-research> and
  <https://github.com/Simon-CR/ace2-pro-firmware-research/blob/master/docs/03-rfid-and-tags.md>
- Kobra-S1/ACEPRO `PROTOCOL.md` — gen-1 USB CDC framing, `get_filament_info`
  fields, `enable_rfid`/`disable_rfid`, the material→temperature table:
  <https://github.com/Kobra-S1/ACEPRO/blob/dev/PROTOCOL.md>
- Godless50/ACE-PRO-v1.-NFC-UID — slot record layout, UID extraction, firmware
  patch, and the correction that supersedes the antenna-pairing model:
  <https://github.com/Godless50/ACE-PRO-v1.-NFC-UID>
- N033 material box protocol (vendor document, mirrored):
  <https://github.com/DnG-Crafts/ACE-RFID/blob/main/docs/N033%20Material%20box%20communication%20protocol.md>

Practitioner and integrator:

- SimplyPrint, "The Anycubic material standard" — tag types, page table, **no
  per-spool ID**, SKU validation claim:
  <https://help.simplyprint.io/en/article/the-anycubic-material-standard-nfcrfid-for-the-anycubic-ace-js3oty/>
- mrRobot62/AnycubicNFCTaggerQT5 — SKU-centric behaviour, a full raw dump,
  "only Anycubic SKUs" claim: <https://github.com/mrRobot62/AnycubicNFCTaggerQT5>
- mrRobot62 SKU structure: <https://github.com/mrRobot62/anycubic_filament_sku_sniffer/blob/main/SKU_DEMYSTIFY.md>
- OrochW/Anycubic-ACE-RFID-Tool — the unverified `0xD4` / RGBD4 variant:
  <https://github.com/OrochW/Anycubic-ACE-RFID-Tool>
- Hoffman Engineering, phone-writing walkthrough, two tags per spool:
  <https://www.hoffman.engineering/blog/how-to-write-anycubic-ace-pro-rfid-tags-with-your-phone/>
- Tag dump + UID/manufacturer detail (Shanghai Feiju NTAG213):
  <https://github.com/printers-for-people/ACEResearch/issues/10>

Analogue, for architecture only:

- Bambu-Research-Group/RFID-Tag-Guide — HKDF keys, RSA signature, "custom tags:
  no": <https://github.com/Bambu-Research-Group/RFID-Tag-Guide>

In-repo:

- `docs/printer-property-map.md` — `multiColorBox`/`extfilbox` read surface,
  `setInfo` as the manual-filament path.
- `scripts/printer-property-catalog.mjs` — MQTT slot fields and command map.
- `scripts/printer-http-property-catalog.mjs` — the 33-field `ace` endpoint.
- `scripts/anycubic-cloud.mjs` — `MATERIAL_TYPES`, `setAceSlot`.
- `scripts/audit-gap-tools.mjs` — `printer_material_catalog`.
