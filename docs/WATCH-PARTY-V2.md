# Watch Party v2 — cross-platform same-file sync

**Goal:** when a desktop (mpv) and a web (`<video>`) user are in the same room, they watch the
**same file**, frame-aligned — not just the same timeline. Today the protocol syncs only the
timeline (currentTime + play/pause/seek + episode + the readiness gate); each client resolves
its own stream, so cuts/offsets can differ. v2 syncs the *content identity* too.

Two layers (both approved 2026-06-12; build A first — B depends on A's plumbing):

- **Layer A — source identity.** A platform-neutral `source` in the room; each platform
  resolves it its own way to land on the same file.
- **Layer B — host relay.** A web guest can ask a desktop host to **share its locally
  transcoded stream** (relayed through the Mac); the Vidking-OFF path triggers it automatically.

The backend is in-repo (Phase 5), so protocol changes are single-commit (client + server). The
readiness gate / drift-correct ticks / episode + subtitle relay already shipped — with same-file
playback there's no content offset left for the ticks to fight.

---

## Layer A — source identity

### Wire model (`lib/watchParty.ts`)
```
type WatchPartySource =
  | { kind: 'torrent'; infoHash: string; fileIdx: number | null; trackers?: string[] }
  | { kind: 'rd'; rdUrl: string; infoHash?: string | null }
  | { kind: 'vidking'; tmdbId: number; mediaType: 'movie'|'tv'; season?: number; episode?: number }
  | { kind: 'relay'; url: string }          // Layer B
  | null;                                    // host hasn't resolved yet / unshareable
```
- Client→server: `{ t: 'host:source'; source: WatchPartySource }`
- Server→clients: `{ t: 'source'; source: WatchPartySource }`
- Room snapshot gains `source?: WatchPartySource` (late joiners match it).
- Cleared (→null) on `host:episode` (server-side), same as `subtitleLang`.
- Legacy `host:stream`/`stream`/`streamUrl` stay during transition (older web clients); the
  desktop ignores them. `source` supersedes; the host emits both for one release cycle.

### Hosts announce (on FileLoaded / stream switch)
- **Desktop**: parse the playing URL. `127.0.0.1:11470/{infoHash}/{fileIdx}?tr=…` →
  `{kind:'torrent', infoHash, fileIdx, trackers}`. A raw RD https link (from the releases
  drawer) → `{kind:'rd', rdUrl, infoHash?}`.
- **Web**: on Vidking → `{kind:'vidking', tmdbId, mediaType, season?, episode?}`; on RD fallback
  → `{kind:'rd', rdUrl}` (the rdUrl already lives in today's `streamUrl`).

### Guests resolve (per platform; pin via the existing guest-lock that hides the pickers)
| Guest \ source | torrent | rd | vidking |
|---|---|---|---|
| **Web** | `/rd-by-hash?infoHash&fileIdx` → direct link → `/transcode.m3u8` (same file). Miss/429 → today's fallback (Vidking → own RD pick), timeline-only. | reuse host `rdUrl` → `/transcode.m3u8` (shared-transcode cache hit, exactly today's web↔web RD path). | resolve own Vidking by tmdbId (timeline-only — Vidking is unshareable). |
| **Desktop** | `127.0.0.1:11470/{infoHash}/{fileIdx}` via own stremio-service (P2P, same file); prefer `/rd-by-hash`→raw link when cached (instant start). | play raw `rdUrl` in mpv (full quality, no transcode). | own torrent pick (timeline-only). |

`vidking` is the one honestly-unshareable case. Mitigation: when a non-web client is in the
room, the web host prefers the RD path over Vidking (it knows party membership), collapsing the
room onto a shareable source.

### New endpoint — `addon-proxy /rd-by-hash?infoHash=..&fileIdx=..`
House RD key, returns a key-free direct link (reuses `/rd-fallback` internals). 404 if RD
doesn't have the hash cached → guest falls back.

### Files
`lib/watchParty.ts` (types), `apps/shared/blissful-storage/server.js` (relay + snapshot + episode
clear), `apps/shared/addon-proxy/server.js` (`/rd-by-hash`), `apps/desktop-blissful/src/ui_server.rs`
(forward `/rd-by-hash`), `useWatchParty.ts` + `useWatchPartyMpv.ts` (announceSource /
onHostSourceChange), `BlissfulPlayer/index.tsx` + `NativeMpvPlayer.tsx` (announce + resolve),
`pages/PlayerPage.tsx`/`PlayerPageWeb.tsx` (thread the resolved source into the player).

**Release dependency (revised):** because the thin shell loads the remote UI, the desktop
*announce* + *resolve* code runs inside the WebView the moment a web deploy lands — so the whole
of Layer A reaches **every v0.1.7+ (thin-shell) desktop via a web deploy, no release needed**. A
desktop guest's torrent resolve hits `127.0.0.1:11470` (its own stremio-service, same as a normal
torrent play) and `/rd-by-hash` via the public route. The `/rd-by-hash` shell forward in
`ui_server.rs` only matters for **dev / local-origin** builds; it ships with the next release
whenever one is cut. Installed shells ≤ v0.1.6 still serve their bundled UI until they update to
v0.1.7.

**Status — Layer A SHIPPED 2026-06-12 (deployed, unit-validated; 2-device behavioral test
pending).**

---

## Layer B — host relay ("Ask for host stream")

Browsers can't fetch from a home PC (NAT/CGNAT + mixed-content). So the desktop transcodes
locally (its bundled stremio-service already does seekable HLS) and the **Mac relays the bytes**
(dumb pull-through cache, no transcode CPU — it just has https + a public host).

```
Host PC: stremio-service transcodes torrent → HLS (loopback)
   │ outbound WebSocket tunnel (host dials OUT — no NAT/port-forward needed)
   ▼
Mac: /party-relay/{room}/…  (pull-through segment cache; one fetch per segment, fans out)
   ▼
Web guest(s): https://blissful.budinoff.com/party-relay/{room}/index.m3u8
```

### Flow
1. Web guest: **"Ask for host stream"** button in the watch-party drawer → `party:request-host-stream`.
2. Desktop host: consent toast *"X wants your stream — Share / Decline"* (CPU + upload cost).
   `always allow` player setting for regulars.
3. On accept: host starts the local HLS job for the playing torrent, opens the tunnel, announces
   `{kind:'relay', url: '…/party-relay/{room}/index.m3u8'}` (the `source` slot from Layer A).
4. Guests swap onto it; the readiness gate holds both while it buffers in; from then on, same
   file, frame-aligned.
5. **Vidking-OFF**: when the web guest's Vidking resolve fails, auto-send the request instead of
   burning a house-RD resolve + Mac transcode (auto-accept by default here, setting-gated). RD
   fallback remains the safety net if the host declines/leaves/tunnel dies; the dead-room/leave
   teardown we shipped already covers it.

### Cost / constraints
- Host upload ≈ 4–8 Mbps per 1080p transcode. One guest fine; the Mac fan-out means more guests
  don't multiply the host's cost.
- The tunnel + `/party-relay` pull-through is the meaty part. A later optimization swaps the
  relay for WebRTC data channels (true P2P, zero Mac bandwidth; signaling over the room socket).
- `relay` is just another `source.kind`, so late joiners pick it up from the snapshot like
  everything else. Needs a shell release.

### Files (on top of A)
`apps/desktop-blissful/` (outbound tunnel from the shell or renderer; consent IPC + toast),
`apps/shared/addon-proxy/server.js` (`/party-relay/{room}/*` pull-through cache + tunnel endpoint),
`components/WatchParty/WatchPartyDrawer.tsx` (button), watchParty protocol
(`party:request-host-stream` / `party:host-stream-offer` / decline), `playerSettings.ts`
(`autoShareHostStream`), the Vidking-off auto-trigger in `PlayerPageWeb`.

---

## Phasing / validation
- **A1** protocol + storage relay → **DONE** (commit a9f1c78, storage deployed). Validated with
  a WS harness against deployed storage: `host:source` relays with all fields, bad infoHash →
  null, late-joiner snapshot carries `source`, episode change clears it. "ALL CHECKS PASSED".
- **A2** `/rd-by-hash` → **DONE** (commit d868eed, proxy deployed; Traefik route in OpenCode
  fd982845). Validated: a cached Dark Knight infoHash → 200 + a real `*.download.real-debrid.com`
  link; bad input → 400; uncached hash → 404 (bounded ~10s, self-cleans the RD torrent).
- **A3** players announce/resolve → **DONE** (commit a529505, web-deployed). `tsc -b` clean, 28
  unit tests (19 new for `watchPartySource`). **Still owed: the real 2-device behavioral test** —
  desktop-host torrent + web-guest plays the same release; web-host-RD + desktop-guest plays the
  raw RD link; readiness-gate interplay across the swap. Logic is sound + unit-tested but the
  live cross-device sync hasn't been exercised.
- **B** behind A; the tunnel gets its own harness + a real 2-device test before release. **Needs
  a desktop release** (the outbound WS tunnel lives in the Rust shell).
  - **B1 (protocol + web UX) — BUILT + unit-validated.** `party:request-host-stream` /
    `party:decline-host-stream` (+ server→client `party:host-stream-request` /
    `party:host-stream-declined`) in `watchParty.ts`; relayed in `blissful-storage` (request→host,
    decline→guest). Both hooks expose `requestHostStream`/`declineHostStream` +
    `onHostStreamRequest`/`onHostStreamDeclined`. Acceptance reuses `host:source` announcing a
    `relay` source; `resolveSourceForWeb` now plays a `relay` HLS URL directly. Drawer
    "Ask for host's stream" button (guest); desktop-host consent→`startPartyRelay`→announce;
    web-host auto-declines. `autoShareHostStream` setting + `desktop.startPartyRelay/stop/onStatus`.
    tsc + vitest green (3 relay-resolve tests added).
  - **B2 (Mac relay) — BUILT + harness-validated.** `addon-proxy`: a `ws` tunnel endpoint
    (`/party-relay-tunnel?room&key`, host registry) + `GET /party-relay/{room}/{path}?k=`
    pull-through with an in-memory segment cache, concurrent-pull coalescing, and playlist URI
    rewrite (relative + absolute loopback URIs keyed). `relayKey` gates the room. `ws` added to the
    container's ad-hoc install; Traefik `/party-relay` router + catch-all exclusion (covers the WS
    tunnel too). A local fake-host harness passed: playlist rewrite, segment relay+cache, wrong-key
    403, unknown-room 404.
  - **B3 (desktop tunnel) — BUILT + compile-checked.** `host_relay.rs` (outbound `wss`, answers
    pulls by fetching local stremio-service, base64 frames, reconnect/backoff, status events) +
    `startPartyRelay`/`stopPartyRelay` IPC; `tokio-tungstenite`+`futures-util`+`base64` deps.
    `cargo check --features spike0a` clean.
  - **OPEN (needs a real device):** (1) the local stremio-service `/hlsv2` index path
    (`localStremioHlsPath` in `NativeMpvPlayer.tsx`) is a flagged best-effort — verify the exact
    `/hlsv2` contract against the running stremio-service; a wrong value degrades safely (relay
    404s → guest keeps RD/Vidking). (2) The Vidking-off auto-trigger is deferred until (1) is
    confirmed (manual button works meanwhile). (3) Real 2-device test. (4) The desktop release
    (tag) — needs the accumulated dev work committed first.

Standing rule: each protocol message is additive + feature-detected so older installed shells
keep working (same discipline as the thin-shell IPC).

---
*Authored 2026-06-12. Sequenced after the monorepo migration + thin-shell; backend in-repo so
client+server land together.*
