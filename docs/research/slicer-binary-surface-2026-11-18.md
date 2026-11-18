# Anycubic Slicer Next 2.0.0.3 — binary surface recovery (2026-11-18)

**Status:** protocol research record. Static reverse engineering of the installed
slicer, plus one short authorised dynamic run. **No command was sent to a
printer**; the dynamic run only started the app, let it authenticate against the
cloud broker, and closed it. Every string quoted below carries its file and
offset so the claim is re-checkable.

**Artifact under study**

| Item               | Value                                                                                                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product version    | `2.0.0.3` (`resources/build-version.txt`)                                                                                                                                                                                                                                             |
| Build timestamp    | `20260904033759` (`resources/build-timestamp.txt`)                                                                                                                                                                                                                                    |
| Install root       | `C:\Program Files\AnycubicSlicerNext`                                                                                                                                                                                                                                                 |
| Binaries inspected | `AnycubicSlicer.dll` (72 MB), `cloud_sdk_cpp.dll` (8.6 MB), `cloud_mqtt.dll` (4.2 MB), `mach_mqtt.dll` (1.1 MB), `MachMQTT.dll` (3.2 MB), `mqtt_client.dll` (4.2 MB), `common_encrypt.dll`, `Workbench.dll` (39 MB), `RequestFilter.dll`, `AnycubicSlicerNext.exe`, `reason_code.dll` |
| Resources          | `resources/` — 2 361 plain files, **no `.rcc`, `.pak`, `.zip` or `.qm` bundle**: nothing compressed, nothing to unpack                                                                                                                                                                |
| Method             | dual-encoding string extraction (ASCII `[\x20-\x7e]{5,}` + UTF-16LE pairs), deduped per file, indexed by offset                                                                                                                                                                       |

**Sanitisation.** No account identifier, printer key, token, LAN IP or broker IP
appears here. The installer-shipped OAuth client id and the public cloud
hostnames are reproduced because they are app-level constants needed to drive
the flow, not user credentials. Runtime artefacts are described by role with
`<...>` placeholders.

---

## TL;DR — what is new

| Surface               | In the binary | Known to this repo | **New** |
| --------------------- | ------------- | ------------------ | ------- |
| Cloud HTTP endpoints  | 93            | 31 implemented     | **70**  |
| Local HTTP routes     | 51            | 0                  | **51**  |
| MQTT command types    | 21            | 12                 | **14**  |
| MQTT actions          | 56            | 26 distinct        | **38**  |
| MQTT report structs   | 31            | —                  | **31**  |
| NFC / RFID anything   | **0**         | —                  | —       |
| Order ids (1200–1260) | **0 as data** | 7 + `COMMAND_MAP`  | —       |

The three findings that change how we build:

1. **The slicer exposes its own MQTT as an HTTP API** (`/api/v1/mach_mqtt/publish`,
   `/api/v1/cloud_mqtt/publish`) on a loopback server, complete with TLS material
   injection. That is a supported-in-binary generic command channel, not a
   reverse-engineered one.
2. **`cloud_sdk_cpp.dll` carries the entire cloud API as a contiguous, ordered
   table** (offsets `6549640`–`6552896`). It is the authoritative endpoint list
   and it is 3× larger than what we implemented.
3. **There is no NFC or RFID code in this product.** Not a hidden feature, not a
   disabled one — the stack is absent. The ACE is a dumb slot box driven over
   MQTT with manual material mapping.

---

## 1. Cloud HTTP API — the SDK owns the whole surface

All cloud calls go through `cloud_sdk_cpp.dll`, which registers each endpoint as
a reflection-annotated request/response pair. The paths sit in **one contiguous
string block** at `cloud_sdk_cpp.dll` `6549640`–`6552896`, in registration order —
this is a table dump, not a string-pool coincidence.

Split by family: `/v2` 20 · `/v5` 17 · `/work` 16 · `/farm` 13 · `/user` 12 ·
`/v3` 10 · `/portal` 5 → **93 endpoints**, plus the two base paths
`/p/t/workbench/api` (test) and `/p/p/workbench/api` (production) at `6549640`
and `6549664`.

### 1.1 New endpoints (70)

Grouped by family; offset is the string's file offset in `cloud_sdk_cpp.dll`.

**`/farm/*` — 12 new of 13, the multi-printer ("farm") product line. `file/info`
is the only one this repo already touches.**

| Endpoint                         | Offset  |
| -------------------------------- | ------- |
| `/farm/printer/createBulkTask`   | 6551632 |
| `/farm/device/createBulkTask`    | 6551912 |
| `/farm/printer/setCleanPlate`    | 6551848 |
| `/farm/group/list`               | 6551672 |
| `/farm/file/info`                | 6551696 |
| `/farm/message/list`             | 6552376 |
| `/farm/message/info`             | 6552400 |
| `/farm/message/latest`           | 6552496 |
| `/farm/message/printerErrorList` | 6552424 |
| `/farm/message/statistics`       | 6552568 |
| `/farm/message/read`             | 6552600 |
| `/farm/message/delete`           | 6552464 |
| `/farm/message/bulkDelete`       | 6552624 |

**`/v5/*` — 16 new of 17, the current-version API. Our repo touches exactly one of
them (`/v5/project/printHistory/detail`).**

| Endpoint                                       | Offset  | Note                                    |
| ---------------------------------------------- | ------- | --------------------------------------- |
| `/v5/machine_material/getColorGroupListByUser` | 6552088 | user colour groups                      |
| `/v5/machine_material/addUserColorGroup`       | 6552144 | **write**                               |
| `/v5/machine_material/editUserColorGroup`      | 6552192 | **write**                               |
| `/v5/machine_material/deleteUserColorGroup`    | 6552240 | **destructive**                         |
| `/v5/printer/properties/query`                 | 6551808 | property mirror of the MQTT report tree |
| `/v5/printer/file/thumbnail/list`              | 6552336 |                                         |
| `/v5/project/info`                             | 6551888 |                                         |
| `/v5/project/list`                             | 6552872 |                                         |
| `/v5/project/source`                           | 6552896 |                                         |
| `/v5/mqtt/status/report`                       | 6552656 | cloud-side MQTT status relay            |
| `/v5/alarm_message/batchSetRead`               | 6552528 |                                         |
| `/v5/cloud-file/folder/create`                 | 6552688 |                                         |
| `/v5/cloud-file/folder/delete`                 | 6552728 |                                         |
| `/v5/cloud-file/folder/rename`                 | 6552768 |                                         |
| `/v5/cloud-file/folder/list`                   | 6552840 |                                         |
| `/v5/cloud-file/item/move`                     | 6552808 |                                         |

**`/v3/*` — 7 new of 10.**

| Endpoint                                     | Offset  | Note                                                        |
| -------------------------------------------- | ------- | ----------------------------------------------------------- |
| `/v3/material/getTypeNameAndSkuListByVerNum` | 6551328 | **the filament catalogue**: type name + SKU list, versioned |
| `/v3/printer/sendFile`                       | 6551720 |                                                             |
| `/v3/engine/getLatestVersion`                | 6551440 |                                                             |
| `/v3/user/getSlicerConfig`                   | 6551568 | cloud-synced slicer settings                                |
| `/v3/user/setSlicerConfig`                   | 6551600 | **write**                                                   |
| `/v3/work_project/feedback`                  | 6552016 |                                                             |
| `/v3/public/getoauthToken`                   | 6551296 | named in the lane brief, never implemented here             |

**`/v2/*` — 11 new of 20.**

| Endpoint                                     | Offset            | Note                                            |
| -------------------------------------------- | ----------------- | ----------------------------------------------- |
| `/v2/printer/getExternalShelves`             | 6551216           | **ACE external spool shelves**                  |
| `/v2/device/getPrintOption`                  | 6551384           |                                                 |
| `/v2/device/save`                            | 6551416           | **write**                                       |
| `/v2/message/getMessageCount`                | 6550840           | named in the lane brief, never implemented here |
| `/v2/message/getMessages`                    | 6550808           |                                                 |
| `/v2/message/hasNewMessage`                  | 6550936           |                                                 |
| `/v2/message/setRead` / `setReadById`        | 6550912 / 6550880 |                                                 |
| `/v2/message/delete`                         | 6550968           |                                                 |
| `/v2/cloud_storage/getPreSignUrlArrWithName` | 6551512           |                                                 |
| `/v2/network_plugin/info`                    | 6551776           |                                                 |

**`/work/*` — 8 new of 16.**

| Endpoint                      | Offset  | Note                                            |
| ----------------------------- | ------- | ----------------------------------------------- |
| `/work/printer/info`          | 6550216 | printer detail; we only ever read `getPrinters` |
| `/work/printer/unsetprinters` | 6549976 | **destructive** (unbind)                        |
| `/work/work/addprinter`       | 6549944 | **write** (bind)                                |
| `/work/project/report`        | 6550744 |                                                 |
| `/work/project/unsetprojects` | 6550992 | **destructive**                                 |
| `/work/index/getUploadStatus` | 6550632 | upload state machine                            |
| `/work/index/renameFile`      | 6550384 |                                                 |
| `/work/index/delFiles`        | 6550416 | **destructive**                                 |

**`/user/*` — 11 new of 12, the whole account lane. We implement one
(`/v1/user/profile/userInfo`, which the SDK registers plainly as
`/user/profile/userInfo`).**

| Endpoint                                 | Offset  |
| ---------------------------------------- | ------- |
| `/user/public/login`                     | 6549688 |
| `/user/public/logout`                    | 6549712 |
| `/user/public/register`                  | 6549736 |
| `/user/public/check_nickname`            | 6549768 |
| `/user/public/passwordReset`             | 6549808 |
| `/user/public/getIpAddress`              | 6551152 |
| `/user/verification_code/newSend`        | 6549840 |
| `/user/profile/newUploadFile`            | 6550048 |
| `/user/profile/userInfo`                 | 6551184 |
| `/user/cloud_storage/getTcCosTempToken`  | 6550304 |
| `/user/cloud_storage/lockStorageSpace`   | 6550088 |
| `/user/cloud_storage/unlockStorageSpace` | 6550136 |

**`/portal/*` — 5, the unauthenticated pre-login surface.**

| Endpoint                    | Offset  |
| --------------------------- | ------- |
| `/portal/index/country`     | 6550240 |
| `/portal/index/country_hot` | 6550272 |
| `/portal/index/feedback`    | 6550016 |
| `/portal/index/reason`      | 6551056 |
| `/portal/index/get_version` | 6551480 |

### 1.2 Base paths and the OAuth lane

`cloud_sdk_cpp.dll` `6549640` / `6549664`:

```
/p/t/workbench/api   <- test
/p/p/workbench/api   <- production
```

The shipped `resources/cloud/cloud_profile.ini` pins the rest of the environment:

| Key                            | Value                                                       |
| ------------------------------ | ----------------------------------------------------------- |
| `cloud_platform_api_en`        | `https://cloud-universe.anycubic.com/p/p/workbench/api`     |
| `cloud_platform_api_cn`        | `https://cloud-platform.anycubicloud.com/p/p/workbench/api` |
| `casdoor_base_url_en`          | `https://uc.makeronline.com/login/oauth/authorize`          |
| `casdoor_client_id_en` / `_cn` | `b269a3136d26ac6488bb`                                      |
| `casdoor_scheme_en` / `_cn`    | `acnext` / `acnextcn`                                       |
| `work_bench_base_en`           | `https://cloud-universe.anycubic.com/w/p/AcOrcaWeb`         |
| `makeronline_url_en`           | `https://www.makeronline.com`                               |

`b269a3136d26ac6488bb` is an installer-shipped public OAuth client id (PKCE
desktop flow), not a user secret. The local OAuth redirect is
`http://localhost:21328/callback` (`AnycubicSlicer.dll` `56216104`).

### 1.3 Endpoints this repo uses that the 2.0.0.3 SDK does **not** register

Eight. These are community discoveries against older builds, and two of them are
near-duplicates of a registered path with different casing — the highest-value
retirement candidates:

| Repo path                               | SDK analogue                  | Verdict                      |
| --------------------------------------- | ----------------------------- | ---------------------------- |
| `/v2/Printer/status`                    | `/v2/printer/printersStatus`  | near-duplicate, wrong casing |
| `/work/printer/printersStatus`          | `/v2/printer/printersStatus`  | same resource, wrong prefix  |
| `/v2/printer/all`                       | —                             | unregistered                 |
| `/v2/printer/functions`                 | —                             | unregistered                 |
| `/v2/project/monitor`                   | —                             | unregistered                 |
| `/v1/user/profile/userInfo`             | `/user/profile/userInfo`      | wrong prefix                 |
| `/work/printer/edit`                    | —                             | unregistered                 |
| `/work/printer/getPrinterUpdateVersion` | `/v3/engine/getLatestVersion` | superseded                   |

Also: **`/cloud/print-local` does not exist in 2.0.0.3.** No string in any binary
or resource matches `print-local`, `printLocal` or `cloud/print`. If a bridge by
that name is live, it is ours, not theirs.

---

## 2. Local HTTP API — a second surface nobody documented (51 routes)

`AnycubicSlicer.dll` runs a `Slic3r::GUI::HttpServer` during app start
(`start_http_service...`, `http_server`, `56273064` / `56273048`) and serves the
embedded workbench web UI (`resources/web/anycubic/anycubic_workbench.html`).
The route table is one block, offsets `56694168`–`56807376`.

| Group                                           | Routes | What it is                                                |
| ----------------------------------------------- | ------ | --------------------------------------------------------- |
| `/api/v1/mach_mqtt/*`                           | 10     | **generic printer MQTT client**                           |
| `/api/v1/cloud_mqtt/*`                          | 8      | **generic cloud MQTT client**                             |
| `/api/v1/app/*`                                 | 12     | UI bridge (toasts, config, colour picker, message centre) |
| `/api/v1/downloader/*`                          | 7      | file import/export for the web UI                         |
| `/api/v1/FramSelectGcodeFile/*`                 | 5      | farm print dispatch                                       |
| `/api/v1/account/*`                             | 5      | login/logout state                                        |
| `/api/v1/ssdp/*`                                | 2      | LAN printer discovery                                     |
| `/api/files/TempUpload`, `/api/slicer/resource` | 2      |                                                           |

### 2.1 The MQTT bridge is the important find

```
/api/v1/mach_mqtt/create     56805960    params: identity, clientid, Certificate,
/api/v1/mach_mqtt/destroy    56805992            PrivateKey, KeyStore
/api/v1/mach_mqtt/connect    56806088    params: url, device_type, username, password
/api/v1/mach_mqtt/disconnect 56806120
/api/v1/mach_mqtt/subscribe  56806152    params: topic
/api/v1/mach_mqtt/publish    56806184    params: topic, payload
/api/v1/mach_mqtt/unsubscribe 56806216
/api/v1/mach_mqtt/connected  56806248
/api/v1/mach_mqtt/event_call 56806280
/api/v1/mach_mqtt/data_call  56806312
/api/v1/cloud_mqtt/publish   56804912    params: topic, payload
/api/v1/cloud_mqtt/subscribe 56804776    params: topic
```

The app hands the web UI a complete MQTT client: create a connection with an
arbitrary identity and TLS material, connect, subscribe to any topic, publish any
payload. The param log line spells the whole contract out
(`AnycubicSlicer.dll` `56806384`):

```
identity={},url={},device_type={}, username=***,password=***,clientid={}
```

We already hold the same capability one library down (we speak MQTT directly), so
this is not a shortcut we need. Its value is **confirmatory**: it proves the
official client treats `publish {topic, payload}` as a first-class operation with
no per-command allowlist, which is why the reverse-engineered command bus works at
all. It also means the app's own surface area for a hostile local process is a
generic publish primitive — worth knowing before anyone ships a plugin host.

### 2.2 Farm dispatch from the app

```
/api/v1/FramSelectGcodeFile/showSelectDialog
/api/v1/FramSelectGcodeFile/sendGcodeCreateBulkTask     params: filePath, taskType
/api/v1/FramSelectGcodeFile/sendCloudFileIdBulkTask
/api/v1/FramSelectGcodeFile/sendLanPrinterOperate       params: opterateType  [sic]
/api/v1/FramSelectGcodeFile/sendLanPrintersList         params: printerLists
```

`RemoteManger` (the class behind all of this) exposes
`SendBulkTask`, `SendRemotePrint`, `SetPrinterInfo`, `GetPrinterTaskSettingInfo`,
`GetPrinterPeripherieInfo`, `GetMultiColorBoxInfo`, `GetCloudModelSlicerInfo`
(`AnycubicSlicer.dll` `55012576`–`55017664`). `GetPrinterTaskSettingInfo` is a
read we do not implement.

---

## 3. MQTT

### 3.1 Topics and namespaces

Four topic templates exist, in three DLLs:

| Template                                            | File             | Offset  | Role                                        |
| --------------------------------------------------- | ---------------- | ------- | ------------------------------------------- |
| `anycubic/anycubicCloud/v1/slicer/printer/{}/{}/{}` | `cloud_mqtt.dll` | 3193728 | **publish**, slicer namespace (new)         |
| `anycubic/anycubicCloud/v1/slicer/printer/{}/{}/{}` | `mach_mqtt.dll`  | 904016  | same template, machine side                 |
| `anycubic/anycubicCloud/v1/+/public/{}/{}/#`        | `cloud_mqtt.dll` | 3193792 | **subscribe**, wildcard model segment (new) |
| `anycubic/anycubicCloud/v1/printer/public/{}/{}/#`  | `mach_mqtt.dll`  | 904080  | subscribe, model known                      |

Two things to note:

- The **`slicer/` namespace** is new to us. Our current map publishes on
  `pc/printer/...` (cloud) and `web/printer/...` (LAN). The SDK publishes on
  `slicer/printer/...`. Either `pc/` is a second accepted write namespace or our
  cloud publishes have been landing in a namespace the firmware merely tolerates.
  This is the single cheapest thing to test next: publish the same `info:query`
  on both namespaces and compare the report latency.
- The **wildcard subscribe** `v1/+/public/...` means the client does not need to
  know the model segment to receive public reports. Our per-model subscription is
  stricter than theirs.

Connection lifecycle is logged, not hidden — so a future dynamic capture needs no
disassembly (`AnycubicSlicer.dll` `56692336`–`56692704`):

```
connect url: {}      subscribe topic: {}      on_message topic: {}, payload: {}
ceate cloud mqtt: {} publish topic: {}, payload: {}    cloud mqtt connected status: {}
```

(In 2.0.0.3 those lines are compiled to a level the shipped log config does not
emit; a run today produced the TLS material but no topic lines — see §7.)

### 3.2 The authoritative type registry — 21 types

`cloud_mqtt.dll` `3194984`–`3195304`, mirrored in `mach_mqtt.dll`
`880712`–`881032`. Source file named in the binary:
`cloud_sdk_src/cloud_mqtt/cloud_mqtt_constant.cpp`.

```
print  tempature  filament  screenSaver  levelling  preheating  status  video
network  exposure  lastWill  residual  airpure  releaseFilm  smartResinVat
resin  autoOperation  multiColorBox  light  extfilbox  peripherie
```

Known to us: `print`, `tempature`, `light`, `multiColorBox`, `extfilbox`,
`video`, `peripherie` (7 of 21).

**New types (14):**

| Type                                                                                   | Line                           | Why it matters                                              |
| -------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `filament`                                                                             | filament/report                | **a dedicated filament report we have never subscribed to** |
| `status`                                                                               | FDM status channel             |                                                             |
| `preheating`                                                                           | preheat state machine          |                                                             |
| `levelling`                                                                            | auto-bed-levelling             |                                                             |
| `screenSaver`                                                                          | panel control                  |                                                             |
| `network`                                                                              | `getSignalStrength` lives here | WiFi diagnostics                                            |
| `autoOperation`                                                                        | auto-op state machine          |                                                             |
| `lastWill`, `exposure`, `residual`, `airpure`, `releaseFilm`, `smartResinVat`, `resin` | resin (SLA) line               | not FDM, but `airpure` is sold for FDM too                  |

**Types we use that the registry does not contain (5):** `fan`, `axis`,
`aiSettings`, `file`, `info`. These are _not_ protocol types in the SDK — our
topic strings put them where a type goes, and the firmware accepts them. They are
either firmware-side aliases or community inventions that happen to work. Worth
confirming against a report capture before we document them as canonical.

### 3.3 The authoritative action registry — 56 actions

Same offsets, immediately after the types. 26 of ours overlap by name, 4 are
variants of ours (`move` → `moveToCoordinates`, `setSpeed` → `setInfo`,
`switch` → `control`, `auto` → `setAutoFeed`), and **38 are new**:

```
report  queryInfo  reportStatus  reportAutoFeedInfo  feedResin  cyclicCleaning
reportInfo  reset  reportVersion  updateSuccessProcessed  updateFailedProcessed
downloading  updating  canceled  update-success  update-failed  download-failed
onlineReport  clean  cancel  moveToCoordinates  getSignalStrength  workReport
deleteBatch  cloudRecommendList  videoThumbnailList  fileDetails  renameFile
listVideo  deleteVideo  ignore  monitor  reDetect  replace  autoUpdateDryStatus
finishFeedFilament  refresh  autoUpdateInfo
```

Grouped by intent:

- **File lane (we have only 6 of 14):** `listLocal`, `listUdisk`, `deleteLocal`,
  `deleteUdisk`, `deleteBatch`, `fileDetails`, `renameFile`, `listVideo`,
  `deleteVideo`, `videoThumbnailList`, `cloudRecommendList`, `replace`.
  `deleteBatch` appears **only** in `cloud_mqtt.dll` (`3195888`), not in
  `mach_mqtt.dll` — a cloud-only bulk delete.
- **Print control:** `pause`, `resume`, `ignore` (skip object), `monitor`,
  `reDetect` (re-run AI detection), `onlineReport`, `workReport`.
- **ACE / box:** `getInfo`, `setInfo`, `autoUpdateInfo`, `setDry`, `setAutoFeed`,
  `autoUpdateDryStatus`, `feedFilament`, `finishFeedFilament`.
  `finishFeedFilament` is new — feed has a two-phase completion we do not model.
- **Resin/SLA:** `feedResin`, `cyclicCleaning`, `clean`, `cancel`, `reset`.
- **OTA:** `reportVersion`, `update`, `updateSuccessProcessed`,
  `updateFailedProcessed`, `downloading`, `updating`, `canceled`,
  `update-success`, `update-failed`, `download-failed`.

### 3.4 Report structs — 31, and they define the property tree

`AnycubicSlicer.dll`, MSVC RTTI, namespace `mach_mqtt::FDM::Report` (e.g.
`.?AUExtFilBoxResponse@Report@FDM@mach_mqtt@@` at `67988608`):

```
AutoOpStatus  AxisMove  ExtFilBox  FilamentType  FileDelete  FileDetail  FileList
FileRename  File  FilterElement  Info  Light  MCBDryStatus  MultiBoxInfo  NetworkQuery
OTAUpgrade  OTAVersion  Peripherie  PrintCommon  PrintDownloading  PrintIgnore
PrintMonitoring  PrintPreheating  PrintPrinting  PrintRetect  PrintUpdate  Resin
SmartBox  Tempature  VideoDelete  VideoList
```

Four are new capability areas for us: `FilamentType` (what filament types the
machine can report), `FilterElement` (air filter life — pairs with `airpure`),
`SmartBox` (a box product with its own report), `MCBDryStatus` (drying state as a
separate struct, not a field of `MultiBoxInfo`).

The full property vocabulary is the reflection table at `mach_mqtt.dll`
`882960`–`884456`; the ACE-relevant subset is in §4.

---

## 4. ACE, filament identity, and the NFC question

### 4.1 What the slicer's ACE model actually is

The toolchange G-code in the Kobra X / Kobra 4 machine profiles carries the whole
model (`resources/profiles/Anycubic/machine/Anycubic Kobra X 0.4 nozzle.json`,
`change_filament_gcode`):

```
{ if magic_mask_with_box == -1392
     && size(filament_type) > 0
     && size(filament_type) == size(ace_t_box_vector)
     && size(filament_type) == size(ace_t_slot_vector) }
  { local is_curr_in_box = ace_t_box_vector[curr_t] >= 0 ? true : false }
```

| Fact                                                            | Evidence                                                                                                                    |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Per-tool arrays `ace_t_box_vector[t]`, `ace_t_slot_vector[t]`   | `AnycubicSlicer.dll` `54421312`, `54421408`, `54421504`                                                                     |
| Box index `>= 0` = in an ACE box; `< 0` = external spool holder | `ace_t_box_vector[curr_t] >= 0`                                                                                             |
| **4 slots per box**                                             | `0 < ace_t_slot_vector[..] && <= 4`                                                                                         |
| Multi-box is supported, with distinct transition timing         | branches on `curr_box != next_box`                                                                                          |
| The six physical transitions are pre-timed constants            | rack→rack `M400 P0`, rack→box `P40409`, box→rack `P51591`, 4-in-4→box `P2700`, box→box `P91279`, box→different box `P93746` |

Those `M400 P<n>` values are host-side dwell times for the mechanical transfer,
not commands. They are the empirical constants nobody has documented.

**Gap worth naming:** `ace_t_*` exists **only** in `Anycubic Kobra X` and
`Anycubic Kobra 4` profiles. The owner's `Anycubic Kobra S1` profiles do not
reference it — on the S1 the box/slot decision is not in the G-code at all. Any
ACE work targeting the S1 has to drive the box through MQTT, not through the
toolchange script.

### 4.2 Filament identity, as the product models it

| Field                                                                               | Where                                | Meaning                                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------- |
| `filament_id`                                                                       | preset files, e.g. `"GFTPU for ACE"` | preset-level id, `GF` + type + qualifier (Bambu-derived format) |
| `material_type`, `material_tid`, `material_name`, `material_unit`                   | `cloud_sdk_cpp.dll` request structs  | cloud material catalogue identity                               |
| `/v3/material/getTypeNameAndSkuListByVerNum`                                        | SDK `6551328`                        | the catalogue itself: type names + SKUs, version-keyed          |
| `ams_index`, `ams_color`, `ams_box_mapping`, `use_ams`, `ams_settings`              | `mach_mqtt.dll` `884320`–`884456`    | slot binding on the command side                                |
| `solt_color_material_match` [sic]                                                   | `cloud_sdk_cpp.dll` `6581488`        | **slot → colour → material match**, saved with the print order  |
| `color_group`, `slots`, `loaded_slot`, `slot_index`, `auto_feed`, `multi_color_box` | `mach_mqtt.dll` `905784`–`906000`    | report side                                                     |
| `multi_color_box_dry_status`                                                        | `cloud_sdk_cpp.dll` `6599616`        | drying as a top-level status                                    |
| `external_shelves`                                                                  | `cloud_sdk_cpp.dll` `6592848`        | external spool holders (see `/v2/printer/getExternalShelves`)   |

And the app keeps its own slot memory in `%APPDATA%\AnycubicSlicerNext\AnycubicSlicerNext.conf`:

```json
"ams_filament_ids": { "<32-hex filament fingerprint>": "1,2,3,4" }
```

A filament fingerprint mapped to the slot list it occupies. That is the closest
thing in the shipped product to "the machine knows this spool" — and the key is a
**content hash of the preset**, not a tag read.

`/v5/machine_material/{add,edit,delete}UserColorGroup` +
`getColorGroupListByUser` is the write path for user-defined colour groups: how a
user tells the cloud "these four slots hold these four materials". That is the
API a custom-filament feature would extend.

### 4.3 NFC / RFID: negative result, with the evidence

Searched every binary (ASCII + UTF-16LE) and all 2 361 resource files for
`nfc`, `rfid`, `tag_id`, `tagId`, `spool id`, `ISO15693`, `13.56`, `MIFARE`,
`NDEF`, `SLIX`, `NTAG`, `OpenPrintTag`, `eeprom`, `i2c`.

| Result                                   | Detail                                                                                                           |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| NFC/RFID protocol code                   | **none**                                                                                                         |
| Tag reader driver, COM/SPI/I²C reference | **none**                                                                                                         |
| Filament-tag field in any struct         | **none**                                                                                                         |
| Incidental matches                       | `ASN1_OCTET_STRING_NDEF`, `BIO_new_NDEF` (OpenSSL ASN.1), `wxHtmlWinTagHandler`, random hex runs — all unrelated |

The only "tag" strings in the tree are `wxHtmlWinTagHandler` and OpenSSL's
`ndef_*` ASN.1 internals. There is no route by which this app reads a spool tag,
and therefore no hidden protocol to unlock: **ACE filament recognition is not a
disabled feature of the official slicer.**

What the product does instead, and what the owner's goal has to be built on:

1. A **cloud material catalogue** (`/v3/material/getTypeNameAndSkuListByVerNum`)
   keyed by type name + SKU.
2. A **per-print slot↔material match** (`solt_color_material_match`,
   `ams_box_mapping`).
3. A **user colour-group write path** (`/v5/machine_material/*UserColorGroup`).
4. A **local fingerprint→slots map** (`ams_filament_ids`).

So "ACE recognises a custom filament" is achievable today **without any tag**: assign
the spool to a slot, record the material identity through the colour-group /
print-order fields, and the slicer-side `filament_id` decides the process
settings. A physical NFC tag would be our addition on top of a product that has
no concept of one — which is good news for clean-room work, and means there is no
vendor protocol to interoperate with.

### 4.4 Filament-type reporting we never asked for

`FilamentTypeResponse` (`mach_mqtt.dll` RTTI via `AnycubicSlicer.dll`) plus the
`filament` command type imply the machine can enumerate the filament types it
supports. Combined with `dryEnable`, `flowCalibration`, `resonance`,
`photography` and `extfilboxMulticolorModelSuport` — the printer capability flags
at `AnycubicSlicer.dll` `56241688`–`56241776` — that is a capability-negotiation
surface we currently hardcode.

---

## 5. Order ids: negative result

The lane brief lists `1216/1227/1235-1237/1254/1260` as recovered ids. They are
**not present as data in 2.0.0.3**:

| Probe                                                                                                   | Result                                                           |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ASCII strings equal to `1000`–`1300` in the four MQTT/cloud DLLs                                        | 0                                                                |
| Ascending int32 runs in `1190`–`1280` across `cloud_sdk_cpp.dll`, `AnycubicSlicer.dll`, `mach_mqtt.dll` | 1 hit, in a Unicode table (false positive)                       |
| `push imm32` opcodes with `1190 <= v <= 1280`                                                           | 10 hits, none clustered; all in data/PE regions                  |
| `order_id` field                                                                                        | exists (`cloud_sdk_cpp.dll` `6580544`), value is caller-supplied |

The `order_id` field is real — it sits in the print-order request struct next to
`ams_index`, `ams_box_mapping`, `material_type`, `paint_color`, `ams_color`
(`6580544`–`6580648`) — but the official client does not carry a table of ids, so
there is nothing to diff against. Our enum stays a community artefact and should
keep its "unvalidated" label. Note the number range that _does_ line up: our
`MULTI_COLOR_BOX_DRY/SET_SLOT/FEED = 1251/1253/1254` sit exactly where the SDK's
`multiColorBox` action block (`setDry`, `setInfo`, `feedFilament`) sits in the
registry — corroboration of ordering, not of values.

---

## 6. Runtime artefacts

### 6.1 The mTLS material, written to the log directory

On every start the app drops three files into
`%APPDATA%\AnycubicSlicerNext\log\` named with a 32-hex digest:

| Role               | Content                                     | Verified with `openssl`                                                                             |
| ------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| client private key | `-----BEGIN RSA PRIVATE KEY-----`, 2048-bit | `Private-Key: (2048 bit, 2 primes)`                                                                 |
| client certificate | `-----BEGIN CERTIFICATE-----`               | `subject=O=AnyCubic`, `issuer=O=AnyCubic`, valid 2026-09 → 2036-09 (per-install, self-signed)       |
| CA certificate     | `-----BEGIN CERTIFICATE-----`               | `subject=C=CN, ST=Guangdong, L=Shenzhen, O=Anycubic, OU=Anycubic, CN=AC Root CA`, valid 2023 → 2123 |

These are the `ca.crt` / `client.crt` / `client.key` that `resources/mqtt-tls/`
asks the operator to supply, and they are regenerated/extracted by the app, not
downloaded. **They must never be copied into the repository** — they are a shared
client identity plus a per-install key, and the existing rule (operator-local,
gitignored, `git ls-files` never sees them) applies unchanged. This record only
documents where they come from.

### 6.2 Config keys

`AnycubicSlicerNext.conf` is JSON followed by a `# MD5 checksum <hex>` trailer — a
plain `json.load` fails on the trailer, strip it first. 21 top-level keys, notably
`ams_filament_ids`, `anycubic_remote_printing` (values are obfuscated, base64 over
a scrambled buffer — not a token, not readable, not needed), `filaments` (261
preset names), `custom_color_list` (slot index → `r,g,b,a`).

---

## 7. What is not verified

- **Topic capture.** A 130-second authorised run established the cloud broker
  connection (`ESTABLISHED` to `<broker>:8883`), wrote the TLS material, and
  produced `subscribe topic:`/`publish topic:` **zero** times — those log
  statements are compiled to a verbosity the shipped log config does not emit.
  Confirming the `pc/` vs `slicer/` namespace split therefore needs either a log
  level change or a packet capture, not another blind launch.
- **No command was sent.** Every endpoint, type and action above is a static
  finding. Nothing was called, nothing was published.
- **`/v5` and `/farm` bodies.** The field names exist (`cloud_sdk_cpp.dll`
  `6580200`–`6581904` for the print-order struct); the request shapes are
  inferred from them, not from a live exchange.
- **Deletion-class endpoints** (`/farm/message/bulkDelete`, `/v5/cloud-file/folder/delete`,
  `/work/index/delFiles`, `/work/printer/unsetprinters`, `/work/project/unsetprojects`)
  are documented as _existing_, and must not be exercised without a separate
  approval.
- **`fan`/`axis`/`file`/`info`/`aiSettings`** remain unexplained aliases; see §3.2.

---

## 8. Investigation priority

| #   | Target                                             | Why                                                                                                       | Cost                      |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | `filament` type + `queryInfo`                      | the one ACE channel we have never subscribed to; may hand us material identity per slot without any write | one subscribe, one read   |
| 2   | `extfilbox` `getInfo` vs `multiColorBox` `getInfo` | two box products with separate structs; we may be reading the wrong one on the S1                         | one read each             |
| 3   | `slicer/` vs `pc/` publish namespace               | if `pc/` is merely tolerated, every cloud write we have is one firmware update from breaking              | one publish each, compare |
| 4   | `/v3/material/getTypeNameAndSkuListByVerNum`       | gives the real type↔SKU catalogue that a custom-filament flow must speak                                  | one GET, read-only        |
| 5   | `/v2/printer/getExternalShelves`                   | external spool holders are the non-ACE path into the same material model                                  | one GET, read-only        |
| 6   | `finishFeedFilament`                               | our feed is one-shot; theirs is two-phase — a half-fed ACE is a jam                                       | needs hardware            |
| 7   | `/v5/machine_material/getColorGroupListByUser`     | how user materials are actually stored server-side; the write path a custom-filament feature extends      | one GET, read-only        |
| 8   | Retire the 8 unregistered paths in §1.3            | two of them are casing/prefix duplicates of live routes; keeping them keeps a silent-failure mode         | repo change               |

**For the NFC goal specifically:** nothing in this product reads a tag, so there
is no vendor protocol to match. The buildable path is 1 → 4 → 7: read what the
machine reports about filament, speak the catalogue's type+SKU vocabulary, and
persist the mapping through the colour-group API. A physical tag then becomes an
input method for that mapping rather than a protocol to reverse.
