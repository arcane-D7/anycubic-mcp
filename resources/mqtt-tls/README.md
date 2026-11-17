# resources/mqtt-tls — operator-supplied TLS identity

This folder is intentionally **empty in git**. It is where the operator places the
mutual-TLS identity the Anycubic cloud MQTT broker (`mqtts://mqtt-universe.anycubic.com:8883`)
requires. The plugin reads the files from here at connect time and nowhere else.

| File         | What it is                                                    | Where it comes from                                                     |
| ------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `ca.crt`     | Anycubic's AC Root CA (issued by `CN=AnycubicSlicer`)         | Ships inside the official Anycubic Slicer Next installation              |
| `client.crt` | Shared slicer **client** certificate for the mTLS handshake    | The shared ecosystem client identity — not shipped by Anycubic           |
| `client.key` | Private key matching `client.crt`                             | Same shared client identity                                             |

The local slicer install only carries the CA. The client certificate/key pair is the
ecosystem-wide client identity that this protocol was reverse-engineered against
(cross-validated live on hardware, see `docs/printer-command-bus.md`); it is supplied by
the operator from their own environment.

## These files are never committed

`resources/mqtt-tls/*` is listed in `.gitignore`. Do not add the certificate or key bytes
to git, to a release artefact, to an issue, or to a doc. `pnpm run check` runs the repo
sanitizer and the health workflow greps the tree for key material, so a committed
`client.key` fails the gate rather than leaking quietly.

## Failure mode when the folder is incomplete

`readMqttTlsMaterial()` (`scripts/anycubic-cloud.mjs`) fails **closed**: if any of the
three files is absent it throws `MqttTlsMaterialError` with code
`MQTT_TLS_MATERIAL_MISSING`, naming the missing files and this README. There is no
fallback to a plain-TLS or unverified connection. The refusal is visible in the tool
result as `connection_error`, for example:

```
MQTT_TLS_MATERIAL_MISSING: cloud MQTT needs the Anycubic slicer's mutual-TLS identity, and these
files are present in resource dir "...\resources\mqtt-tls": client.crt, client.key. Extract ...
```

## What still works without them

Only **cloud** MQTT (telemetry topics, cloud command bus) needs this identity.

- LAN MQTT reads/writes (direct `mqtt://<LAN_IP>:9883`, no TLS) do not read this folder.
- The read-only cloud HTTP order path (`POST /work/operation/sendOrder`) authenticates with
  the account `XX-Token` only and does not read this folder.

## Note on the CA

The CA uses SHA-1 signatures, so the MQTT client options pin
`ciphers: "DEFAULT@SECLEVEL=0"` with `rejectUnauthorized: true` (see
`scripts/anycubic-cloud.mjs`). Verification stays on; only the legacy cipher security
level is lowered, because OpenSSL 3 otherwise refuses the handshake.