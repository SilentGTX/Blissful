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
