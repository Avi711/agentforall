# WhatsApp 405 runbook

**Symptom:** `405` + `closed during setup`, `loggedOut: false`, all tenants at once.
405 = rejected before creds are sent, so it is never a credentials problem.

Last occurrence: 2026-07-28 21:48 UTC. WhatsApp deprecated the WA Web protocol version Baileys pins.

## 1. Discriminator test — run FIRST, from a laptop, not the VM

A fresh session from a second IP collapses all three hypotheses at once. Skipping this cost an hour.

```bash
mkdir wa405 && cd wa405 && npm init -y && npm i baileys@7.0.0-rc13
```

```js
// test.mjs — omit `version` to test what Baileys ships; set it to test a candidate
import { makeWASocket, useMultiFileAuthState } from "baileys";
const VERSION = undefined; // e.g. [2, 3000, 1043857760]
const { state } = await useMultiFileAuthState("./authstate");
const sock = makeWASocket({ ...(VERSION ? { version: VERSION } : {}), auth: state });
setTimeout(() => { console.log("TIMEOUT"); process.exit(2); }, 45000);
sock.ev.on("connection.update", (u) => {
  if (u.qr) { console.log("QR — handshake accepted"); process.exit(0); }
  if (u.connection === "close") { console.log("CLOSED", u.lastDisconnect?.error?.output?.statusCode); process.exit(1); }
});
```

| Result | Meaning |
|---|---|
| QR | VM-specific (IP/network) |
| 405 | version bump or global outage — not our infra, stop debugging prod |
| 401 | genuine session logout — just relink |

## 2. Find the working version

```bash
curl -s "https://api.github.com/repos/WhiskeySockets/Baileys/pulls?state=open&sort=created&direction=desc" | grep -i "whatsapp web version"
```

`fetchLatestBaileysVersion()` reads Baileys **master**, which lags — that is why our existing mitigation missed this. Confirm the candidate with the test above before touching prod.

## 3. Apply

Replace the old version in `Defaults/index.js` + `Utils/generics.js`, and point the master-fetch URL at a dead address so it falls back to the local constant. Two places:

- tenant volume: `oc-<shortId>-state` → `npm/projects/openclaw-whatsapp-*/node_modules/@openclaw/whatsapp/node_modules/baileys/lib`
- sidecar: rebuild `PAIRING_IMAGE` `FROM` the pinned digest with the same sed, repoint `.env.runtime`, recreate orchestrator

Then relink via the dashboard (not `openclaw channels login` — `InstanceManager.start()` re-injects the DB creds and clobbers a CLI relink).

## Live patches — revert when PR #2728 merges

`1035194821` → `1043857760`, applied 2026-07-28. Backups: `*.waversion.bak`, `.env.runtime.bak-waversion`.
Runtime-only: a tenant recreate or `openclaw plugins update` wipes them.

## TODO — makes step 3 unnecessary

- `WHATSAPP_WEB_VERSION` env override in `apps/whatsapp-pairing` + OpenClaw config, so a bump is one env var + restart.
- Re-pair is impossible while `pairing_status='paired'`: `pair/page.tsx` redirects away and `pairing-manager.ts` rejects it. Needed a manual DB flip to `expired`.
- Health monitor resets `expired` → `paired` on a container-healthy probe, undoing its own correction.
