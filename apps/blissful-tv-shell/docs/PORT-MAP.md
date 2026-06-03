# Blissful → Android TV Port Map

> Generated from an exhaustive multi-agent reread of the codebase (8 subsystem
> readers → synthesis → 4 adversarial critic passes; 55 findings, 30
> blocker/high). This is the grounded analysis the scaffold + [`SPEC.md`](../SPEC.md)
> are built on. All claims were verified against source.

## 1. System overview (corrected against the readers)

The root README / `CLAUDE.md` call Blissful "a native Windows Stremio client"
with "two UI modes". The reread establishes it is materially more:

- **A React 19 + TS SPA** (`apps/blissful-mvs`, Vite 7, HeroUI, Tailwind v4,
  React Router 7) with **three** UI modes: `classic`, `netflix`, and an
  unfinished `modern`.
- **A Rust shell** (`apps/blissful-shell`) that is (a) a same-origin reverse
  proxy (`ui_server.rs`: `/addon-proxy`, `/storage/*`, `/stremio/*`,
  `/resolve-url`, `/tmdb-season-info`); (b) an in-process libmpv player
  composited *behind* a transparent WebView2; (c) a supervisor for a bundled
  Node/libtorrent streaming server (`stremio-runtime.exe` on `127.0.0.1:11470`);
  (d) a SHA-256-verified GitHub auto-updater.
- **Multiple external backends**: Stremio Core API (`api.strem.io`), Cinemeta,
  arbitrary addon hosts, the local 11470 server, Real-Debrid CDNs, TMDB,
  AniSkip/ani.zip, TheIntroDB, and **a friend's `blissful.budinoff.com`**
  (MongoDB) backend.
- **A full social layer**: friends, presence, DMs, and **watch parties** with
  real-time playback sync over two WebSockets (`wss://blissful.budinoff.com/
  storage/ws/room` and `/ws/user`), deeply coupled into the player
  (`useWatchPartyMpv.ts`).

Net: a **Stremio-protocol client with a custom social/sync backend, a
desktop-grade libmpv player, and a bundled torrent engine.**

## 2. Portability matrix

| Subsystem | Anchor | Verdict | Reason |
|---|---|---|---|
| `desktop.ts` bridge | `lib/desktop.ts` | **needs-adapter** | 2-primitive `call`/`on`; inject over Tauri invoke/listen. |
| `platform.ts` detect | `lib/platform.ts` | **redesign-for-tv** | `isElectronDesktopApp()` false on TV → storage cross-origin. |
| Routing | `App.tsx` | **needs-adapter** | BrowserRouter vs Tauri origin; validate deep links. |
| `deepLinks.ts` | `lib/deepLinks.ts` | **portable-as-is** | URL building; `window.location.origin` must = proxy. |
| Player controls JSX | `NativeMpvPlayer/*` | **portable-as-is\*** | Reusable *iff* mpv bridge re-emitted natively. |
| libmpv + compositing | `player/mpv.rs` | **native-rebuild** | No Android analog; Surface-under-WebView. |
| SimplePlayer (`<video>`) | `SimplePlayer.tsx` | **drop-on-tv-v1** | Codec-limited; transcode penalty. |
| Streaming server 11470 | `streaming_server.rs` | **native-rebuild** | Bundled `.exe`; embed native or RD-only. |
| Addon client | `lib/stremioAddon.ts` | **needs-adapter** | OK iff `/addon-proxy` reprovided. |
| **Real-Debrid** | `streams.ts` | **portable-as-is** | Direct HTTPS to player; no local server. |
| Subtitle conv / opensubHash | 11470 | **native-rebuild** | Local-server-bound. |
| Storage/auth REST | `storageApi.ts` | **needs-adapter** | Needs proxy or backend CORS. |
| Watch-party sync | `useWatchParty*.ts` | **needs-adapter** | Re-point ~6 `desktop.*` calls + clock. |
| Friends/presence | `friendsApi.ts` | **portable-as-is** | Pure REST/WS, player-agnostic. |
| Party text-entry | `WatchPartyDrawer.tsx` | **drop-on-tv-v1** | Soft-keyboard grind. |
| Stremio FB link | `SettingsStremioPanel.tsx` | **redesign-for-tv** | `window.open`+postMessage impossible. |
| `netflix` mode | `layout/netflix/*` | **needs-adapter** | Closest to 10-foot; focus parity exists. |
| `classic` mode | `AppShell.tsx` | **redesign-for-tv** | Hover tooltips, focus rings removed. |
| `modern` mode | `ModernHomePage.tsx` | **drop-on-tv** | Unfinished, not persisted. |
| Theme tokens / fonts | `index.css` | **portable-as-is** | CSS vars + `@font-face`. |
| Pages | `pages/*` | **redesign-for-tv** | hover + `innerWidth`/UA misclassify TV. |
| Providers | `context/*` | **portable-as-is** | Pure React state. |
| Local state | `progressStore.ts` | **portable-as-is** | localStorage works in WebView. |
| `streamHistory.ts` | `lib/streamHistory.ts` | **needs-adapter** | HEVC purge is false on native decoder. |
| Continue-watching open | `useContinueWatchingActions.ts` | **native-rebuild** | Codec heuristics + `/resolve-url`. |
| Updater | `updater.rs` | **drop / redesign** | Notify-only on Android. |
| Rust shell | `blissful-shell/src/*` | **native-rebuild** | WebView2/NWG/Win32 → Tauri Activity. |
| `ui_server.rs` proxy | `ui_server.rs` | **needs-adapter** | Reimplement on localhost (done: proxy.rs). |
| tray / release.yml | `tray.rs` | **drop / rebuild** | No tray; CI → gradle/AAB. |

## 3. Native bridge contract (consolidated)

Seam: `window.blissfulDesktop = { runtime:'native', call, on }`. Under Tauri,
`call → invoke('bridge', {command,args})`, `on → event.listen`.

**Commands (UI → native):** `getAppVersion`, `log`, `ensureStreamingServer`
(**High** — no `.exe` on Android), `play`/`pause`, `seek(sec, rel|abs)`
(**High** — `+exact` frame-accurate, load-bearing for Skip-Intro), `mpv.command`
(loadfile/stop/sub-*/audio-*/cycle/screenshot — allow-listed), `mpv.setProperty`
(sid/aid/volume 0–200/sub-ass-* — **subtitle force-style is the very-high gap**),
`mpv.getTracks`, `mpv.getChapters` (**High** — no media3 chapter API),
`toggleFullscreen`/`isFullscreen` (no-op `true`), `openPlayer` (no-op),
`getUpdateStatus`/`downloadUpdate`/`installUpdate` (**drop** → notify-only).

**Events (native → UI):** `mpv-prop-change` for `time-pos`, `playback-time`,
`duration`, `pause`, `paused-for-cache`+`seeking` (the two buffering signals),
`volume`/`mute`, `aid`/`sid`, `video-params/gamma` (HDR), `dwidth`/`dheight`
(4K), `chapter`; `mpv-event` `FileLoaded`/`StartFile`/`PlaybackRestart`/`EndFile`
(`eof` → binge)/`Seek`/`Shutdown`; `fullscreen-changed` (n/a); `update-*`.

**Decision:** the bridge is a *string-typed mpv vocabulary*, so the cleanest
port is a **native player adapter that emulates the exact mpv prop/event names**
rather than rewriting the ~2,400-line `NativeMpvPlayer.tsx`. libmpv-android does
this 1:1; media3 needs a translation layer (and can't fully cover ASS + chapters).

## 4. External backends & origins

The desktop's CORS trick: everything is same-origin behind `ui_server.rs`. Under
Tauri the origin becomes `http://tauri.localhost`, so **every relative path
breaks unless a same-origin-style proxy is reprovided** (→ `proxy.rs` on
`127.0.0.1:11471`, with the UI pointing its base there on Android).

Key origins: `blissful.budinoff.com/storage` (auth/prefs/library/DMs — proxy,
forwards `authorization`+`x-stremio-auth`); `wss://.../ws/{room,user}` (watch
party/user push — **direct**, WS can't be proxied → backend Origin-allowlist
risk); `/addon-proxy` (all addon manifest/meta/**stream**/subs — preserve
`classify_addon_proxy_target` allow-list + 11470 bypass); `127.0.0.1:11470`
(torrent engine — native-rebuild); `/resolve-url` (RD DMCA-placeholder HEAD);
`/stremio/*` → `www.strem.io` (FB login — **drop/redesign**);
`/tmdb-season-info` (episodes drawer); `api.strem.io` (direct, CORS-open);
`ani.zip`/`aniskip` (direct, `ACAO:*`); `theintrodb` (direct, Origin-reflect);
TMDB (direct, embedded key); Real-Debrid CDN (**direct to the player, never the
WebView → no CORS**).

## 5. Real-Debrid path

RD is the **least problematic** subsystem and the strongest case for an RD-first
v1. (1) `useAddonsManager.ts` swaps plain Torrentio URLs for
`torrentio.strem.fun/realdebrid=<KEY>/manifest.json`, so Torrentio returns
pre-resolved HTTPS debrid URLs. (2) `streams.ts` flags a row RD by
`addonName==='Torrentio RD'` or `/realdebrid/i`. (3) `NativeMpvPlayer.tsx` only
uses the local-server path for `magnet:`/streaming-server-shaped URLs; **any
other URL (i.e. RD HTTPS) is handed straight to `loadfile`**, bypassing 11470,
and never traverses the WebView. **Needs natively: essentially nothing.** Only
real TV work: the RD API key is a paste-only field → needs QR/device-code
pairing.

## 6. Player parity (media3 vs libmpv)

| Feature | libmpv today | media3 | Gap |
|---|---|---|---|
| HEVC/HDR/DV/TrueHD/DTS | HW, no transcode | First-class HW + tunneling | **Covered** (often better on Android). |
| Chapters / Skip-Intro | `getChapters()` | **No chapter API** | **Hard** — parse MKV/MP4 atoms or rely on AniSkip+IntroDB fallback (already exists). |
| Exact seek | `seek …+exact` | `SEEK_PARAMETER_EXACT` | Closeable; default wrong → silently degrades skip + party. |
| Track lists | `aid`/`sid` | `TrackSelectionParameters` | Closeable; map ids. |
| **Embedded ASS styling** | `sub-ass-override=force` + libass | size/fg/bg/edge only | **Hard** — no libass force-style; addon subs (HTML overlay) port cleanly. |
| HDR/4K badge | `gamma` + `dwidth` | `Format.colorInfo`+`VideoSize` | Closeable. |
| Volume 0–200 | software amp | 0..1 | Minor — cap or AudioProcessor. |
| Watch-party sync | ~10 Hz `playbackClock` + 8 broadcast points | poll | Closeable but tightly wired. |

**Verdict:** ASS-styling and chapters are the two media3 *cannot* fully close →
**libmpv-android is the lower-risk backend** (near-zero change to
`NativeMpvPlayer.tsx`). media3 buys first-class Android HDR/tunneling at the cost
of custom subtitle + chapter layers.

## 7. TV design system

**Brand tokens (`index.css`):** `--bliss-accent: #95a2ff` (lavender) +
`--bliss-accent-glow`. **Correction:** there is **no `--bliss-teal` CSS var** —
teal `#19f7d2` is only the PWA `theme_color` + a hardcoded focus glow. The named
accent is lavender. Fonts: body IBM Plex Sans, hero Fraunces, sidebar Mondwest;
`modern` uses an undeclared font. `solid-surface` is opaque `#2c2c2c` (no glass).
Tailwind v4, CSS-first (no config file).

**TV base = `netflix`** — the only mode with real focus parity (each `NetflixRow`
card is `role=button tabIndex=0`, `onFocus`+`onKeyDown` Enter/Space, grow gated on
`focusedId`, `:focus-visible` outline). `classic` *removes* focus outlines;
`modern` is broken (reverts to classic on reload).

**Hover-only with no focus path:** in-card Play/Info (`:hover` only, no
`:focus-within`); controls auto-hide is `mousemove`-driven (never shows on a
remote); rail arrows are mouse-only; episodes coverflow `onWheel`/touch only;
ChromePicker drag-wheel (D-pad-inoperable); MobileNav swipe; drag-dismiss
drawers. **No overscan/TV-safe insets anywhere.**

**Spatial-nav plan:** hard-pin `uiStyle='netflix'`; add a focus engine
(Norigin-Spatial-Navigation, web-based, fits the WebView); D-pad rail scrolling
(`scrollIntoView` on focus, fight `scroll-snap`); make hover affordances
`:focus-within`-reachable; map remote keys at the WebView (OK→play/pause+reveal,
D-pad→focus not seek, Back→close, MEDIA keys→transport); ~5% overscan padding;
swatch grid instead of ChromePicker; QR/device-code for text entry.

## 8. Scaffold validation

"Tauri v2 Android (TV-only) + reuse UI via withGlobalTauri + `window.blissfulDesktop`
adapter + native player + embedded server + notify-only updates" — **holds up,
with corrections:**

- ✅ bridge adapter, TV-only scope, notify-only updates — sound.
- ⚠️ **Prefer libmpv-android over media3** (ASS + chapters). Biggest correction.
- ⚠️ **Surface-under-transparent-WebView compositing** is the top unproven risk;
  spike it first.
- ⚠️ **Embedded server** needs a concrete decision; **ship RD-only for v1** and
  route magnets to a graceful state (the UI currently throws otherwise).
- ⚠️ **Same-origin proxy is mandatory** (not in the original scaffold — now
  `proxy.rs`); also fix `isElectronDesktopApp()`/`isMobile()` so storage uses
  the proxy and the TV doesn't get the phone layout.
- ⚠️ `streamHistory.ts` HEVC purge breaks resume on a native decoder.
- ⚠️ Validate `BrowserRouter` under the Tauri origin (HashRouter fallback).

## 9. Phased plan

- **Phase 0 — scaffold + bridge handshake.** Tauri Android (leanback),
  withGlobalTauri, inject `window.blissfulDesktop` over invoke/listen, generalize
  platform detection. Exit: `isNativeShell()` true; non-player UI renders.
- **Phase 1 — proxy + storage/auth/social online.** `proxy.rs` (ported
  `classify_addon_proxy_target` + headers); point UI base at it; verify
  login/Continue-Watching/friends/WS under the Tauri origin. Exit: login + lists.
- **Phase 2 — native player adapter (RD-only).** Surface-under-WebView
  compositing; libmpv-android emitting the mpv vocabulary; RD HTTPS → loadfile;
  fix HEVC purge; magnet → "torrents later". Exit: RD playback with buffering
  veil, tracks, HDR/4K, overlay subs, AniSkip/IntroDB skip.
- **Phase 3 — TV design pass.** Pin netflix; spatial nav; D-pad rails; focus
  for hover affordances; overscan; remote-key map; drop modern/classic. Exit:
  fully remote-navigable.
- **Phase 4 — watch-party on the native player.** Re-point `useWatchPartyMpv`;
  ~10 Hz position store; invite-link/friend-row join. Exit: party lock-step.
- **Phase 5 — RD-key pairing + notify-only updates + (optional) torrents.**
  QR/device-code key entry; update deep-link; optionally embed a native torrent
  server on 11470. Exit: parity (or RD-only ship).
