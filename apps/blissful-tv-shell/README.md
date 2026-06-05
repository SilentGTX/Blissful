# blissful-tv-shell

Tauri v2 shell that runs the Blissful React UI (`apps/blissful-mvs`) on
**Android TV**. It re-implements, for Android, what the Windows
`apps/blissful-shell` does natively: the `window.blissfulDesktop` bridge, the
same-origin backend proxy, and an update check (notify-only on Android).

> **Status: Phases 0–1 complete; Phase 2 (native player) + Phase 3a (TV UI / D-pad)
> in progress.** Up and running: the bridge handshake, the same-origin proxy with
> the backends wired through it, the spatial-navigation layer (D-pad home rows,
> `?tv=1` browser test mode), and the libmpv-android player plumbing (`src-tauri/
> src/mpv.rs` registers the Kotlin `BlissfulMpvPlugin`; bridge play/pause/seek →
> it). **Still open:** the Surface-under-WebView compositing spike, full player
> parity, and the embedded torrent streaming server (RD-only for v1). See
> [`SPEC.md`](./SPEC.md) §8 for the phase plan, [`docs/PHASE3-STATUS.md`](./docs/PHASE3-STATUS.md)
> for the live TV-UI state, and [`docs/PORT-MAP.md`](./docs/PORT-MAP.md) for the
> grounded codebase analysis this is built on.
>
> **Note:** this branch also ships a full **Trakt** integration in the shared UI
> (device-code OAuth, scrobbling, watchlist). It is inert until credentials are
> set — see [Trakt](#trakt-integration) below.

## What's here

```
src-tauri/
  tauri.conf.json      # points frontendDist at ../../blissful-mvs/dist
  Cargo.toml           # tauri 2 + the ui_server.rs proxy deps (hyper/reqwest/url)
  src/
    main.rs            # desktop entry -> blissful_tv_lib::run()
    lib.rs             # mobile entry; wires bridge + proxy + update check
    bridge.rs          # the `bridge` command behind window.blissfulDesktop.call
    proxy.rs           # faithful port of ui_server.rs (addon-proxy/storage/...)
    updater.rs         # notify-only GitHub release check
  capabilities/default.json
docs/
  PORT-MAP.md          # full architecture + portability analysis
  MANIFEST_PATCH.md    # leanback / cleartext / banner edits to apply after init
SPEC.md                # the implementation spec (read this first)
```

Plus, in the shared UI (`apps/blissful-mvs`, additive + `isTauri()`-guarded so
the Windows build is untouched):

- `src/lib/tauriBridge.ts` — installs `window.blissfulDesktop` over Tauri.
- `src/lib/proxyBase.ts` — the `http://127.0.0.1:11471` proxy origin for Android.
- `src/lib/platform.ts` — adds `isTauri()` / `isAndroidTv()`.
- `src/main.tsx` — imports the bridge adapter.

## Prerequisites (one-time)

- **Rust** (rustup + stable) and the Android targets:
  ```powershell
  rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
  ```
- **Node + npm** (the UI build).
- **Android SDK + NDK** (NDK r26/27+, i.e. `>= 28` recommended for the 16 KB
  page-size requirement), **JDK 17**.
- Environment: `ANDROID_HOME`, `NDK_HOME` (or `ANDROID_NDK_HOME`), `JAVA_HOME`.
- Tauri CLI: `npm install` here installs `@tauri-apps/cli` v2 locally.

## First build

```powershell
# from apps/blissful-tv-shell
npm install

# 1) Generate app icons (tauri.conf.json references icons/* that must exist)
npm run icon -- ../../path/to/blissful-logo.png

# 2) Generate the Android Gradle/NDK project under src-tauri/gen/android
npm run android:init

# 3) Apply the Android TV manifest edits (leanback, cleartext, banner)
#    -> see docs/MANIFEST_PATCH.md

# 4) Run on a connected Android TV / emulator
npm run android:dev

# Release APK / AAB
npm run android:build        # --apk
npm run android:build:aab    # --aab (Play Store)
```

`beforeDevCommand` / `beforeBuildCommand` build the UI from `apps/blissful-mvs`
automatically, so you don't need to build it separately.

## Notes / gotchas

- **WebView scheme stays `http`.** The UI fetches the cleartext loopback proxy
  (`http://127.0.0.1:11471`) and streaming server (`:11470`). Do not switch the
  Android WebView to `https` or those become mixed-content-blocked.
- **The proxy is mandatory.** Catalogs/login/streams 404 until `proxy.rs` is
  running *and* the UI's network base points at it (Phase 1 — see SPEC.md).
- **No torrents in v1.** `ensureStreamingServer` now returns `true` (so the UI
  doesn't block RD playback), but there is **no embedded `:11470` torrent engine
  on Android** — magnet / streaming-server-shaped URLs must be routed to a
  "Real-Debrid required" state (Phase 2 task). RD streams are direct HTTPS and
  play without the local server.
- **PWA service worker:** disable VitePWA for the Tauri build (it caches
  `/addon-proxy|storage|stremio` with NetworkFirst and may not register under
  the Tauri origin). See SPEC.md.

## Trakt integration

The shared UI ships a full **Trakt** integration (works on any build — desktop,
browser, TV — not TV-specific, but landed alongside this branch):

- `apps/blissful-mvs/src/lib/traktApi.ts` — TV-friendly **device-code** OAuth
  (no browser redirect), token storage + refresh, `scrobble` start/pause/stop,
  watchlist add/remove. On Android it routes through the proxy
  (`${PROXY_BASE}/trakt`); elsewhere `/trakt`.
- `lib/useTraktScrobble.ts` — wired into **both** players (`NativeMpvPlayer.tsx`,
  `SimplePlayer.tsx`): reports playback progress to Trakt.
- `lib/watchedBitfield.ts` (+ `watchedBitfield.test.ts`) — Stremio-compatible
  watched-state bitfield.
- `components/SettingsTraktPanel.tsx` — the connect/disconnect UI, mounted in
  `pages/SettingsPage.tsx`.

> **Inert until configured.** `lib/traktConfig.ts` holds `TRAKT_CLIENT_ID` /
> `TRAKT_CLIENT_SECRET`, both **empty by default**. `isTraktConfigured()` gates
> every code path, so with empty creds nothing hits the network, nothing throws,
> and there's no UI cost. To enable: create a Trakt API app
> (https://trakt.tv/oauth/applications, redirect URI `urn:ietf:wg:oauth:2.0:oob`),
> paste the Client ID + Secret into `traktConfig.ts`. A `/trakt` proxy/back-end
> route must exist for the device-code calls.
