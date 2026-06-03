# blissful-tv-shell

Tauri v2 shell that runs the Blissful React UI (`apps/blissful-mvs`) on
**Android TV**. It re-implements, for Android, what the Windows
`apps/blissful-shell` does natively: the `window.blissfulDesktop` bridge, the
same-origin backend proxy, and an update check (notify-only on Android).

> **Status: Phase 0 scaffold.** This compiles into a Tauri app and gets you to
> "UI renders + bridge handshake + proxy running." The native **player** and
> the embedded **torrent streaming server** are not built yet — see
> [`SPEC.md`](./SPEC.md) for the full plan and [`docs/PORT-MAP.md`](./docs/PORT-MAP.md)
> for the grounded codebase analysis this scaffold is based on.

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
- **No torrents in v1.** `ensureStreamingServer` returns `false`; the UI must
  route magnet links to a "Real-Debrid required" state (Phase 2 task). RD
  streams are direct HTTPS and work without the local server.
- **PWA service worker:** disable VitePWA for the Tauri build (it caches
  `/addon-proxy|storage|stremio` with NetworkFirst and may not register under
  the Tauri origin). See SPEC.md.
