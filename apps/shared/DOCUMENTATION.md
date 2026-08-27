# Blissful shared services (`apps/shared/`)

Everything consumed by more than one Blissful variant: the backend, the server-side proxy, and
the cross-platform TypeScript core.

## `blissful-storage/` — the backend

MongoDB-backed Node server: auth (JWT), per-user `/state` doc (addons, `homeRowPrefs`, player
settings, library/Continue Watching), friends + presence, profiles, and the watch-party
REST + WebSockets. Single file: `server.js`.

## `addon-proxy/` — the server-side proxy

CORS proxy + edge cache for addon hosts (`/addon-proxy`), image proxy/cache (`/img` — allowlists
metahub + tmdb), `/imdb-rating`, `/tmdb-find`, `/tmdb-season-info` (server-keyed TMDB),
`/rd-fallback`, `/trakt/*`, transcode endpoints, Videasy resolve. Single file: `server.js`.

### Videasy/Vidking source pipeline (web player)

`/videasy-sources` resolves a playable stream for the web player. It fetches the encrypted payload
**in-process** and decrypts it (~250-520 ms, no browser, no token). As of 2026-07-18 the API host
is `https://api.speedracelight.com` (`VIDEASY_API_BASE` overrides it) and uses a two-step "enc=2"
flow:

1. `GET {base}/seed?mediaId=<tmdbId>` → `{ seed, ttlMs }` (~30 s TTL; one seed per resolve, reused
   across providers, refetched once on a `401` "seed rejected").
2. `GET {base}/<provider>/sources-with-title?...&enc=2&seed=<seed>` with `Referer: https://www.vidking.net/`.
3. Decrypt (`videasy-decrypt-v2.js`, ported verbatim from the Vidking player bundle): base64url-decode,
   XOR with a `(seed, tmdbId)`-derived keystream, verify the 4-byte `mvm1` magic prefix, and the rest
   is the JSON `{ sources, subtitles }`. Regression-tested against a frozen real fixture
   (`videasy-decrypt-v2.test.js`, run `node --test`).

Providers (Vidking player names): `cdn`=Hydrogen, `tejo`=Titanium, `neon2`=Oxygen,
`downloader2`=Lithium, `1movies`=Helium; the chain falls through on any per-title failure. Decrypted
source + subtitle URLs are re-proxied through `/addon-proxy?...&vd=1`, which forces the CDN header
spoof + HLS per-segment rewrite (Videasy rotates CDN hostnames, so no host allowlist). **The segment
CDNs' provenance rule keeps flipping** (2026-07-17: 403 on any `Origin` header; 2026-07-18: 403
UNLESS `Referer`+`Origin` name `player.videasy.to`), so `proxyRequest` defaults `vd=1` requests to
the real player's header shape and retries a 403 once with the vidking no-Origin shape. **Pool
hosts also just die** (one stream is sharded across many throwaway domains; tokens are
host-portable): the proxy learns the host pool from the playlists it rewrites and replays a
timed-out/connect-failed/double-403 fetch on the freshest healthy alternate, with a 5-min dead-host
cooldown + pre-skip. Host history:
`api.videasy.net` → `api.videasy.to` (both now 404) → `api.speedracelight.com`. The old CryptoJS/WASM
decryptor (`videasy-decrypt.js` + `videasy-module.wasm`) is kept for reference but unused.

> **DISABLED 2026-08-27.** The entire Videasy path is off: `/videasy-sources` returns
> `{sources:[],subtitles:[]}` in ~2 ms, `/videasy-token` accepts and discards, and the on-Mac
> browser-resolver is never called (its launchd agent is unloaded and the plist deleted).
> Server-side revert: set `VIDEASY_ENABLED=1` in the proxy env — no code change. Client-side:
> `VIDEASY_ENABLED` in `apps/web-blissful/src/lib/playerServers.ts`. Grep `VIDEASY DISABLED`.
> The rest of this section documents the pipeline as it behaves WHEN ENABLED.

**Fallbacks, in order:** if fetch+decrypt fails for every provider — the one case it can't
handle is Videasy rotating the response cipher — it falls back to the on-Mac browser-resolver
(`infra/scripts/videasy-resolver.py`, launchd `com.budinoff.videasy-resolver`, `:13099`): a headed
undetected-Chrome that harvests already-**decrypted** output from Vidking's own player, so it's
immune to cipher changes. Its warm-loop is off by default (`VIDEASY_RESOLVER_WARM=1` to re-enable),
so Chrome stays cold until a real fallback fires. Below that, Real-Debrid (`/rd-fallback`) — the
web player also probes the resolved manifest client-side (PlayerPageWeb dead-manifest probe,
`player-videasy-fallback.web.spec.ts`) and commits the RD pick itself when videasy "resolves"
sources whose CDN never answers. The
legacy session-token machinery (`videasyAuthHeaders`, `/videasy-token`, the removed
`videasy-minter`) is retained but **inert** — it reactivates only if the token wall returns. Full
anatomy + outside-in diagnosis in the memory note `project_vidking_videasy_pipeline`.

### Transcode endpoints + the offline `q=` ladder

`/transcode.m3u8?url=<src>[&a=<audio>][&q=<rung>]` ffprobes the duration and emits a VOD
playlist of 6 s segments, each generated on demand by `/transcode-seg` (re-encoded to
H.264 8-bit + AAC MPEG-TS, so every segment is independent and keyframe-started). Heavy
encodes are offloaded to the macOS host's VideoToolbox service when `TRANSCODE_HOST_URL` is
set (`infra/scripts/blissful-transcoder.py`).

**`sub=<stream index>` burns a subtitle stream into the picture** (`videoFilterArgs`).
Necessary because a large share of anime and every Blu-ray remux ships subtitles as **PGS**
(`hdmv_pgs_subtitle`) — bitmap images, not text — which cannot become WebVTT without OCR, so
the web player can only ignore them (it filters on `textBased`). Bleach's [Judas] release
carries "English [Signs/Songs]" + "English [Full]", both PGS, which is why the only text
options left were two mistimed OpenSubtitles files. Since every segment is re-encoded anyway,
`[0:v:0][0:N]overlay` costs almost nothing and reproduces the release's own typesetting — and
because the subtitles become part of the video, an offline download carries them with no
subtitle files and no player support. Overlay runs BEFORE the `q=` scale so the bitmaps line
up with the frame they were authored for. `sub` is part of the host transcoder's cache key
alongside `q`. Verified 2026-08-17: identical requests are byte-identical, `&sub=4` changed
the picture (+30 KB) and the burned text is visible in the frame with the player's own text
tracks disabled.

**`a=` is clamped to the tracks the file actually has** (`clampAudioIdx`). Segments map
audio with `-map 0:a:N?`, and that trailing `?` makes the mapping OPTIONAL — an out-of-range
N therefore produced a valid, HTTP-200, **video-only** segment, i.e. playback with no sound
and no error anywhere. A stale `&a=` is easy to acquire: resume links and next-episode links
carry the index forward, so a dual-audio anime episode followed by a single-track one asked
for a track that didn't exist (diagnosed 2026-08-17 on Bleach `kitsu:244:3`, a
`[FLAC 2.0][x264 10bit]` release). The clamp lives server-side so it protects every client at
once — already-deployed bundles and the desktop shell included — and stops an offline
download from being permanently silent. Valid multi-track selection is untouched: the client
also drops an out-of-range pin (`PlayerPageWeb`), but the server is the safety net.

`q` is the **offline-download ladder** (`360p | 540p | 720p | 1080p`, `TRANSCODE_QUALITIES`);
anything unrecognised or absent means source resolution at the streaming bitrate, so older
clients that never send `q` are unaffected. The rungs downscale only (`min(H,ih)`, even
dimensions) and the software path uses capped CRF (`-crf` + `-maxrate`/`-bufsize`) rather than
a flat bitrate — a fixed target pads easy scenes, measurably producing *larger* files than the
CRF path on low-complexity video. VideoToolbox has no usable CRF mode, so the hardware path
stays bitrate-targeted under the same ceiling. **`q` is part of the host transcoder's cache
key** — otherwise a 540p segment could be served into a full-quality stream. Keep
`TRANSCODE_QUALITIES` (server.js) and `QUALITIES` (blissful-transcoder.py) in sync; the
client's size estimates live in `lib/offlineStore.ts`. Consumer: web offline downloads, see
[apps/web-blissful/DOCUMENTATION.md](../web-blissful/DOCUMENTATION.md) §Offline downloads.

## `blissful-core/` — `@blissful/core`

Shared pure-TS logic: stremio API, addon protocol (`stremioAddon.ts`), storage/auth clients,
friends, presence, watch-party REST, types. **Consumed as SOURCE** (no build step):

- **Android app** (`apps/android-blissful`): Metro `watchFolders` + `extraNodeModules` alias +
  a `node_modules/@blissful/core` junction (`scripts/link-core.js`) for release bundling.
  After editing core, restart Metro with `--clear`.
- **Web app**: not yet — the `apps/web-blissful` core-extraction refactor lives on the
  `react-native-blissful` branch and is deliberately deferred; on `main` the web app still has
  its own copies under `src/lib/`.
- Platform behaviour is injected via `configureCore()` (e.g. web wraps addon fetches in
  `/addon-proxy`; RN fetches addon hosts directly — no CORS on native).

**New cross-platform pure-TS logic goes here.**

## Backend surface (blissful.budinoff.com)

What the clients depend on. The desktop shell reaches it through its `/storage/*` proxy; the
Android app directly via `getStorageBaseUrl()` (backend root = the same host minus `/storage`).

- Under `getStorageBaseUrl()` (`https://blissful.budinoff.com/storage`): auth + the shared
  `/state` doc, watch-party REST (`/watch-party*`, `/party-invite/*`), presence
  (`/presence/heartbeat`), profiles (`/users/:id/profile`), and the WebSockets `/ws/room`
  (room sync) + `/ws/user` (invite push, `{t:'auth',token}` first frame).
- At the backend root: `/img`, `/imdb-rating?imdbId`, `/tmdb-find?imdbId` →
  `{tmdbId, mediaType}`, `/tmdb-season-info?tmdbId&season`, `/trakt/*`, `/addon-proxy`,
  `/rd-fallback`, `/resolve-url`.

If a task needs a NEW endpoint, don't invent it — `blissful-storage`/`addon-proxy` live right
here, so implement it server-side in the same commit (single-repo protocol changes), or surface
it to the user.

## Deploy (the Mac)

Both services run on the Mac (`~/home-lab/Blissful`) via the root
[`docker-compose.yml`](../../docker-compose.yml): `blissful` (serves the built web `dist/`),
`blissful-storage`, `blissful-mongodb`, `stremio-service`, `blissful-proxy` (= addon-proxy).
Bind mounts point at `apps/web-blissful/dist`, `apps/shared/blissful-storage`,
`apps/shared/addon-proxy`. Secrets from `~/home-lab/Blissful/.env` (not committed). Infra
scripts/launchd live in [`infra/`](../../infra/).

- Web UI deploy: `infra/scripts/blissful-web-deploy.sh` (build + mandatory CDN purge — see
  [`apps/web-blissful/DOCUMENTATION.md`](../web-blissful/DOCUMENTATION.md)).
- Service deploy: `git pull && docker compose up -d`. **After the 2026-06 repo restructure the
  compose bind-mount paths changed — the first deploy on the Mac must re-up the containers,
  not just pull.**
