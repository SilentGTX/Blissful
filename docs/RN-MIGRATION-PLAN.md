# Blissful TV → React Native Migration Plan (v2)

**Branch:** `react-native-blissful` · **Status:** PLAN ONLY — no implementation yet
**Target device:** Philips 65PUS7354/12 (2019, **Android 9 / API 28**, MediaTek MT5887 Cortex-A53, Mali-G31, ~1.5–2 GB RAM) and similar low-end panels
**Produced from:** a 12-agent codebase inventory (every subsystem of `apps/blissful-mvs` + `apps/blissful-tv-shell`), 3 web-research passes (audio codecs, RN-TV stack, platform questions), a completeness critic, an adversarial plan review, and a 3-fact verification pass.

### v2 changelog (what an adversarial review + fact-check changed)
- **Verified the 3 plan-shaping facts** (§0). minSdk is *not* a blocker (API 24 floor); the RN-TV focus New-Arch regression is real → **JS navigator stack** mitigation; API-28 passthrough detection is weak → **decode-by-default + init-failure guard**.
- **Cleartext HTTP**: §8's "problem class deletes" was wrong — Android-9 NSC blocks cleartext to external hosts. Now a Phase-0 gate.
- **ABI**: removed the unverified "arm64" assumption — `getprop` is the first Phase-0 command.
- **Auth**: rewritten around the current JWT/`blissfulAuthApi` reality (the old `stremioApi`/multi-account story was stale).
- **proxyUrl / Trakt base**: *injected* per-platform, not deleted (the deletion broke the shared web build).
- **BlissPlayer spec holes** fixed: `onIsLoadingChanged` bug, wake lock, MediaSession/media keys, `probeUrl` contract + module-level, LoadControl numbers, SurfaceView, tunneling, 24p, PGS subs.
- **Ops**: crash reporting (Sentry) + EAS staging/rollback/resume-fetch + PR CI added as real workstreams.
- **Sequencing**: LGPL ffmpeg build pulled to ≤ Phase 3; app-id decided at Phase 1.
- **§11 questions answered** (watch party in v1; drop pixel fonts; trailer as-is; no self-install; app-id; RD QR pairing).

---

## 0. Verified facts (checked against primary sources, 2026)

| Fact | Verdict | Consequence |
|---|---|---|
| **Can Expo SDK 56 / react-native-tvos 0.85 run on Android 9 (API 28)?** | **YES.** minSdk floor is **24** (Expo gradle template + docs "7+"); RN 0.85 / tvos 0.85 same. The "API 31" is the *emulator system image*, not minSdk. New-Arch-only has no minSdk implication. | Plan is viable on the exact target. Not a blocker. |
| **RN-TV focus restoration on New Arch** | Tickets #815/#670/#1706/#852 all **closed**, but #852 documents the focus-loss **regressing under the New Architecture** (which 0.85 forces). Root cause: native-stack/`react-native-screens` loses the native focus reference on screen detach. | **Default to the JS stack** (`@react-navigation/stack` + `enableScreens(false)`) on TV; A/B vs native-stack in Phase 0. The JS-stack mitigation is corroborated-by-assembly, not a single primary doc — validate on hardware. |
| **Audio passthrough detection on API 28** | `AudioTrack.isDirectPlaybackSupported` is **API 29+** (and `AudioManager.getDirectPlaybackSupport` is 31+) — **absent on the target.** API 28 falls back to the `ACTION_HDMI_AUDIO_PLUG` sticky-intent path (`EXTRA_ENCODINGS`/`EXTRA_MAX_CHANNEL_COUNT`), which is documented to mis-report (ExoPlayer #7669, androidx/media #396). | **Decode by default** (ffmpeg software audio) — don't trust passthrough detection on this panel. Attempt passthrough only with an AudioTrack init-failure → recreate-in-decode-mode guard. For TV speakers (the common case) this is moot — just decode. |

---

## 1. Goals & success criteria

| # | Goal | Measured by |
|---|------|-------------|
| G1 | **Stremio-smooth UI** on the 65PUS7354 | Home/Detail D-pad nav with no perceptible jank; cold start ≤ Stremio's |
| G2 | **Every torrent plays with audio** (AAC, AC3, E-AC3, DTS, DTS-HD MA, TrueHD/MLP, FLAC, Opus, Vorbis, PCM) | Codec test matrix passes on the real panel, 2.0 and 5.1/7.1, TV-speaker decode + AVR passthrough |
| G3 | **4K HEVC RD streams play without crashing** | Hardware decode engaged; bounded buffers; no OOM during 4K |
| G4 | **Production OTA updates** — UI changes ship without APK pushes | One EAS Update cycle proven end-to-end on the TV, with rollback |
| G5 | **Feature parity** with the current Tauri TV app (incl. watch party — §11 q1) | The parity matrix in §7 fully dispositioned |
| G6 | Desktop/web app **behavior unchanged** | `apps/blissful-mvs` + `apps/blissful-shell` keep **`tsc -b` + `vitest` green and behavior unchanged** after importing `blissful-core` (not "byte-identical" — the shared package changes imports) |

Non-goals v1: on-device torrent engine (RD-only), DMs UI, Facebook login, netflix/modern UI styles, iOS/tvOS, APK self-install (§11 q4).

---

## 2. Decision record

| # | Decision | Why |
|---|----------|-----|
| D1 | **Expo SDK 56 + react-native-tvos@0.85-stable**, New Arch, Hermes v1, `@react-native-tvos/config-tv` | Only supported current RN-TV path; runs on API 28 (§0) |
| D2 | **EAS Build + EAS Update** for OTA (with staging channel + rollback + resume-fetch — §5.8) | Delivers G4; CodePush is dead |
| D3 | **Bespoke thin native Kotlin Media3/ExoPlayer module ("BlissPlayer")**, not react-native-video | RN-video can't enable the ffmpeg audio extension (no RenderersFactory hook); we need custom surface, mpv-shaped events, exact seek, `probeUrl`, MediaSession, wake lock anyway |
| D4 | **Media3 ffmpeg *audio* decoder extension** | The audio fix (§3) |
| D5 | **Video on MediaCodec hardware decode** (never a software video path) | 4K HEVC is easy for the SoC |
| D6 | **Monorepo**: `apps/blissful-tv-rn` + extracted `packages/blissful-core` | Reuse the TS brain; avoid OpenCode-style copy-drift |
| D7 | **react-native-mmkv** for persistence (synchronous), AsyncStorage only for one-time migration reads | progressStore/playerSettings/streamHistory need sync reads; progress writes can't hit the bridge |
| D8 | **No proxy server. Per-platform *injected* fetch base/adapter** (`identity` on RN, `proxyUrl` on web) — **do NOT hard-delete proxy wrapping from `blissful-core`** | RN has no CORS, but the *shared* web build still needs the proxy under its origin. Same injected pattern for storage base, Trakt base, addon-fetch base |
| D9 | **Backend helper endpoints stay** (`/img`, `/imdb-rating`, `/tmdb-find`, `/tmdb-season-info`) — called directly via the injected base | They carry server caching + API keys |
| D10 | **`probeUrl` is a standalone module-level native method** (OkHttp HEAD → `{finalUrl, contentLength, status}`), 10 s timeout, **unknown-length ⇒ 0 ⇒ fall through** | JS `fetch` HEAD is broken on Android; the CW dead-stream probe runs *before any player mounts*, so it can't be view-bound |
| D11 | **Subtitles v1**: embedded via Media3 SubtitleView (degraded ASS, no delay API); addon subs via our RN `<Text>` overlay (full styling). **libmpv engine = v2 escape hatch** for full ASS | §4 |
| D12 | **Only classic-TV UI mode** ships (drop netflix + modern) | UIProvider already forces classic on TV; cuts home-UI work ~3x |
| D13 | Styling: **plain StyleSheet** + a JS ThemeContext (accent/surface recolor); fonts **Fraunces + IBM Plex Sans only** (§11 q2) | Lowest TV risk; CSS-variable theming must become JS state |
| D14 | Lists: **FlatList + `getItemLayout` as the TV default** (proven D-pad focus); **FlashList only where profiling demands it**, behind a Phase-0 focus check | FlashList has known TV focus-loss (Shopify #895) — not a safe blanket default |
| D15 | **libVLC fallback is Phase-5 optional, off by default** | ffmpeg-audio + hw video covers ~99%; VLC is heavy on 1.5 GB RAM |
| D16 | **Trailer: keep current in-app behavior** (§11 q3) — `react-native-youtube-iframe` in a modal with a **focusable Close** (focus starts on Close, iframe not D-pad-reachable) | Matches today's UX; no leave-app intent |
| D17 | **Crash reporting from day one**: `@sentry/react-native` (JS) + a native crash handler/breadcrumbs | OTA can brick the UI on one firmware with zero signal otherwise; the desktop has shell.log + a panic hook |
| D18 | **MediaSession in BlissPlayer** | Handles separate hardware media keys (PLAY/PAUSE/STOP/REW/FFWD — RN `TVEventHandler` only emits combined playPause), plus CEC + Assistant "pause" + the now-playing card; Play Store rejects TV apps that ignore media keys |
| D19 | **Navigation: JS stack (`@react-navigation/stack`, `enableScreens(false)`) is the TV default**; A/B vs native-stack in Phase 0 | The New-Arch focus regression (§0) is tied to `react-native-screens` native screen detach |
| D20 | **App identity** (§11 q5): **dev under a *new* package id** (e.g. `com.blissful.tv.rn`) so the RN build runs **side-by-side** with the current Tauri APK throughout the migration; **at cutover, reclaim `com.blissful.tv` re-using the existing debug keystore** for an in-place upgrade (or ship fresh if keystore-matching proves fiddly) | Side-by-side testing + rollback during dev; in-place upgrade at release |
| D21 | **Real-Debrid auth via QR / device-code pairing** (§11 q6), not a paste field | A pasted API key on a 10-foot remote is hostile; matches Trakt's device-code flow |
| D22 | **No APK self-install** (§11 q4): updater stays **notify-only** (GitHub releases/latest + toast linking to the APK). Native changes = manual sideload. JS changes = EAS Update | User decision; avoids `REQUEST_INSTALL_PACKAGES` UX friction |
| D23 | **Default audio path = software decode (ffmpeg)**; passthrough attempted only with an init-failure guard (§0) | API-28 passthrough detection mis-reports on this SoC class |

---

## 3. The audio solution (G2 — "everything has audio")

**Root cause:** Media3/ExoPlayer has **no software fallback** for AC3/E-AC3/DTS/TrueHD — it relies on platform MediaCodec, which low-end 2019 MediaTek TVs don't expose for those codecs. **Fix: the Media3 ffmpeg *audio* decoder extension** (`FfmpegAudioRenderer`) — ffmpeg audio decoders compiled in; video stays on the hardware decoder.

### Step 0 (Phase-0, before anything): confirm the ABI
`adb shell getprop ro.product.cpu.abilist`. The MT5887 is a 64-bit A53, but **2018–2020 MediaTek TV userlands are frequently 32-bit (`armeabi-v7a`-only)**. If arm64 is absent, an arm64-only APK fails `INSTALL_FAILED_NO_MATCHING_ABIS` or installs without the ffmpeg `.so` (silent → no audio, G2 dead). **The ffmpeg/NDK ABI target is conditional on this result** (build `armeabi-v7a` if that's what the TV reports).

### Build path
1. **Spike**: `org.jellyfin.media3:media3-ffmpeg-decoder:1.9.0+1` + matching `androidx.media3:media3-exoplayer:1.9.0`. **GPLv3 — spike only.**
2. **Release (pulled forward to ≤ Phase 3 — it's the most fragile release-blocker)**: own **LGPL** audio-only ffmpeg:
   - `androidx/media` `release/6.0` ffmpeg; `ENABLED_DECODERS=(vorbis opus flac alac pcm_mulaw pcm_alaw mp3 aac ac3 eac3 dca mlp truehd)` (adds opus/vorbis Jellyfin omits)
   - NDK **26.1.10909125** pinned; no `--enable-gpl`/`--enable-nonfree` → LGPL
   - `abiFilters` = whatever Step 0 reported
3. **Wiring**: `DefaultRenderersFactory(ctx).setExtensionRendererMode(EXTENSION_RENDERER_MODE_ON).setEnableDecoderFallback(true)`. Default to **decode** (§0); only let passthrough win when an AVR is actually present and an AudioTrack init succeeds (init-failure listener → recreate in decode mode).
4. **Downmix**: `DefaultAudioSink` via `AudioCapabilities` (5.1/7.1 → stereo on TV speakers). On API 28 capabilities come from the HDMI-plug intent — treat as advisory; the init-failure guard is the real safety net.
5. **Tunneling A/B** (Phase 0): `DefaultTrackSelector` `setTunnelingEnabled(true)` is often the smooth-vs-stutter difference for 4K/HDR on this MediaTek class — measure both in the 4K stability gate.
6. **Expectations**: DTS:X/Atmos objects don't reconstruct in software (core/bed only; objects survive via AVR passthrough).

### Test matrix (exit criteria)
Each codec × {2.0, 5.1/7.1} × {TV speakers, AVR}: AAC, AC3, EAC3, DTS, DTS-HD MA, TrueHD, FLAC, Opus, Vorbis, PCM s16le/s24le. Confirm audio + correct downmix + passthrough-when-AVR + hardware video stays active. **Run this against the LGPL build, not just the spike AAR.**

---

## 4. Subtitles strategy

No production ExoPlayer path reaches libass-quality ASS (Stremio + Jellyfin both concluded this). Our architecture maps well anyway:
- **Addon subs** → our RN `<Text>` overlay (full styling parity). Reuse the pure parsers (`parseSrtOrVtt`, `findCueAt`, `shiftVtt`, `srtToVtt`, `subtitleLangLabel`, `LANGUAGE_ALIASES`, `scoreSubtitleTrack`). The **subtitle delay** knob drives the overlay's cue lookup — fully supported.
- **Embedded subs** → Media3 SubtitleView + `CaptionStyleCompat` (size/color apply to text subs). **No Media3 text-track delay API** → if the user adjusts latency on an embedded track, either route those cues through the same TS overlay or **document delay as overlay-subs-only in v1**. ASS styling degrades to plain text (v1 limitation). **PGS/bitmap subs** need explicit `onCues → SubtitleView` wiring since we're not using `PlayerView`.
- **Charset is net-new work**: the streaming-server's Latin-1/Win-1251→UTF-8 conversion is gone, and **no charset detection exists in the TS today** (BOM-strip ≠ charset detect). Add a detector (e.g. a small jschardet + iconv-lite/`TextDecoder`) before parsing.
- **OpenSubtitles hash sync** (`/opensubHash`) needs the streaming server → absent on TV (`fetchOpenSubHash` stubs to null); subs still load, less perfectly synced.
- **Skip-Intro coverage regresses** (honest note): ExoPlayer has no chapter API, so `chapterSkip ?? segmentSkip` collapses to **segments only** — AniSkip (anime) + TheIntroDB (partial). mpv chapters previously covered anime BD + Western TV; that coverage drops. Mitigation options: accept the reduced coverage, parse MKV chapters manually, or use the libmpv v2 engine. **v2 escape hatch**: a libmpv-android engine behind the same BlissPlayer JS interface buys full libass + chapters (carries the GPL-vs-LGPL call from `SPEC.md §9`).

---

## 5. Architecture

### 5.1 Repo layout
```
apps/
  blissful-shell/      Windows shell (untouched)
  blissful-mvs/        Web/desktop UI (untouched; later imports blissful-core)
  blissful-tv-shell/   Tauri TV app (frozen; retired when RN ships)
  blissful-tv-rn/      NEW — Expo + react-native-tvos (new package id during dev)
    android/           prebuild output: leanback manifest, tv_banner, NSC cleartext, signing
    src/{player,screens,components,focus,theme,nav}/
    native/            Kotlin BlissPlayerModule (Media3 + ffmpeg ext + probeUrl + MediaSession)
packages/
  blissful-core/       EXTRACTED shared pure-TS (§5.3), consumed by web AND RN
```
Metro: `watchFolders=[workspaceRoot]`, `resolver.nodeModulesPaths` for hoisted deps. **PR CI is a real workstream** (§9) — none exists today (only tag-triggered `release.yml`); add `tsc -b` + lint + `vitest` on both blissful-core consumers.

### 5.2 BlissPlayer native module
Thin Kotlin TurboModule + Fabric view over Media3 ExoPlayer that **re-emits the mpv-shaped vocabulary** the player logic consumes. Anchor the JS contract on **`desktop.ts`** (the stable facade), not the Kotlin `MpvBridge`.

| mpv prop/event (current) | ExoPlayer source — corrected |
|---|---|
| `time-pos`/`playback-time` (5 Hz) | `currentPosition` polled ~5 Hz (already 0-based; dual-clock collapses) |
| `duration` | `getDuration` / `onTimelineChanged` |
| `pause` | `onIsPlayingChanged` |
| **buffering veil** | **`STATE_BUFFERING && playWhenReady` ONLY.** ❌ NOT `onIsLoadingChanged` — it fires continuously during normal read-ahead and would flap the veil + freeze the subtitle clock all playback long |
| `EndFile 'eof' vs 'stop'` (binge gate) | `STATE_ENDED` = natural eof |
| `aid`/`sid`/track-list | `getCurrentTracks()` → same `MpvTrack{id,kind,title,lang,codec,selected}` shape |
| `video-params/gamma` (HDR) | `Format.colorInfo.colorTransfer` (ST2084=PQ/HLG) |
| `dwidth`≥3840 (4K) | `onVideoSizeChanged` |
| `chapter`/`getChapters()` | **No ExoPlayer chapter API** → drops; AniSkip+TheIntroDB segments become primary (coverage note §4) |
| `seek +exact` | `setSeekParameters(SeekParameters.EXACT)` — load-bearing |
| `seek relative` | `seekTo(currentPosition + delta)` — Media3 is absolute-only |
| `volume-max=200` | UI caps at 100 on TV (remote owns volume; slider already hidden) |

**Must-haves the bespoke surface needs that `PlayerView` gave for free:**
- **Wake lock**: `window.addFlags(FLAG_KEEP_SCREEN_ON)` on play, clear on pause/end (+ `ExoPlayer.setWakeMode(WAKE_MODE_NETWORK)`). A bare SurfaceView does NOT keep the screen on → the TV sleeps mid-movie, guaranteed.
- **MediaSession** (D18): hardware media keys + CEC + Assistant + now-playing card.
- **`probeUrl(url)`** (D10): standalone module method, 10 s timeout, `{finalUrl, contentLength, status}`, **unknown-length ⇒ 0 ⇒ fall through** (else live/unknown-length streams get DMCA-false-flagged); the resolved `finalUrl` MUST be what `load()` receives (MKV EOF-seek regresses otherwise).
- **`load(url, startMs)`** — start position baked into the load (= mpv `start=N`); resume threshold > 0.5 s.
- **Bounded `DefaultLoadControl`**: explicit small buffers (~30–50 MB / `minBufferMs`/`maxBufferMs` tuned for TV) — defaults auto-size to **hundreds of MB on 4K remuxes** and OOM the panel.
- **`SurfaceView`** (not TextureView) for the video — lower power, HDR-capable; TextureView only if transforms are needed.
- **24p**: ExoPlayer's auto frame-rate match is API 30+; on API 28 only `window` `preferredDisplayModeId` works and ExoPlayer never touches it → **Phase-3 task or declared out of scope** (24p judders on 60 Hz otherwise).
- **Audio focus**: request/abandon `AudioFocus` (off by default in a bare setup).
- `CaptionStyleCompat` styling; `AudioCapabilities` requery on HDMI plug; the OkHttp datasource (Happy-Eyeballs + pooling) means the `/stream` loopback relay **dies**.

Surface lifecycle: RN owns the view hierarchy → the entire `MpvSurface.kt` transparent-WebView compositing + FORTIFY teardown hardening **disappears**; still verify background→foreground resume on the real panel.

### 5.3 `packages/blissful-core` — extraction (reused by web + RN)
Reuse with **injected platform adapters** (storage, AppState, event emitter, **fetch-base/proxy resolver**):
- Protocol/data: `stremioAddon` (**inject the fetch-URL resolver** — `proxyUrl` on web, identity on RN; do NOT hard-strip it), `blissfulAuthApi`, `storageApi`, `friendsApi`, `stremioLinkApi`, `mediaTypes`, `homeRows`
- **Auth (corrected — the old story was stale)**: `BlissfulAuthProvider` is canonical (JWT in **`bliss:authToken`**, `/auth/me` validation on mount). The `AuthProvider` compat shim's multi-account API is dead — **DROP `savedAccounts`, `useUserSession`, `savedAccounts.ts`, and `stremioApi` auth/datastore** (superseded). RN consumes `blissfulAuthApi` directly. RD QR/device-code pairing (D21) is new auth UX.
- Playback: `progressStore`+`progress` (ms-vs-sec, 2%-sentinel, higher-percent-wins), `streamHistory` (**drop the HEVC purge** — native decoders play HEVC; keep the ephemeral-localhost purge), `nextToWatch`+test, `watchedBitfield`+test (`atob`→base64 lib; `DecompressionStream`→**`pako.inflate`**, zlib not raw), `streams.ts` ranking, `deepLinks` param contract, `androidPlayable`, `playerEnv`
- Skip: `aniskip`, `introdb`, `useSkipSegments`, the chapter regexes (kept verbatim though the chapter *source* drops — see §4 coverage note)
- Subtitles: parsers + tables + scoring; **+ a new charset detector** (§4)
- Trakt: `traktApi` (**inject the base** — `api.trakt.tv` direct on RN, proxy on web; don't hardcode "direct"), `useTraktScrobble`
- Social: `watchParty` protocol/helpers, `useWatchPartyMpv` (**all timing constants verbatim**), `usePresenceHeartbeat` (**complete the dormant `setCurrentActivity` wiring** so "watching X" works), `useSocial`, `relativeTime`, `activityLabel`, `UserSocket`/`ActiveParties` logic
- Misc: `colorUtils`, `tvPosterUrl` (apply to metahub **and** TMDB posters — TMDB currently bypasses downscaling; use w185/w342), `useImdbRating`/`tmdb` (sessionStorage→in-memory), `fetchOpenSubHash` (**stub to null on TV** — no 11470)

### 5.4 Navigation & back
- **`@react-navigation/stack` (JS stack) + `enableScreens(false)` as the TV default** (D19; §0 focus regression). A/B vs native-stack in Phase 0.
- Player param contract preserved as route params (`url,title(\n-joined),type,id,videoId,t,poster,background,metaTitle,logo,room,skip[]` + `autoplay`). The dead-stream **skip-list loop breaker** ports exactly.
- **Back ladder** via `BackHandler` (single delivery — the `consumeNativeBackOnce`/`__blissOnBack`/predictive-back dedup all die): close top overlay → navigate to tracked safe-back (never into /player) → at home return false (exit). Player registers its richer ladder while focused (settings→episodes→watch-party→control-row→top-row→leave).

### 5.5 Focus model (Norigin → native engine)
Delete `src/spatial/` wholesale (`focusRecovery`, windowing-for-geometry, pause/resume, `data-focused` CSS, Android `click()` synthesis, capture listeners, portal workarounds, the OK carry-over guard). Replacements: `Pressable` + `onFocus/onBlur`, `hasTVPreferredFocus` (one per screen), `TVFocusGuideView` (`destinations`/`trapFocus*`), `nextFocus*` refs for the UP→hero / cards→range-selector routing, `Pressable onLongPress`/`delayLongPress`, native `TextInput` (the IME-squish saga is gone). **Keep**: the coalesced D-pad seek (350 ms, one absolute seek), and a per-route save/restore-focus hook (the #852 regression — validate the JS-stack avoids it). Re-verify the OK carry-over doesn't reappear if any long-press is hand-rolled on raw `TVEventHandler`.

### 5.6 Theming, fonts, icons, toasts
- **Theme**: ThemeContext computing accent/surface + derived shades in JS (`colorUtils` math) — replaces the CSS-variable recoloring.
- **Fonts** (§11 q2): **Fraunces + IBM Plex Sans only**, bundled TTF/OTF via expo-font. **Drop VT323 + Mondwest** (pixel-label aesthetic not needed) — simplifies the bundle and the sidebar label styling.
- **Icons**: 24 custom SVGs + multi-icon files → `react-native-svg` (mechanical).
- **Toasts**: keep `notifyError/Info/Success/Warning` signatures; back with an RN toast stack (3 placements, dedup-by-key).
- **index.css (~3,854 lines)** re-authored as StyleSheet + Reanimated (glass, focus rings, overscan, hero treatments) — the single biggest hidden cost; it's "the design."
- Native splash (expo-splash-screen); theme hydrates from MMKV synchronously (no FOUC). ErrorBoundary fallback kept; the stale-chunk `reload()` dies.
- Dead deps (do NOT budget): `three`, `@ffmpeg/ffmpeg`, `@stremio/stremio-video`, `eventemitter3`. Dropped: `hls.js`, `react-color` (TV preset swatches), `framer-motion` (→ Reanimated/moti), HeroUI, Norigin, react-router, vite-plugin-pwa.

### 5.7 Storage migration (MMKV) — corrected key list
**MMKV keys**: `theme, uiStyle, bliss:authToken (JWT — NOT stremioAuthKey), blissful.playerSettings, blissfulProgressV1, blissfulLibraryV1, bliss:lastStream:*, blissful.subtitleLang, blissfulTorrentioUrls, bliss:trakt, bliss:watchParty:guestId/guestName`. **Dropped dead keys**: `stremioAuthKey, stremioUser, stremioSavedAccounts` (multi-account gone).

**sessionStorage — enumerate ALL consumers (RN/Hermes has none); disposition each:**
| Consumer | Disposition |
|---|---|
| watch-party passwords (`bliss:watchParty:passwords`) | **in-memory module** — session-scoping is a *security property* (§6 #30: never persist to disk) |
| `bliss:nextEpisode:*` (DetailPage→PlayerPage handoff) | in-memory module singleton |
| `bliss:safe-back` (useTvBack, DetailPage, PlayerPage) | navigation-state derived / in-memory |
| `bliss:imdb-rating:*`, `bliss:tmdb-id:*` caches | in-memory Map |
| `bliss:activeParties` mirror | in-memory (session persistence low-value on TV) |

### 5.8 Updates (G4)
- **JS/UI**: EAS Update, `runtimeVersion` policy `nativeVersion`. **Add a staging channel + a documented rollback procedure.** Because TVs sit in standby for weeks, **call `Updates.fetchUpdateAsync()` on `AppState` → active** (don't rely on "next launch").
- **Native** (player module, ffmpeg AAR): new APK, **notify-only** updater (D22; §11 q4) — GitHub releases/latest + toast linking to the APK; keep the `update-available` event contract.

### 5.9 Networking (what replaces proxy.rs)
| route | RN fate |
|---|---|
| `/addon-proxy` | **inject resolver** — direct on RN, proxy on web (reconcile the catalog-direct vs rest-proxied asymmetry deliberately) |
| `/storage/*` incl. **`/storage/stremio/*`** | direct backend. **Keep Stremio account-linking** (`stremioLinkApi`, `SettingsStremioPanel`, `syncStremioItem` cross-device freshness §6 #15) — it rides `/storage/stremio`, NOT the FB-login `/stremio/*`. WS direct (verify backend Origin allow-list accepts RN's `Origin: null`) |
| `/resolve-url` | native `probeUrl()` (D10) |
| `/stream` relay | **delete** (OkHttp has Happy-Eyeballs + pooling) |
| `/img`,`/imdb-rating`,`/tmdb-find`,`/tmdb-season-info` | direct backend |
| `/stremio/*` **FB login only** | **drop** (popup impossible on TV) — do NOT conflate with Stremio linking above |
| `/trakt` (never existed) | inject base → `api.trakt.tv` |

**Cleartext (Phase-0 gate):** deleting the loopback proxy moves addon/stream/poster fetches to external hosts; **Android 9 NSC blocks cleartext `http://` to external hosts by default** (`normalizeAddonBaseUrl` can create http addon URLs; `androidPlayable` permits http streams; non-metahub posters pass through unchanged). Ship `network_security_config` **`base-config cleartextTrafficPermitted=true`** (addon/CDN hosts can't be enumerated; the desktop already serves http addon content — a consistent, accepted tradeoff). §8's "the mixed-content problem class deletes" was wrong — browser mixed-content vanishes, but the NSC cleartext policy is *reintroduced*.

---

## 6. Hard-won behaviors registry (MUST survive)
*(unchanged from v1 — the 33 items below each encode a shipped bugfix; one clarification added)*

**Playback & streams** — 1) three-layer dead-stream defense (probe <20 MB, post-load duration <300 s, growing `skip[]`); fire-once; in-player auto-fallback stays disabled. 2) final redirected CDN URL not the 302. 3) buffering veil gates (idle-echo can't dismiss; advance-past-start fallback dismiss). 4) resume baked into load. 5) exact-frame seek. 6) `'eof'` vs `'stop'` binge gate. 7) bounded buffers (mpv 225 MB default OOMs). 8) coalesced D-pad seek (350 ms, one absolute). 9) Up-Next time-trigger + `ended` fallback + cancel/fired latches + unaired gate. 10) progress cadence (1 s Trakt / 4.5 s save / explicit flush). 11) Skip-Intro: chapters-win-over-segments (**now moot on RN — `chapterSkip` is structurally null, so segments-only; this is a real coverage regression, §4**), non-sticky, OK-fires-skip-when-armed, regexes verbatim. 12) addon-sub-active ⇒ native sub hidden; per-file reset; cue clock freezes on pause **and** buffering; `sorted[1] ?? sorted[0]`.

**Library & progress** — 13) ms (cloud) vs sec (local); `'anime'→'series'`; series cloud offset only when `video_id` matches. 14) 2%-not-0 sentinel; ≥90% watched; higher-percent-wins. 15) TV reads/writes the Blissful backend library (soft-toggle `removed`); detail-open `syncStremioItem`. 16) `nextToWatch` gated on `watchedReady`. 17) bitfield decode never throws. 18) `rewindLibraryItem` re-read assertion + `_mtime` bump.

**Detail/episodes** — 19) TV `videoId` only focuses (never auto-opens popup). 20) episode-range pagination (>50; land on next-to-watch range; `userMoved` gating). 21) dedupe by id. 22) popup closes only on nav-bail. 23) no double resume prompt on TV. 24) anime absolute-numbering TMDB correction. 25) EpisodeThumb skeleton-until-still. 26) RD-only + unreleased guards; boolean-return contract.

**Shell/social** — 27) safe-back (no history-walk into /player); back-at-home exits; one overlay per Back. 28) hero rotation disabled on real TV; 200 ms focus-fetch debounce. 29) library focus tracks item by id. 30) watch-party: all sync constants verbatim; seeks broadcast explicitly; stream URLs never shared; **passwords never persisted (session-scoped security property)**; 4-condition connect gate; room-code helpers; `messageKey=userId-at`. 31) friends: optimistic cancel + 404-swallow; online-first; presence sorted-join key; newest-wins. 32) storage 401 short-circuit per key; WS always direct. 33) toast fire-and-forget never blocks UX.

---

## 7. Feature parity matrix
*(legend: ✅ reuse · 🔧 adapt · 🎨 rewrite-ui · 🔁 replace-native · ❌ drop)*

| Area | Highlights |
|---|---|
| **lib/ data** | ✅ bulk (§5.3) · 🔧 injected bases (proxy/storage/Trakt), bitfield primitives, charset (new) · 🔁 platform.ts (always-TV constants), desktop→BlissPlayer, useTvBack→BackHandler · ❌ stremioFacebook, **stremioApi auth/datastore + savedAccounts (dead)**, playerPageLoader, profileAvatars hash-rescue |
| **Player** | 🔁 engine (→BlissPlayer w/ MediaSession, wake lock, exact seek, probeUrl, tunneling) · ✅ skip segments, scrobble, progress, next-episode, dead-stream, stream-URL logic, sub parsers/pickers, track-shape · 🎨 all controls/overlays · ❌ SimplePlayer + hls.js + transcode tree + external-player handoff + volume slider/fullscreen chrome |
| **Pages** | 🎨 Home (classic only), Detail (TvDetailLayout + ranges + TvStreamsPopup + TvSimilarRow), Discover, Search (✅ orchestration), Library, Settings (preset swatches; **RD QR pairing**, Stremio-link panel kept), Profile, Invite, Addons · ❌ AccountsPage (inert), MobileHero/iOS, Modern + Netflix |
| **Shell** | 🎨 TV nav rail/top bar, all modals (Login native TextInput, avatar 2D grid, WhoWatching, HomeSettings, ResumeOrStartOver, StreamUnavailable, AddAddon), CW pending-veil state machine, PartyInviteListener · 🔧 providers (order preserved; UIProvider→classic/dark) |
| **Spatial** | 🔁/❌ §5.5 — layer deletes, semantics survive natively |
| **Native shell** | ❌ proxy.rs, MpvSurface, viewport hack, IME stripper, gen/ scaffold · 🔁 bridge→BlissPlayer, BACK→BackHandler · 🔧 updater (notify-only + EAS), TV manifest bits (leanback, banner, landscape, **NSC cleartext**) |
| **Social (watch party IN v1 — §11 q1)** | ✅ protocol/REST/UserSocket/ActiveParties · 🔧 useWatchPartyMpv (bind to BlissPlayer), presence (complete activity wiring) · 🎨 TvFriendsRail, party drawer/button/prompts/toasts, profile · ❌ useWatchParty (`<video>` variant; keep type exports), DMs UI, FriendsAccordion (desktop) |
| **Cross-cutting** | 🎨 theming/fonts(Fraunces+Plex)/icons/toasts/skeletons/Rating/MediaCard+Menu/MediaRail · 🔧 deep links (`Linking`) · 🔁 **crash reporting (Sentry, new)** · ❌ PWA/SW, ErrorBoundary reload, pixel fonts |

---

## 8. What gets simpler
Whole **proxy** layer deleted (but the *web build still needs it* → injected adapter, §5.9). Whole **Norigin** layer deleted. Whole **WebView problem class** deleted (transparent compositing + FORTIFY SIGSEGV, IME squish, BACK swallowing + predictive-back dedup, viewport scaling, YouTube uncomposited fullscreen, synthesized-click quirks). Buffering/HLS/transcode tree collapses; dual subtitle clock collapses; OTA becomes legitimate. *(Corrected: cleartext is NOT simplified — §5.9.)*

---

## 9. Phases & milestones

### Phase 0 — Hardware spike (~1–1.5 weeks) · **go/no-go gate**
**Gate checks (new + expanded):**
- `getprop ro.product.cpu.abilist` → set the ffmpeg/NDK ABI (32-bit risk).
- NSC `cleartextTrafficPermitted=true` → confirm http addon + poster loads.
- App boots on **API 28** (verified viable — confirm in practice).
- **JS-stack vs native-stack focus A/B** + a per-route save/restore-focus prototype (#852).
- **FlashList vs FlatList focus check** on a fast-scrolled rail.
- BlissPlayer v0 (Media3 + **Jellyfin spike AAR**): one RD 4K HEVC + DTS stream; hw video + sw audio + bounded buffers + **wake lock** + **tunneling A/B**; a DTS-HD + TrueHD sample.
- One **EAS Update** cycle + a **rollback** lands on the TV.
- App-id + keystore decided (D20) so EAS/keystore is set up.
**Exit:** smooth rails · DTS/TrueHD audible · 4K stable >30 min · OTA+rollback land · focus restoration workable · cleartext loads · ABI confirmed.

### Phase 1 — Foundations (~1.5 weeks)
Monorepo/Metro + `blissful-core` extraction (web app consumes it; **stand up PR CI** proving both consumers `tsc -b`+`vitest` green) · MMKV adapters + sessionStorage dispositions · theme/fonts/icons/toasts · **Sentry** wired (JS + native) · JS-stack navigation + back ladder + safe-back · **JWT auth** (login, `/auth/me`, RD QR pairing) · providers · storage sync.

### Phase 2 — Browse surfaces (~2 weeks)
Home (no-rotate hero, CW rail + resume modal + pending veil, rows, customize-home) · Detail (TvDetailLayout, episodes + ranges, stream popup + ranking + filters, autoplay/skip loop, RD/unreleased guards, **trailer in-app modal**) · Discover · Search · Library · Addons · Settings (incl. Stremio-link panel).

### Phase 3 — Player (~2.5–3 weeks, the core) — **+ ship the LGPL ffmpeg build here**
Full BlissPlayer vocabulary + probeUrl + exact seek + tracks + CaptionStyle + MediaSession + wake lock + 24p task · player D-pad mode machine, buffering state machine (`STATE_BUFFERING && playWhenReady`), coalesced seek, OK-skip · subtitles (embedded + overlay + styling + delay + charset + auto-pick) · skip segments · Up-Next/binge · progress/Trakt · dead-stream chain · HDR/4K badges · pause overlay · episodes drawer · **swap the spike GPL AAR for the LGPL build + rerun the codec matrix.**

### Phase 4 — Social & polish (~2 weeks)
Friends rail + actions + nickname · presence (complete activity) · **watch party (v1)**: sync on BlissPlayer, drawer, prompts, invite banners, invite deep link · profile · avatar editor · updater (EAS + notify-only) · WS Origin verification.

### Phase 5 — Hardening & release (~1.5 weeks)
Perf/memory soak (2,000-item library fast-scroll; 4 hr playback; `onTrimMemory` strategy) · VLC fallback decision · 24p/tunneling final tuning · release signing + `Blissful-TV-RN.apk` + cutover app-id decision · retire `blissful-tv-shell` · docs.

**Total ~9–12 weeks** (solo + agents), Phases 2–4 partially parallel.

---

## 10. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| 32-bit-only ABI on the panel | High | `getprop` Phase-0 #1; conditional ffmpeg/NDK target |
| Cleartext http blocked on Android 9 | High | NSC `cleartextTrafficPermitted=true` (Phase-0 gate) |
| RN-TV focus regression on New Arch (#852) | High | JS stack + per-route save/restore hook; Phase-0 A/B |
| FlashList TV focus loss (#895) | Medium-high | FlatList default; FlashList only where profiled (Phase-0 check) |
| OTA bricks UI with no signal | High | Sentry day-one (D17); EAS staging channel + rollback |
| API-28 passthrough mis-report | Medium | Decode-by-default; AudioTrack init-failure → recreate |
| Embedded ASS styling vs mpv | Medium-high (anime) | Addon subs full styling; libmpv v2 escape hatch |
| Skip-Intro coverage regression (no chapters) | Medium | Segments-only accepted, or MKV chapter parse / libmpv v2 |
| 1.5–2 GB RAM ceiling | Medium | FlatList + expo-image discipline; bounded buffers; Phase-5 soak |
| ffmpeg/NDK build fragility | Medium | Pin ffmpeg 6.0 + NDK r26b; **LGPL build proven by Phase 3, not 5** |
| GPL contamination (spike AAR) | High if shipped | Spike-only; LGPL own-build is the release gate |
| 24p judder on API 28 | Low-medium | Phase-3 `preferredDisplayModeId`, or out of scope |
| minSdk floor | **Resolved** | Verified API 24 (§0) — runs on API 28 |
| Two UIs to maintain | Structural | blissful-core extraction; accepted cost of native TV |

---

## 11. Decisions (answered)

1. **Watch party in v1 — YES.** Kept in scope (Phase 4); `useWatchPartyMpv` bound to BlissPlayer with all sync constants verbatim.
2. **Pixel fonts (VT323/Mondwest) — NOT needed.** Drop them; ship Fraunces + IBM Plex Sans only (D13). Simplifies the bundle + sidebar labels.
3. **Trailer — leave as is.** In-app trailer modal via `react-native-youtube-iframe` with a focusable Close (D16); no leave-app intent.
4. **APK self-update — no.** Notify-only updater; JS via EAS Update (D22).
5. **App identity — my call:** dev under a **new package id** (side-by-side with the Tauri APK for testing/rollback); **at cutover reclaim `com.blissful.tv` re-using the existing debug keystore** for an in-place upgrade, falling back to a fresh install if keystore-matching is fiddly (D20). Decided at Phase 1 (it gates EAS/keystore), not Phase 5.
6. **Real-Debrid — QR / device-code pairing** (D21), matching Trakt's device-code flow. No paste field on a 10-foot remote.

---

## 12. Dev workflow (post-Phase-0)
`adb connect <tv-ip>` → `npx expo run:android` (dev client) → Metro + Fast Refresh over Wi-Fi. Debug with React Native DevTools (`j` in Metro; Flipper retired). Profile on the **real Android-9 panel**, not the emulator. Production: EAS Build (`tv` profile) → APK sideload; JS via `eas update` (staged → promote).

---

*Verification + research sources recorded in the workflow + fact-check outputs (Expo SDK 56 docs, react-native-tvos repo/issues #815/#670/#852, react-native-screens #1706, androidx/media decoder_ffmpeg + AudioCapabilities, Android audio-capabilities guide, ExoPlayer #7669 / androidx/media #396, Jellyfin androidx-media, FlashList #895, MMKV, RN networking docs).*
