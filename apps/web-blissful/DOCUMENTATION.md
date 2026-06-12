# Blissful Web (`apps/web-blissful`) — the React UI for web + desktop

THE React UI — **one codebase with two personalities** chosen at runtime by `isNativeShell()`
(`src/lib/desktop.ts` — true when the Rust shell has injected `window.blissfulDesktop`):

- **Desktop** (inside `apps/desktop-blissful`): `NativeMpvPlayer` (libmpv), stremio-service
  torrent resolution, multi-addon search, addon home rows, Stremio accounts, version badge,
  chapter-skip.
- **Web** (plain browser, deployed to `https://blissful.budinoff.com`): `BlissfulPlayer`
  (`<video>`/HLS) + the Vidking → Real-Debrid resolve pipeline, the persistent mini-player /
  Document-PiP host.

The platform boundary is deliberately narrow: only the **player + its stream-resolution
pipeline + the `lib/desktop.ts` bridge** differ. Everything else (catalog, addons, auth,
library/CW, home/discover/detail, watch party, friends, presence, settings) is shared, one
copy, gated behind `isNativeShell()` rather than forked. Migrating a feature means editing it
once and gating the platform-specific bits inside it.

## Build & dev commands

```powershell
# Dev server (port 5173). Hot-reloads in the desktop shell when it's running.
npm --prefix apps\web-blissful install
npm --prefix apps\web-blissful run dev      # vite + the Rust shell, concurrently
npm --prefix apps\web-blissful run dev:vite # vite only

# Type-check (strict; what CI runs):
npx --prefix apps\web-blissful tsc -b

# Lint / production build (dist/) / unit tests (vitest):
npm --prefix apps\web-blissful run lint
npm --prefix apps\web-blissful run build
npm --prefix apps\web-blissful test
```

**Important:** `tsc --noEmit` ≠ `tsc -b`. Build mode reads `tsconfig.app.json` which has
`noUnusedLocals: true` — local validation must use `tsc -b` (or `npm run build`) or it will
miss dead-identifier errors that fail CI.

## Thin shell — how the desktop gets this UI

The WebView2 navigation target is resolved in the shell's `main_window.rs`:

1. `BLISSFUL_UI_URL` env override (any origin — staging, a vite preview, the local server); else
2. **dev builds** (`cfg!(debug_assertions)`) → the local UI server (Vite proxy when `:5173` is
   up, the built `dist/` otherwise); else
3. **release builds** → `REMOTE_UI_URL` = `https://blissful.budinoff.com`. **This is the thin
   shell: a web deploy updates every installed desktop app on its next launch/refresh — UI
   changes need NO desktop release.**

Supporting machinery:
- **Origin pinning** (`webview.rs::is_allowed_internal_uri`) allows exactly two document origins
  — the local UI server and the configured remote — and routes everything else to the OS browser.
- **Failure fallback**: a failed initial remote navigation falls back ONCE to the bundled local
  UI; after first visit the deployed PWA service worker absorbs short outages.
- **`localServerBase`**: the JS shim (`ipc/mod.rs::js_shim()`) exposes the local server origin so
  routes that must hit THIS machine still work from the remote page — `lib/desktop.ts::shellOrigin()`
  prefixes `/resolve-url` and the `/addon-proxy` wraps of the loopback stremio-service
  (`opensubHash`). Everything else stays relative (the Mac's equivalents, same as web).
- **Version-skew rule**: the deployed UI must tolerate OLDER installed shells — IPC additions
  stay additive + feature-detected (`shellOrigin()` returns `''` on shells that don't send it).

## Deploy model (web)

- **UI change** → push `main`, then on the Mac run `infra/scripts/blissful-web-deploy.sh`
  (git pull + build + **CDN purge**). The compose `blissful` service `serve -s dist` reads from
  disk → live instantly; web on refresh, thin-shell desktops on their next SW check (~60s). No
  release. **The CDN purge is mandatory:** Cloudflare's zone Browser-Cache-TTL (4h) rewrites
  `Cache-Control` on `sw.js` even though the origin sends `no-cache` (`public/serve.json`), so a
  plain `git pull && npm run build` leaves the service worker frozen on the old bundle inside
  every desktop WebView for ~4h (the "web updated but desktop didn't" bug). The script purges
  the PWA control files (`sw.js`, `registerSW.js`, `index.html`, `/`, `manifest.webmanifest`)
  using `CLOUDFLARE_API_TOKEN` from `~/home-lab/Blissful/.env`.
- **Shell change** (Rust) → needs a desktop release — see
  [`apps/desktop-blissful/DOCUMENTATION.md`](../desktop-blissful/DOCUMENTATION.md).

## Architecture

**Stack:** React 19 + TypeScript 5.9 (strict) + Vite 7 + HeroUI + Tailwind CSS + React Router 7
+ Framer Motion + Vitest.

### Data flow

1. **Stremio Core API** (`lib/stremioApi.ts`) — auth, library sync, addon management. Endpoint
   `https://api.strem.io/api/*`.
2. **Addon protocol** (`lib/stremioAddon.ts`) — fetches manifest/catalog/meta/stream/subtitles
   from addon URLs. All requests go through `/addon-proxy` for CORS. 5-minute in-memory cache
   per resource type. `normalizeAddonBaseUrl()` is unit-tested.
3. **Storage server** (`lib/storageApi.ts`) — persists user prefs (player settings, home row
   order, theme, etc.) to the MongoDB-backed `blissful-storage` server
   (`apps/shared/blissful-storage`, deployed on the Mac). The desktop shell proxies these calls
   through `/storage/*` so the renderer treats them as same-origin (web hits it directly).
4. **Local state** — watch progress (`progressStore.ts`), stream history (`streamHistory.ts`),
   library bookmarks (`libraryStore.ts`) all use `localStorage` under `bliss*` key prefixes.

### Provider architecture

The deprecated `AppContext` mega-facade has been **deleted**. Global state lives in focused
providers under `src/context/`, composed via `ProvidersGlue.tsx`:

- `AuthProvider` — `authKey`, `user`, `savedAccounts`, login/logout/switchAccount/removeAccount.
- `UIProvider` — `uiStyle` (classic vs netflix), `isDark`, gradient keys, `homeEditMode`, `query`.
- `StorageProvider` — `storageState`, `storageHydrated`, `homeRowPrefs`, `playerSettings`,
  `savePlayerSettings` (also forwards streaming-server cache-size changes), `userProfile`.
- `AddonsProvider` — `addons`, `addonsLoading`, `addonsError`, `installAddon`, `uninstallAddon`.
- `ModalsProvider` — every modal slot with `open*`/`close*` callbacks. `openLoginWith(...)` /
  `openAddAddonWith(url)` exist alongside the no-arg openers so HeroUI `onPress` handlers can
  pass them straight without the press event leaking through as an arg.
- `HomeCatalogProvider` — Cinemeta movies/series catalog (fetched once on mount), `homeRowOptions`.
- `ContinueWatchingProvider` — list + actions, the resume-modal flow, the black-veil overlay.

`AppShell.tsx` is ~815 lines, mostly layout JSX; side-effect hooks live in
`layout/app-shell/hooks/`.

### Conventions

- **Cancellation idiom:** async effects use `let cancelled = false` + cleanup
  `() => { cancelled = true }`. Standard across `lib/*` consumers and feature hooks.
- **Stream routing:** stream clicks build a player URL from `deepLinks.ts` and navigate to
  `/player?url={encoded}`. Local stremio-server URLs (`http://127.0.0.1:11470/...`) pass through;
  the shell's UI server allow-lists them at `/addon-proxy`.
- **Two UI modes:** `classic` (sidebar + glass) and `netflix` (top bar + hero), toggled by
  `uiStyle` in `UIProvider`.

### Desktop bridge (`lib/desktop.ts`)

`window.blissfulDesktop` is injected by the Rust shell's WebView2 init script
(`apps/desktop-blissful/src/ipc/mod.rs::JS_SHIM`). The renderer talks to the shell via:

- **Generic mpv:** `desktop.mpv.command(name, ...args)` (allowlisted), `desktop.mpv.setProperty`,
  `desktop.mpv.getTracks()`, `desktop.mpv.getChapters()`.
- **Dedicated player ops:** `desktop.play()`, `desktop.pause()`, `desktop.seek(seconds, mode)`
  (the shell appends `+exact` so absolute seeks land on the precise frame).
- **Streaming server:** `desktop.ensureStreamingServer()` — guarantees `127.0.0.1:11470` is bound.
- **Updater:** `desktop.getUpdateStatus()` / `downloadUpdate()` / `installUpdate()`; renderer hook
  is `hooks/useDesktopUpdater.ts`.
- **Lifecycle:** `getAppVersion()`, `toggleFullscreen()`, `isFullscreen()`, `onMpvEvent(cb)`,
  `onMpvPropChange(cb)`.

Use `isNativeShell()` to gate desktop-only UI. The bridge is absent in the browser.

### NativeMpvPlayer decomposition

`src/components/NativeMpvPlayer.tsx` is large (~2,400 lines — irreducible feature richness) with
the visible JSX extracted into `src/components/NativeMpvPlayer/`: `playbackClock.ts` (module-level
external store carrying mpv's `time-pos` at ~10 Hz; component state throttled to ~5 Hz; the scrub
slider subscribes via `useSyncExternalStore`), memoised `ScrubBar` / `PlayerControlsBar` /
`AudioMenuPopover` / `SubtitleMenuPopover` / `PlayerHdrBadges` / `SkipChapterButton`,
`useChapterSkip.ts`, `subtitleHelpers.ts`.

### Skip Intro / Recap / Credits

Driven by **mpv chapter markers**, no addon dependency: the shell reads `chapter-list` via the
count+sub-property workaround, `("chapter", Int64)` is observed, `useChapterSkip(duration)`
classifies chapter titles against intro/recap/outro regexes (catalogue derived from Jellyfin's
intro-skipper plugin), `<SkipChapterButton>` floats above the controls and seeks to the next
chapter. For files without chapters the planned fallback is the AniSkip v2 API (MAL-keyed).

### Testing

`vitest` runs `*.test.ts` (currently `lib/stremioAddon.normalizeAddonBaseUrl`; run `npm test`).
When you add a behaviour that could be a regression magnet (security validation, semver
comparison, URL normalisation), add a test next to the code.

## Key files

- `src/components/AppShell.tsx` — root layout + hook composition.
- `src/components/NativeMpvPlayer.tsx` + `NativeMpvPlayer/` — libmpv-backed desktop player.
- `src/components/BlissfulPlayer/` — the web `<video>`/HLS player; `src/components/SimplePlayer.tsx`
  is the legacy fallback.
- `src/pages/{HomePage,DiscoverPage,DetailPage,PlayerPage}.tsx` — main routes.
- `src/lib/{stremioApi,stremioAddon,streamHistory,storageApi,desktop,progress,playerSettings}.ts`.
- [`AGENTS.md`](AGENTS.md) — UI-specific patterns and conventions.
