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
`lib/watchParty.ts` (types), `apps/blissful-storage/server.js` (relay + snapshot + episode
clear), `apps/addon-proxy/server.js` (`/rd-by-hash`), `apps/blissful-shell/src/ui_server.rs`
(forward `/rd-by-hash`), `useWatchParty.ts` + `useWatchPartyMpv.ts` (announceSource /
onHostSourceChange), `BlissfulPlayer/index.tsx` + `NativeMpvPlayer.tsx` (announce + resolve),
`pages/PlayerPage.tsx`/`PlayerPageWeb.tsx` (thread the resolved source into the player).

**Release dependency:** desktop *announce* + *resolve* + the `/rd-by-hash` shell forward ship in
the next desktop release (v0.1.8). Web parts deploy instantly. Until v0.1.8 is out, a desktop
host just doesn't announce a source (web guest uses today's fallback — no regression).

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
`apps/blissful-shell/` (outbound tunnel from the shell or renderer; consent IPC + toast),
`apps/addon-proxy/server.js` (`/party-relay/{room}/*` pull-through cache + tunnel endpoint),
`components/WatchParty/WatchPartyDrawer.tsx` (button), watchParty protocol
(`party:request-host-stream` / `party:host-stream-offer` / decline), `playerSettings.ts`
(`autoShareHostStream`), the Vidking-off auto-trigger in `PlayerPageWeb`.

---

## Phasing / validation
- **A1** protocol + storage relay → validate with the WS protocol harness (a desktop-host /
  web-guest pair against the deployed storage: assert `host:source` relays + snapshot carries it).
- **A2** `/rd-by-hash` → curl a known cached infohash, expect a direct link.
- **A3** players resolve → manual: desktop-host + web-guest on a torrent → web plays the same
  release; web-host-RD + desktop-guest → mpv plays the raw RD link.
- **B** behind A; the tunnel gets its own harness + a real 2-device test before release.

Standing rule: each protocol message is additive + feature-detected so older installed shells
keep working (same discipline as the thin-shell IPC).

---
*Authored 2026-06-12. Sequenced after the monorepo migration + thin-shell; backend in-repo so
client+server land together.*
