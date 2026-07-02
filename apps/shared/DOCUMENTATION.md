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

`/videasy-sources` resolves a playable stream for the web player. As of 2026-07-02 it fetches the
encrypted payload **in-process** from `https://api.videasy.to/<provider>/sources-with-title`
(providers `cdn`/`downloader2` return it; `mb-flix`/`1movies` 404) with just a
`Referer: https://www.vidking.net/`, then decrypts it with the bundled WASM decryptor
(`videasy-decrypt.js` + `videasy-module.wasm`). ~1 s, no browser, no token — the API moved off
`api.videasy.net` (now 404s) to `api.videasy.to`, which dropped its Cloudflare-Turnstile /
session-token wall (`VIDEASY_API_BASE` overrides the host). Decrypted source + subtitle URLs are
re-proxied through `/addon-proxy?...&vd=1`, which forces the CDN Origin/Referer spoof + HLS
per-segment rewrite (Videasy rotates CDN hostnames, so no host allowlist).

**Fallbacks, in order:** if fetch+decrypt fails for every provider — the one case it can't
handle is Videasy rotating the response cipher — it falls back to the on-Mac browser-resolver
(`infra/scripts/videasy-resolver.py`, launchd `com.budinoff.videasy-resolver`, `:13099`): a headed
undetected-Chrome that harvests already-**decrypted** output from Vidking's own player, so it's
immune to cipher changes. Its warm-loop is off by default (`VIDEASY_RESOLVER_WARM=1` to re-enable),
so Chrome stays cold until a real fallback fires. Below that, Real-Debrid (`/rd-fallback`). The
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
