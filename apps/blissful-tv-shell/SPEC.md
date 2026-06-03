# Blissful for Android TV — Implementation Spec

**Target:** an Android **TV** APK (leanback) that runs the existing Blissful
React UI in a Tauri v2 WebView, plays **Real-Debrid** streams (torrents
deferred), keeps the friend's `blissful.budinoff.com` backend (auth, prefs,
library, friends, watch party), and checks for updates **notify-only** (a "newer
version available" toast linking to the release — no auto-download/install).

This spec is grounded in a full multi-agent reread of the codebase. The
evidence base is [`docs/PORT-MAP.md`](./docs/PORT-MAP.md) (architecture +
portability matrix + bridge contract + per-subsystem verdicts). Read that for
the "why"; this file is the "what to build".

---

## 1. Locked decisions

| # | Decision | Why (from the reread) |
|---|---|---|
| D1 | **Tauri v2**, TV-only build | WebView+Rust+bridge maps 1:1 onto the existing Windows shell; reuses ~70% of the UI. |
| D2 | **Reuse the React UI as-is**, inject `window.blissfulDesktop` over Tauri invoke/listen | The native seam is a 2-primitive contract (`call`/`on`); the WebView2 `JS_SHIM` is non-portable, so we re-create the same object on Tauri. |
| D3 | **WebView stays on `http://tauri.localhost`** (cleartext scheme) | The UI fetches cleartext `127.0.0.1:11470/11471`; an https origin would mixed-content-block them. |
| D4 | **Same-origin-style proxy in Rust** (`proxy.rs`, `127.0.0.1:11471`), UI points its network base there on Android | Under the Tauri origin every relative `/addon-proxy`, `/storage/*`, … has no server. Faithful port of `ui_server.rs` keeps the relative-URL contract + the security allow-list. |
| D5 | **Player backend: libmpv-android** (media3 only if Android HDR-tunneling is later mandated) | media3 cannot reproduce ASS subtitle force-styling or MKV chapters — both load-bearing. libmpv = near-zero change to `NativeMpvPlayer.tsx`. |
| D6 | **RD-only for v1; torrents deferred** | RD streams are direct HTTPS to the player, server-free; the 11470 torrent engine has no `.exe` path on Android and is the largest native rebuild. |
| D7 | **TV theme = `netflix` mode, pinned**, restyled to the brand tokens; drop `classic`+`modern` on TV | `netflix` is the only mode with real keyboard-focus parity; `classic` strips focus rings, `modern` is broken. |
| D8 | **Notify-only updates** | Android can't (and shouldn't) silently install; `useDesktopUpdater` is fully `isNativeShell()`-gated. |
| D9 | **Spatial navigation via a web focus engine** (Norigin-Spatial-Navigation) | The UI is React DOM in a Chromium WebView; a web (not React-Native) engine fits. |

---

## 2. Architecture

```
┌───────────────────────────── Android TV device ─────────────────────────────┐
│  Tauri Activity (FrameLayout)                                                │
│   ┌───────────────────────────────────────────────────────────────────┐    │
│   │ [Phase 2] libmpv SurfaceView  (video plane, BELOW the WebView)     │    │
│   ├───────────────────────────────────────────────────────────────────┤    │
│   │ Android System WebView  (transparent bg)  http://tauri.localhost   │    │
│   │   └── Blissful React UI (apps/blissful-mvs, netflix mode pinned)   │    │
│   │         window.blissfulDesktop = { runtime:'native', call, on }    │    │
│   │            call → invoke('bridge')      on → event.listen          │    │
│   └───────────────────────────────────────────────────────────────────┘    │
│  Rust (lib.rs)                                                               │
│   ├── bridge.rs    — command dispatch (player stubs → Phase 2)               │
│   ├── proxy.rs     — 127.0.0.1:11471  /addon-proxy /storage /stremio /...    │
│   ├── updater.rs   — notify-only GitHub release check                        │
│   └── [Phase 5] native streaming server — 127.0.0.1:11470 (torrents)         │
└──────────────────────────────────────────────────────────────────────────────┘
        │ direct HTTPS (RD CDN, api.strem.io, ani.zip…)   │ wss:// (watch party)
        ▼                                                  ▼
  Real-Debrid / addons / Stremio API            blissful.budinoff.com (friend)
```

Bytes for Real-Debrid playback go **straight to the native player**, never
through the WebView → no CORS, no proxy. The proxy only carries
addon/storage/stremio metadata + small JSON.

---

## 3. What the Phase-0 scaffold delivers (this commit)

Compiles into a Tauri app; gets to **"UI renders + bridge handshake + proxy
running."** Player and torrent server are not built yet.

Created under `apps/blissful-tv-shell/`:

- `src-tauri/{Cargo.toml,tauri.conf.json,build.rs}` — Tauri v2 project pointing
  `frontendDist` at `../../blissful-mvs/dist`.
- `src-tauri/src/main.rs` + `lib.rs` — desktop + `mobile_entry_point`.
- `src-tauri/src/bridge.rs` — the `bridge` command. Real: `getAppVersion`,
  `log`, `getUpdateStatus`. Graceful: `ensureStreamingServer`→`false`,
  player ops→no-op, `toggle/isFullscreen`→`true`. Errors: `download/installUpdate`.
- `src-tauri/src/proxy.rs` — faithful `ui_server.rs` port incl.
  `classify_addon_proxy_target` + the header allow-list + its 7 unit tests.
- `src-tauri/src/updater.rs` — notify-only GitHub `releases/latest` check.
- `src-tauri/capabilities/default.json`, `docs/MANIFEST_PATCH.md`, `README.md`.

Additive, `isTauri()`-guarded changes in `apps/blissful-mvs/` (Windows build
untouched):

- `src/lib/tauriBridge.ts` — installs `window.blissfulDesktop` over Tauri.
- `src/lib/proxyBase.ts` — `PROXY_BASE` = `http://127.0.0.1:11471` on Android.
- `src/lib/platform.ts` — `isTauri()`, `isAndroidTv()`.
- `src/main.tsx` — imports the bridge adapter.

**Run:** see [`README.md`](./README.md). **Verify Phase 0:** after
`tauri android dev`, in the WebView console `window.blissfulDesktop.runtime`
=== `'native'` and `await window.blissfulDesktop.call('getAppVersion')` returns
the version.

---

## 4. Phase 1 — make the backends reachable (the proxy wiring)

`proxy.rs` runs, but the UI still fetches relative paths that resolve against
`tauri.localhost`. Point them at `PROXY_BASE` on Android. **All edits are
`isTauri()`/`PROXY_BASE`-guarded so the Windows/browser builds are unchanged.**

Exact call sites (verified line refs):

1. **`src/lib/stremioAddon.ts:171`** — `resolveAddonFetchUrl`:
   ```ts
   // was: `/addon-proxy?url=${encodeURIComponent(u)}`
   import { proxyUrl } from './proxyBase';
   return proxyUrl(`/addon-proxy?url=${encodeURIComponent(u)}`);
   ```
2. **`src/lib/storageBaseUrl.ts:16`** — add a Tauri branch *before* the
   `isElectronDesktopApp()` branch:
   ```ts
   import { isTauri } from './platform';
   import { PROXY_BASE } from './proxyBase';
   export const STORAGE_URL = isTauri()
     ? `${PROXY_BASE}/storage`            // Android: absolute to the proxy
     : isElectronDesktopApp() ? '/storage'
     : (import.meta.env.VITE_STORAGE_URL ?? DEFAULT_STORAGE_URL);
   ```
   WS stays direct (`wss://blissful.budinoff.com/storage`).
3. **`src/lib/storageApi.ts`** — **delete its duplicate `STORAGE_URL` block**
   and import from `storageBaseUrl.ts` (the header already claims to be the
   single source of truth — make it true). Otherwise storage is half-fixed.
4. **`src/lib/deepLinks.ts:108`** — `normalizePlaybackUrl` builds
   `${window.location.origin}/stremio-server…`; under Tauri that origin is
   `tauri.localhost`. Decide the local-server contract (Phase 2/5): for v1 (RD
   only) this path is unused, but guard it to `PROXY_BASE` to avoid a wrong URL.

Backend dependencies to confirm **with the friend** before Phase 1 closes:

- **WS Origin:** `ws/user` + `ws/room` connect directly; the WebView stamps
  `Origin: http://tauri.localhost`. If the backend enforces an Origin
  allow-list on the WS upgrade, presence/DMs/watch-party silently never
  connect. **Ask the backend owner to allow the `tauri.localhost` Origin** (and
  the desktop `127.0.0.1` origin). If they can't, the WS must be tunneled
  through a Rust WebSocket client (which can set Origin) — extra native work.
- **REST CORS:** the proxy adds permissive CORS, so REST is fine as long as it's
  proxied. Do **not** rely on the backend's own CORS.

**Exit:** login, Continue-Watching, library, friends, catalogs all populate on
the TV.

**Wired in this commit (Phase 1 code edits — all `proxyUrl()`/`isTauri()`-guarded,
so `PROXY_BASE===''` off-Tauri leaves Windows/browser byte-for-byte unchanged):**

- `stremioAddon.ts` `resolveAddonFetchUrl` → `proxyUrl(...)` (covers manifest /
  catalog / meta / stream / subtitle / opensubHash fetches).
- `useAddonRows.ts`, `useImdbRating.ts` (×3), `tmdb.ts` (`/addon-proxy` +
  `/tmdb-find`) — the scattered inline addon-proxy/TMDB fetches.
- `DetailPage.tsx` `/tmdb-season-info`; `useContinueWatchingActions.ts`
  `/resolve-url`.
- `storageBaseUrl.ts` — added the `isTauri()` → `${PROXY_BASE}/storage` branch
  (covers `friendsApi`, `blissfulAuthApi`, `stremioLinkApi`, `watchParty` REST,
  which all import `STORAGE_URL`). WS stays direct (`wss://…`, Origin confirmed OK).
- `storageApi.ts` — **deduped**: deleted its private `STORAGE_URL` copy, now
  imports the single source of truth from `storageBaseUrl.ts`.
- `proxy.rs` — added the `/tmdb-find` route.

**Still raw (intentionally deferred):** `NativeMpvPlayer.tsx` `/resolve-url` +
`/addon-proxy` subtitle fetches and the `127.0.0.1:11470` hardcodes (Phase 2,
with the native player); `/stremio-server` rewrites (`deepLinks.ts`/`streams.ts`)
+ the FB-login `/stremio/` popup (Phase 2/5 torrents + login redesign); the
share-invite `window.location.origin` link (`WatchPartyDrawer.tsx`, Phase 4 —
must become a public web URL, not `tauri.localhost`).

---

## 5. Phase 2 — the native player (the core rebuild)

> Full design + the adversarial-verify corrections: [`docs/PHASE2-PLAN.md`](./docs/PHASE2-PLAN.md).
> The go/no-go hardware spike to run FIRST: [`docs/PHASE2-SPIKE.md`](./docs/PHASE2-SPIKE.md).
>
> **Two pre-conditions gate this phase** (neither is code — both decided/run by you):
> 1. **Licensing decision** — the recommended libmpv AAR is GPL; the project is
>    LGPL today. Accept GPL for Android, or rebuild LGPL. See §9.
> 2. **Compositing hardware spike passes** — prove a video Surface renders under
>    the transparent WebView on real TV boxes (Amlogic/Mali), with a sustained
>    4K-HDR perf gate, before any player code.

This is the biggest piece. Sub-steps in order:

1. **Compositing spike FIRST (top unproven risk).** A native Android plugin
   that inserts a libmpv `SurfaceView`/`TextureView` *under* the Tauri WebView in
   the Activity's `FrameLayout` and sets `webView.setBackgroundColor(0)`. Prove
   the React controls overlay renders over live video before any feature work.
   `NativeMpvPlayer.tsx` already renders a transparent middle and injects
   transparency CSS — that assumption must hold natively.
2. **Player adapter emulating the mpv vocabulary** (so `NativeMpvPlayer.tsx`,
   ~2,400 lines, is reused unchanged). Implement the commands + re-emit the
   exact `mpv-prop-change`/`mpv-event` names from [`PORT-MAP.md §3`](./docs/PORT-MAP.md).
   Load-bearing details: `seek` must be frame-exact; `paused-for-cache`+`seeking`
   drive the buffering veil; `video-params/gamma`+`dwidth/dheight` drive the
   HDR/4K badges; `chapter` + `getChapters` drive Skip-Intro (fallback:
   AniSkip/IntroDB, already implemented in `useSkipSegments.ts`).
3. **RD-only routing + graceful torrent degrade.** `ensureStreamingServer`
   returns `false` (done). In `NativeMpvPlayer.tsx:1126-1153` route `magnet:` /
   streaming-server-shaped URLs to a clear **"Real-Debrid required — torrents
   coming later"** state instead of throwing. RD/direct-HTTPS → `loadfile`.
4. **Fix `streamHistory.ts:55-62`** — the `/(x265|h265|hevc)/i` purge is a
   `<video>`-only assumption; gate it on the active player (keep only for the
   SimplePlayer fallback) or Continue-Watching loses HEVC resume entries.
5. **`PlayerPage.tsx:196`** — the `isNativeShell()` gate that picks
   `NativeMpvPlayer` vs `SimplePlayer` already works once the bridge is injected.

**Exit:** RD playback with buffering veil, audio/subtitle tracks, HDR/4K badges,
addon HTML-overlay subtitles, and AniSkip/IntroDB skip.

---

## 6. Design system — TV-configured, themes reconciled to the React main theme

> Your ask: *"design researched to respond to the current one but TV-configured,
> and the other themes (Netflix etc.) fixed according to React and the main
> theme."* This section is the answer.

### 6.1 The canonical "main theme" tokens (single source of truth)

From `apps/blissful-mvs/src/index.css`, corrected against the reread:

| Token | Value | Note |
|---|---|---|
| Accent | `--bliss-accent: #95a2ff` (lavender) | **The real brand accent.** |
| Accent glow | `--bliss-accent-glow: rgba(149,162,255,.55)` | for focus halos |
| ~~Teal~~ | `#19f7d2` | **Not a CSS var** — only the PWA `theme_color` + a stray hardcoded glow. *Reconcile: treat lavender as the one accent; stop using teal for focus.* |
| Surface | `solid-surface` = `#2c2c2c` dark / `#f2f2f2` light | opaque, **no glass** despite docs |
| Body font | IBM Plex Sans | self-host (no CDN) |
| Display font | Fraunces (serif) | hero/titles |
| Radii | `rounded-2xl` / `[28px]` / `[36px]` | hero = 36px |
| App bg | `#0a0a0a` | matches PWA `background_color` |

**Rule:** the TV theme uses *only* these tokens. The earlier "two themes
classic+netflix" and the experimental `modern` are reconciled as: **`netflix` is
THE TV theme** (it already matches these tokens — Fraunces hero titles, lavender
focus via `--bliss-accent`), `classic` and `modern` are **excluded from the TV
bundle** (D7).

### 6.2 TV adaptations layered on the netflix theme

| Concern | Spec |
|---|---|
| **Theme lock** | Hard-pin `uiStyle='netflix'` at the provider level for the TV build (bypass the netflix/classic-only persistence in `UIProvider.tsx`). Don't expose the theme toggle on TV. |
| **Focus ring** | One accent only (lavender). Focus = **≥3px outline `--bliss-accent` + `--bliss-accent-glow` halo**, high-contrast, visible at 3 m. Extend the existing `.netflix-landscape-card:focus-visible` rule app-wide. |
| **Card focus growth** | Keep the netflix card grow-on-`focusedId`; make `onFocus` (not just `onMouseEnter`) the trigger everywhere. |
| **Overscan** | Global TV-safe inset on the netflix root: **~5% (≈48px @1080p horizontal, ≈27px vertical)**. All absolutely-positioned player overlays (TopOverlay, BottomControls, HDR/4K badges, Skip button, toasts, splash) must respect it. Add `--tv-safe-x`/`--tv-safe-y` tokens. |
| **Type scale** | Min body 18sp-equiv; bump hero/row titles for 10-foot legibility. |
| **Hover → focus** | Every `:hover`-only reveal gets a `:focus-within`/`:focus-visible` twin: in-card Play/Info focusable (or collapse card to single OK=open + move Play/Info to the detail page); `StreamList` play affordance; reaction/remove buttons. |
| **No touch-only UI** | Drop MobileNav swipe, drag-dismiss drawers, episodes coverflow wheel/touch — replace with D-pad + focusable buttons. |
| **Color picker** | Don't mount `react-color` ChromePicker on TV; use the focusable swatch grid (already exists in `SettingsPanel`). |

### 6.3 Spatial navigation (Phase 3)

- Add **Norigin-Spatial-Navigation** (web, hooks-based) covering topbar ↔ rails
  ↔ rail-items ↔ hero buttons ↔ modals.
- **D-pad rail scroll:** on card focus `scrollIntoView({inline:'center'})`;
  advance at rail edges; neutralize CSS `scroll-snap` fighting focus-scroll;
  hide mouse arrows on TV.
- **Player input:** OK / D-pad-Down reveals + focuses the control bar; Left/Right
  moves focus between controls (NOT seek) while the bar is focused; dedicate seek
  to a focused scrub bar or `MEDIA_FF/REW`; reset auto-hide on any key. Today
  `mpv.rs` sets `input-default-bindings=no`, so **all input is the WebView's job**.
- **Overlay/Back stack:** Android Back / Escape pops the topmost layer (close
  drawer/modal/trailer before exiting the player). Trailer YouTube iframes must
  be non-focusable or have a focusable close button (else D-pad focus trap).

### 6.4 Text entry on a remote (Phase 3/5)

Remote text entry is miserable; minimize it:

- **RD API key** and **Stremio account link** → **QR / device-code pairing**
  (show a code+URL/QR on the TV; finish on a phone; TV polls the backend). The
  `window.open`+`postMessage` Facebook/link popup (`SettingsStremioPanel.tsx:154`)
  is structurally impossible in a TV WebView — replace it.
- **Watch-party join** → invite-link / friend-row, not manual code typing.
- **Search** → on-screen IME; consider voice later.

---

## 7. Risk register (the 30 blocker/high findings)

Status: ✅ addressed in scaffold · ◻ planned (phase) · ⚠ needs external input.

| Sev | Finding | Disposition |
|---|---|---|
| B | Scaffold didn't compile (no `lib.rs`/`run`, no icons/capabilities) | ✅ `lib.rs`/`bridge.rs`/`proxy.rs`/`updater.rs`/`capabilities` added; run `tauri icon` + `android init` |
| B | Nothing injects `window.blissfulDesktop`; WebView2 shim non-portable | ✅ `tauriBridge.ts` |
| B | Relative backend paths break; no same-origin proxy | ✅ `proxy.rs` + `proxyBase.ts`; ◻ P1 call-site wiring |
| B | ASS subtitle force-style has no media3 equivalent | ◻ P2 (D5: libmpv-android) |
| B | No spatial-navigation engine | ◻ P3 (Norigin) |
| B | Horizontal rails not D-pad-scrollable | ◻ P3 |
| B | Player controls unreachable by D-pad (reveal is mouse-only) | ◻ P3 |
| B | Episodes-drawer coverflow traps the remote | ◻ P3 |
| B | Friend's backend CORS posture unproven | ⚠ P1 (proxy mitigates REST; confirm) |
| B | Storage base double-defined + `isElectronDesktopApp()` gating | ◻ P1 (edits in §4.2/4.3) |
| H | `isElectronDesktopApp()` false on Android → storage cross-origin | ◻ P1 |
| H | Mixed content: https WebView ✗ http `127.0.0.1` | ✅ D3 http scheme + `network_security_config` (MANIFEST_PATCH) |
| H | No leanback manifest | ✅ `docs/MANIFEST_PATCH.md` (apply post-init) |
| H | Embedded 11470 server has no Android path; UI throws on magnet | ◻ P2 graceful degrade; ◻ P5 native server |
| H | media3 is the wrong default player | ✅ D5 libmpv-android |
| H | Surface-under-WebView compositing unproven | ◻ P2 spike first |
| H | MKV/MP4 chapters unsupported by media3 | ◻ P2 (libmpv, or AniSkip/IntroDB fallback) |
| H | Exact-seek default wrong → degrades skip + party | ◻ P2 |
| H | Watch-party coupled to ~10 Hz `playbackClock` + 8 broadcast points | ◻ P4 |
| H | Hover-only in-card actions have no focus path | ◻ P3 (§6.2) |
| H | Text entry remote-hostile (login/RD/addon/room/search) | ◻ P3/P5 pairing (§6.4) |
| H | ChromePicker drag-wheel D-pad-inoperable | ◻ P3 (swatch grid) |
| H | No overscan / TV-safe area | ◻ P3 (§6.2) |
| H | `isNativeShell()`-gating can silently degrade the whole UI | ✅/◻ inject bridge at first paint (P0) + `isAndroidTv()` force-TV |
| H | Three modes; only netflix TV-viable | ◻ P3 (D7 pin netflix) |
| ~~H~~ | WS Origin (`tauri.localhost`) rejected by backend | ✅ **Resolved** — backend returns 101 for any Origin (empirically tested); watch-party/friends/presence work with zero native work |
| H | Orphaned `/stremio-server` route (no proxy handler) | ◻ P1/P2 (decide local-server contract) |
| H | Local 11470 server can't be spawned on Android | ◻ P5 (or RD-only ship) |
| H | FB/Stremio link `window.open`+postMessage impossible on TV | ◻ P1/P3 device-code (§6.4) |
| M | `BrowserRouter` deep-link/refresh unvalidated under Tauri origin | ◻ P1 (test `/invite/:code`, `/player`; HashRouter fallback) |

Mediums also tracked: `isMobile()` misclassifies TV as phone (`features/home/
utils.ts:7` — add leanback branch); `mapTransportUrl` `host.docker.internal`
rewrite is wrong on Android; trailer iframe focus trap; controls auto-hide never
resets on key; CSP disabled (`csp:null`) — add a real CSP before store
submission; `tmdb-season-info` strategy (proxy vs direct embedded key).

**Phase 2 additions (from the player/compositing design verify pass):**

| Sev | Finding | Disposition |
|---|---|---|
| B | libmpv AAR is **GPL**, project is LGPL | ⛔ decide (§9 item 0) before any libmpv code |
| H | libmpv-under-WebView compositing unproven on TV-GPU hardware | ◻ P2 — hard spike gate ([`PHASE2-SPIKE.md`](./docs/PHASE2-SPIKE.md)), weeks, on ≥2 boxes |
| H | `dev.jdtech.mpv:libmpv:1.0.0` is **instance-based**, not static `MPVLib` | ◻ P2 — use `MPVLib.create(ctx)…`; verify signatures |
| H | EndFile reason isn't lowercase `eof` → binge auto-advance never fires | ◻ P2 — map reason int → `eof/stop/quit/…` (likely a latent Windows bug too) |
| H | `time-pos` cadence + `paused-for-cache`/`seeking` veil must be verified on Android | ◻ P2 — spike gates (≥5 Hz; flag transitions) |
| ✅ | `ensureStreamingServer` returned `false` (blocks RD playback) | ✅ flipped to `true` in `bridge.rs` |
| M | MPVLib singleton fragile across Activity recreation | ◻ P2 — lock `android:configChanges` for the player Activity |
| M | high-freq events on native pthread | ◻ P2 — throttle ~5 Hz on the Kotlin side before `trigger` |

---

## 8. Phased plan (summary)

| Phase | Goal | Exit criterion |
|---|---|---|
| **0** | Scaffold + bridge handshake | `isNativeShell()` true; non-player UI renders | 
| **1** | Proxy wiring + backends online | login + Continue-Watching + friends populate; WS connects |
| **2** | Native player (libmpv-android), RD-only | RD playback: veil, tracks, HDR/4K, overlay subs, skip |
| **3** | TV design pass (netflix pinned + spatial nav + overscan) | fully remote-navigable, no hover/touch dead ends |
| **4** | Watch-party on the native player | hosted/joined party stays in lock-step |
| **5** | RD-key/Stremio-link pairing + notify updates + (optional) torrents | parity, or RD-only ship |

Full per-phase file/contract detail: [`docs/PORT-MAP.md §9`](./docs/PORT-MAP.md).

---

## 9. Decisions & open questions

**Resolved (2026-05):**

- ✅ **WS Origin:** backend returns `101 Switching Protocols` for *any* Origin
  (empirically tested incl. `http://tauri.localhost`, desktop, random, none) — it
  does **not** enforce Origin on `ws/user` or `ws/room`. Watch-party / friends /
  presence work directly from the WebView with **no native WS tunnel needed**.
- ✅ **v1 scope: Real-Debrid only**, torrents deferred (Phase 5).
- ✅ **Distribution: sideload APK** → keep the notify-only updater (a "newer
  version available" toast linking to the GitHub release; no auto-install).

**Still open:**

0. **⛔ Licensing (BLOCKER — decide before any Phase 2 code):** the recommended
   `dev.jdtech.mpv:libmpv` AAR bundles **GPL** ffmpeg (`--enable-gpl
   --enable-version3`). The project is **MIT source / LGPL bundle** today (Windows
   ships LGPL libmpv on purpose). Options: **(a)** accept GPL for the Android
   artifact + document it (Android static-links anyway, so the DLL-swap
   affordance is gone regardless), or **(b)** rebuild ffmpeg/mpv **LGPL** for
   Android (`media-kit/libmpv-android-video-build`) + a thin JNI (more work).
1. **RD onboarding:** OK to require **phone/QR pairing** for the RD API key (vs
   remote typing)? Does the backend already expose a device-code/pairing
   endpoint, or does it need one? (Phase 3/5.)
2. **`/tmdb-find` backend route:** Phase 1 routes the no-user-key TMDB fallback
   through the proxy to `blissful.budinoff.com/tmdb-find` — confirm that route
   exists on the backend (else users must set their own TMDB key; degrades to
   null gracefully).
3. **HDR display** (not just the badge): is HDR10/DV passthrough to the panel a
   v1 requirement? If yes, validate on target hardware early (nudges toward
   media3 + a custom subtitle/chapter layer).
