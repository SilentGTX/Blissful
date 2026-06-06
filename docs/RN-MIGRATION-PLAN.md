# Blissful TV → React Native Migration Plan

**Branch:** `react-native-blissful` · **Status:** PLAN ONLY — no implementation yet
**Target device:** Philips 65PUS7354/12 (2019, Android TV 9, MediaTek arm64, Mali-G31, ~1.5–2 GB RAM) and similar low-end panels
**Produced from:** an 11-agent codebase inventory (every subsystem of `apps/blissful-mvs` + `apps/blissful-tv-shell`), 3 web-research passes (audio codecs, RN TV stack, platform questions), and a completeness critic sweep. ~1.7M tokens of analysis distilled here.

---

## 1. Goals & success criteria

| # | Goal | Measured by |
|---|------|-------------|
| G1 | **Stremio-smooth UI** on the 65PUS7354 | Home/Detail D-pad navigation with no perceptible jank; cold start ≤ Stremio's |
| G2 | **Every torrent plays with audio** (AAC, AC3, E-AC3, DTS, DTS-HD MA, TrueHD/MLP, FLAC, Opus, Vorbis, PCM) | Codec test matrix passes on the real panel, 2.0 and 5.1/7.1, with and without an AVR |
| G3 | **4K HEVC RD streams play without crashing** | Hardware decode engaged; bounded buffers; no OOM during 4K playback |
| G4 | **Production OTA updates** — UI changes ship without APK pushes | One EAS Update cycle proven end-to-end on the TV |
| G5 | **Feature parity** with the current Tauri TV app | The parity matrix in §7 fully dispositioned |
| G6 | Desktop/web app **untouched** | `apps/blissful-mvs` + `apps/blissful-shell` keep building byte-identical |

Non-goals for v1: torrent engine on-device (stays RD-only), DMs UI, Facebook login, netflix/modern UI styles, iOS/tvOS.

---

## 2. Decision record (locked unless new evidence)

| # | Decision | Why |
|---|----------|-----|
| D1 | **Expo SDK 56 + react-native-tvos@0.85-stable**, New Architecture (mandatory at RN 0.82+), Hermes v1, `@react-native-tvos/config-tv` prebuild | Only officially supported, current RN-TV path; tvos fork tracks core 1:1; Amazon-backed |
| D2 | **EAS Build + EAS Update** for OTA JS updates | "All operations supported on Android TV" per Expo docs. CodePush is dead (App Center retired 2025-03-31; silently broken under Bridgeless). This delivers G4 |
| D3 | **Bespoke thin native Kotlin Media3/ExoPlayer module** ("BlissPlayer") — NOT react-native-video | RN-video hardcodes `EXTENSION_RENDERER_MODE_OFF` (v6) / bare factory (v7) and its plugin API has **no RenderersFactory hook** — the ffmpeg audio extension cannot be enabled without a fork. A small owned module beats carrying a fork, and we need custom surface anyway (mpv-shaped events, exact seek, probeUrl) |
| D4 | **Media3 ffmpeg *audio* decoder extension** for the audio problem | See §3. Spike with Jellyfin's prebuilt AAR; ship our own LGPL build |
| D5 | **Video stays on MediaCodec hardware decode** | The SoC hardware-decodes 4K HEVC fine; never enable a software video path |
| D6 | **Monorepo**: new `apps/blissful-tv-rn` + extract `packages/blissful-core` (shared pure-TS) | The whole point of RN-over-Kotlin is reusing the TS data layer; a separate repo reintroduces OpenCode-style copy-drift |
| D7 | **react-native-mmkv** replaces localStorage (synchronous), AsyncStorage only for one-time migration reads | `progressStore`/`playerSettings`/`streamHistory` rely on *synchronous* reads; MMKV preserves semantics; high-frequency progress writes must not hit the bridge |
| D8 | **No proxy. Direct fetch everywhere.** The entire `proxy.rs` + `proxyBase.ts` layer is deleted, not ported | RN has no CORS ("no concept of CORS in native apps" — RN docs). The proxy existed solely to dodge browser CORS under the Tauri origin |
| D9 | **Backend helper endpoints stay** (`/img`, `/imdb-rating`, `/tmdb-find`, `/tmdb-season-info` at `https://blissful.budinoff.com`) — called directly | They carry server-side caching + API keys, not CORS-dodging |
| D10 | **URL probe lives in the native module** (`probeUrl(url) → {finalUrl, contentLength, status}` via OkHttp) | RN JS `fetch` HEAD is **broken on Android** (OkHttp throws on HEAD + Content-Length — facebook/react-native #30055) and `response.url` after redirect is unreliable. JS fallback: GET with `Range: bytes=0-0`, parse `Content-Range` |
| D11 | **Subtitles v1**: embedded via Media3 SubtitleView (degraded ASS), addon subs via our own RN `<Text>` overlay reusing the existing parsers. **libmpv engine is the v2 escape hatch** for full ASS | See §4 |
| D12 | **Only the classic-TV UI mode ships.** `netflix` + `modern` home modes are dropped (desktop-only; UIProvider already forces classic on TV) | Cuts the home-UI port by ~3x |
| D13 | Styling: **plain StyleSheet** + a JS ThemeContext (accent/surface recoloring). NativeWindTV optional later, not v1 | Lowest risk on TV; the CSS-variable theming must become JS state anyway |
| D14 | Lists: **FlashList** everywhere; images: **expo-image** with `recyclingKey` + `allowDownscaling` + sized sources | Low-RAM discipline; expo-image OOMs without it (expo #26781) |
| D15 | **libVLC fallback (razorRun/react-native-vlc-media-player) is Phase-5 optional, off by default** | ffmpeg-audio + hw video covers ~99% of torrent content; VLC is heavy on 1.5 GB RAM |
| D16 | Trailers: **YouTube app intent** (`vnd.youtube:VIDEO_ID`) primary; embedded iframe only if staying in-app matters | WebView iframes aren't D-pad focusable through RN's focus engine |

---

## 3. The audio solution (G2 — "everything has audio")

**Root cause:** Media3/ExoPlayer has **no software fallback** for AC3/E-AC3/DTS/TrueHD — it relies strictly on platform MediaCodec, which low-end 2019 MediaTek TVs don't expose for those codecs. That's why ExoPlayer apps go silent on torrent remuxes. Stremio works around it with a VLC second engine + server transcode; we solve it *inside one engine*.

**Fix: the official Media3 ffmpeg *audio* decoder extension** (`decoder_ffmpeg`, `FfmpegAudioRenderer`) — ffmpeg's audio decoders compiled into the player. Audio software decode costs a few % of one arm64 core; video stays on the hardware decoder.

### Build path
1. **Spike**: `org.jellyfin.media3:media3-ffmpeg-decoder:1.9.0+1` (Maven Central prebuilt) + matching `androidx.media3:media3-exoplayer:1.9.0`. Ships `flac alac pcm_mulaw pcm_alaw mp3 aac ac3 eac3 dca(DTS/DTS-HD core) mlp truehd`. **GPLv3 — spike only, never release.**
2. **Release**: build our own **LGPL** audio-only ffmpeg (same posture as desktop's libmpv-lgpl):
   - `androidx/media` → `libraries/decoder_ffmpeg/src/main/jni` → clone ffmpeg `release/6.0`
   - `ENABLED_DECODERS=(vorbis opus flac alac pcm_mulaw pcm_alaw mp3 aac ac3 eac3 dca mlp truehd)` ← adds the opus/vorbis the Jellyfin build omits
   - NDK **26.1.10909125** (r26b) pinned — the known-good combo; drift breaks builds
   - No `--enable-gpl` / `--enable-nonfree` → stays LGPL
   - `abiFilters 'arm64-v8a'` only (the Philips is arm64; halves the binary)
3. **Wiring** (in BlissPlayer):
   ```kotlin
   val renderersFactory = DefaultRenderersFactory(context)
     .setExtensionRendererMode(EXTENSION_RENDERER_MODE_ON)  // passthrough/platform first, ffmpeg fallback
     .setEnableDecoderFallback(true)
   ```
   - `EXTENSION_RENDERER_MODE_ON` default → an attached AVR still gets AC3/DTS **passthrough** (bitstream); ffmpeg only decodes what the device can't.
   - Switch to `PREFER` only when `AudioCapabilities` reports no passthrough and platform decode is absent.
4. **Downmix**: handled by Media3 `DefaultAudioSink` via `AudioCapabilities` (5.1/7.1 → stereo on TV speakers automatically). Re-query on `AudioDeviceCallback` / HDMI plug events so attaching an AVR upgrades to passthrough live.
5. **Expectations**: DTS:X / Atmos *objects* don't reconstruct in software — you get the lossless core/bed (fine on TV speakers; objects survive only via AVR passthrough).

### Test matrix (exit criteria for the audio work)
One sample per codec × {2.0, 5.1/7.1} × {TV speakers, AVR attached}: AAC, AC3, EAC3, DTS, DTS-HD MA, TrueHD, FLAC, Opus, Vorbis, PCM s16le/s24le. Confirm: audio plays, downmix correct, passthrough engages with AVR, video stays hardware-decoded.

---

## 4. Subtitles strategy (the one honest trade-off)

Research verdict: **there is no production-grade ExoPlayer path to libass-quality ASS.** SubtitleView renders SRT/VTT well and *basic* SSA (bold/italic/color/size), but strips ASS fonts/positioning/karaoke/animations (Stremio and Jellyfin both hit this wall; Jellyfin's answer was a libmpv-based Player).

Our current architecture actually maps well:
- **Addon-fetched subs** (OpenSubtitles etc.) are *already* custom-rendered as an HTML overlay (never fed to mpv). Port: the pure parsers (`parseSrtOrVtt`, `findCueAt`, `shiftVtt`, `srtToVtt`, `subtitleLangLabel`, `LANGUAGE_ALIASES`, `scoreSubtitleTrack` — all reusable verbatim) drive an absolutely-positioned RN `<Text>` overlay with user styling (size/colors/outline/position/delay). **Full styling parity for addon subs.**
- **Embedded subs** (in-container SRT/PGS/ASS) go to Media3 SubtitleView + `CaptionStyleCompat` (user size/color applies to text subs). **ASS styling degrades to plain text — documented v1 limitation.**
- **Encoding**: the streaming-server's Latin-1/Win-1251→UTF-8 normalization is gone (no 11470 on TV) — do charset detection/transcode in TS before parsing (the parser already strips BOM/normalizes CRLF).
- **OpenSubtitles hash sync** (`/opensubHash`) requires the streaming server → degrades gracefully on TV (subs still load, less perfectly synced). Same as today's Android build.
- **v2 escape hatch**: a libmpv-android engine behind the same BlissPlayer JS interface for full libass (the Findroid/Jellyfin route). Carries the GPL-vs-LGPL licensing decision already flagged in `SPEC.md §9`. Only if degraded embedded-ASS proves unacceptable in practice.

---

## 5. Architecture

### 5.1 Repo layout
```
apps/
  blissful-shell/      Windows shell (untouched)
  blissful-mvs/        React web/desktop UI (untouched; later imports blissful-core)
  blissful-tv-shell/   Tauri TV app (frozen; retired when RN ships)
  blissful-tv-rn/      NEW — Expo + react-native-tvos app
    android/           (prebuild output; leanback manifest, tv_banner, signing)
    src/
      player/          BlissPlayer JS surface + screen + controls
      screens/         Home, Detail, Discover, Search, Library, Settings, Profile, Invite, Login
      components/      MediaCard, rails, modals, toasts, skeletons...
      focus/           focus helpers (TVFocusGuideView wrappers, back-ladder)
      theme/           ThemeContext (accent/surface), tokens, fonts
    native/            Kotlin: BlissPlayerModule (Media3 + ffmpeg ext + probeUrl)
packages/
  blissful-core/       EXTRACTED shared pure-TS (see §5.3)
```
Metro: `watchFolders=[workspaceRoot]`, `resolver.nodeModulesPaths` for hoisted deps. npm workspaces.

### 5.2 The BlissPlayer native module (the load-bearing piece)
A thin Kotlin TurboModule + Fabric view wrapping Media3 ExoPlayer that **re-emits the mpv-shaped vocabulary** the player logic already consumes (lowest-churn port — the current Kotlin `MpvBridge` defines the contract):

| mpv prop/event (current) | ExoPlayer source |
|---|---|
| `time-pos` / `playback-time` (5 Hz throttled) | `currentPosition` polled ~5 Hz (already 0-based — the dual-clock split collapses) |
| `duration` | `onTimelineChanged`/`getDuration` |
| `pause` | `onIsPlayingChanged` |
| `paused-for-cache`, `seeking` (the two buffering signals) | `onPlaybackStateChanged(STATE_BUFFERING)` + `onIsLoadingChanged` + seek processing |
| `EndFile reason: 'eof' vs 'stop'` (**binge gate**) | `STATE_ENDED` = natural eof (cleaner than mpv's inferred flag) |
| `aid`/`sid`/track-list | `getCurrentTracks()` → same `MpvTrack{id,kind,title,lang,codec,selected}` shape |
| `video-params/gamma` (HDR badge) | `Format.colorInfo.colorTransfer` (ST2084=PQ / HLG) |
| `dwidth`≥3840 (4K badge) | `onVideoSizeChanged` |
| `chapter` / `getChapters()` | **No ExoPlayer chapter API** → chapter skip source drops; AniSkip+TheIntroDB segments (already built, pure TS) become the primary skip source |
| `seek +exact` | `setSeekParameters(SeekParameters.EXACT)` — **load-bearing** for Skip-Intro + watch-party drift |
| `volume-max=200` soft-amp | ExoPlayer volume is 0..1 — either cap UI at 100 on TV (remote owns volume anyway; slider already hidden on TV) or a gain AudioProcessor later |
| demuxer cache 50 MiB fwd/16 MiB back | `DefaultLoadControl` bounded similarly — **mandatory** on 1.5 GB RAM |
| `stream-lavf-o reconnect` | OkHttpDataSource (Happy-Eyeballs + pooled keep-alive built in → the `/stream` loopback relay dies) |

Plus: `probeUrl(url)` (OkHttp HEAD→final URL + Content-Length, tolerant of HEAD-rejecting CDNs — replaces `/resolve-url`), `play/pause/seekTo/load(url, startMs)` (start position baked into load = mpv `start=N`), audio/text track selection, `CaptionStyleCompat` styling, `AudioCapabilities` requery.

Surface lifecycle: RN owns the view hierarchy — the entire `MpvSurface.kt` transparent-WebView compositing + FORTIFY teardown hardening **disappears**; still verify background→foreground resume on the real panel.

### 5.3 `packages/blissful-core` — what gets extracted (reused by web AND RN)
From the inventory, **reuse verbatim or with thin shims** (platform adapters injected: storage, AppState, event emitter):
- Protocol/data: `stremioAddon` (proxy-wrapping removed → direct), `stremioApi`, `blissfulAuthApi`, `storageApi`, `friendsApi`, `stremioLinkApi`, `mediaTypes`, `homeRows`
- Playback logic: `progressStore`+`progress` (ms-vs-sec conventions, 2%-sentinel, higher-percent-wins), `streamHistory` (**drop the HEVC purge** — native decoders play HEVC; keep the ephemeral-localhost purge), `nextToWatch`+test, `watchedBitfield`+test (swap `atob`→base64 lib, `DecompressionStream`→`pako.inflate`), `streams.ts` ranking (RD-first, seeders/(sizeGB+1)), `deepLinks` param contract, `androidPlayable`, `playerEnv`
- Skip: `aniskip`, `introdb`, `useSkipSegments`, the `INTRO_RE/RECAP_RE/OUTRO_RE` chapter regexes (preserved verbatim even though the chapter *source* drops)
- Subtitles: all parsers + language tables + scoring (§4)
- Trakt: `traktApi` (point at `https://api.trakt.tv` directly — fixes the live `/trakt` proxy gap), `useTraktScrobble` (inert-until-configured, throttle/dedup preserved)
- Social: `watchParty` protocol/types/helpers, `useWatchPartyMpv` (the player coupling — **all timing constants verbatim**: 0.35s drift, 2 Hz tick, 600ms echo-suppress, 1.5s stale-tick, 3s host settle, 2s guest settle), `usePresenceHeartbeat` (visibilitychange→AppState; **complete the dormant `setCurrentActivity` wiring** so "watching X" presence actually works), `useSocial`, `relativeTime`, `activityLabel`
- Misc: `colorUtils`, `tvPosterUrl` (poster downscaling — even more valuable on RN), `imageProxy` (absolute backend URL), `useImdbRating`/`tmdb` (sessionStorage→in-memory), `profileAvatars` classification (Vite-hash rescue dropped; `require()` assets)

### 5.4 Navigation & back
- `@react-navigation/native-stack`. Route map: Home / Discover / Search / Library / Settings / Addons / Profile/:userId / Invite/:code / Detail(type,id,videoId?) / Player(params).
- **Player param contract preserved as route params**: `url,title(\n-joined),type,id,videoId,t,poster,background,metaTitle,logo,room,skip[]` + `autoplay` on Detail. The dead-stream skip-list loop breaker (`autoplay=1` + accumulated `skip[]` + replace-navigation + one-shot guard) ports as param semantics — **hard-won, preserve exactly**.
- **Back ladder** via `BackHandler` (single delivery — `consumeNativeBackOnce`, `window.__blissOnBack`, predictive-back dedup all die): close top overlay → navigate to tracked safe-back (never `goBack()` into /player) → at home return false (app exits). Player screen registers its richer ladder while focused: settings → episodes → watch-party → control-row → top-row → leave.
- The OK **carry-over guard** (keydown/keyup split across navigation) is a Norigin artifact — native `Pressable` press gestures don't split across views. Drop it, but **re-verify**; if any raw `TVEventHandler` long-press is hand-rolled, reintroduce a time+target guard.

### 5.5 Focus model (Norigin layer → native engine)
The entire `src/spatial/` layer is **deleted**: `focusRecovery` watchdog (native focus can't silently die), windowing-for-Norigin-geometry (FlashList does it), pause/resume, `data-focused` CSS, Android `click()` synthesis, capture-phase document listeners, portal workarounds.

Replacements:
| Current | RN-tvos |
|---|---|
| `useTvFocusable` | `Pressable` + `onFocus/onBlur` + focus-ring styles from state |
| `autoFocusTv` (one per screen) | `hasTVPreferredFocus` (still exactly one per screen) |
| `focusKeyTv` + `setFocus` routing (UP→hero, cards→range-selector) | `TVFocusGuideView destinations` / `nextFocusUp` refs |
| `useTvOverlay` modal traps | `Modal` + `TVFocusGuideView trapFocus*` |
| `TvSelect` overlay picker | Modal + focus-trapped Pressable list (preserve: current value pre-focused, wraparound, Back closes) |
| `TvTextInput` IME dance | `TextInput` (native IME, `onSubmitEditing`) — the keyboard-squish saga is gone |
| Long-press (hold-OK menu / library remove) | `Pressable onLongPress` + `delayLongPress` |
| coalesced D-pad seek (350ms, one absolute seek) | **keep the pattern** — still the right 10-foot feel and avoids seek thrash |

**Known RN-TV focus bugs to engineer around** (the #1 risk): TVFocusGuideView autoFocus restoration on New Arch (tvos #815), focus loss across screen transitions (react-native-screens #1706), `hasTVPreferredFocus` vs native-stack (#670). Mitigation: a per-route save/restore-focus hook from day one, validated in the Phase-0 spike on real hardware.

### 5.6 Theming, fonts, icons, toasts (the critic's catches)
- **Theme**: `playerSettings.accentColor/surfaceColor` currently recolor the app via CSS variables — becomes a ThemeContext computing the derived shades (`surface-2`, glass stops) in JS (`colorUtils` has the math). Every styled component reads the context.
- **Fonts**: Fraunces + IBM Plex Sans (+ VT323/Mondwest if the pixel-label aesthetic is kept) bundled as **TTF/OTF** via expo-font (no `<link>`, no woff2).
- **Icons**: all 24 custom SVG components + `DiscoverFilterIcons`/`SettingsCategoryIcons`/`StremioLogo`/`PlayerControlIcons` convert to `react-native-svg` (mechanical; no icon library exists to swap in).
- **Toasts**: keep the `notifyError/Info/Success/Warning` signatures (called throughout the data layer), back them with an RN toast stack (HeroUI ToastQueue dies).
- **index.css (3,854 lines)** is the largest hidden cost: glass surfaces, 24 keyframes, focus rings, overscan insets, hero treatments — all re-authored as StyleSheet + Reanimated. Budget it explicitly (it's "the design", not boilerplate).
- **Splash**: native splash (expo-splash-screen) replaces the framer-motion SplashScreen; theme hydrates from MMKV synchronously (no FOUC problem).
- **ErrorBoundary**: keep the fallback UI; the stale-chunk `location.reload()` machinery dies (no web chunks).
- Dead deps confirmed by the critic — **do not budget**: `three`, `@ffmpeg/ffmpeg`, `@stremio/stremio-video`, `eventemitter3`. Dropped wholesale: `hls.js`, `react-color` (TV preset swatches only), `framer-motion` (→ Reanimated/moti where needed), HeroUI, Norigin, react-router, vite-plugin-pwa/service worker.

### 5.7 Storage key migration (MMKV)
`theme, uiStyle, stremioAuthKey, stremioUser, stremioSavedAccounts, blissful.playerSettings, blissfulProgressV1, blissfulLibraryV1, bliss:lastStream:*, blissful.subtitleLang, blissfulTorrentioUrls, bliss:trakt, bliss:watchParty:guestId/guestName, bliss:imdb-rating:* (in-memory), bliss:safe-back (in-memory)`. Fresh install = no data migration needed from the Tauri app (different app id) — accounts re-login; server-side library/progress sync restores state.

### 5.8 Updates (G4)
- **JS/UI changes**: EAS Update (expo-updates), `runtimeVersion` policy `nativeVersion`. Push an update → every TV picks it up on next launch. This is the production-OTA answer to the "I don't want to push APKs" requirement.
- **Native changes** (player module, ffmpeg AAR): new APK. Updater = current notify-only flow (GitHub releases/latest + toast), optionally upgraded to download + `PackageInstaller` prompt (`REQUEST_INSTALL_PACKAGES`, user grants "install unknown apps" once). Keep the `update-available` event contract for `useDesktopUpdater`.

### 5.9 Networking summary (what replaces proxy.rs)
| proxy.rs route | RN fate |
|---|---|
| `/addon-proxy` | **delete** — direct fetch to addon hosts (reconcile the catalog-direct vs rest-proxied asymmetry deliberately) |
| `/storage/*` | direct `https://blissful.budinoff.com/storage` (WS already direct; **verify backend WS Origin allow-list accepts RN clients**) |
| `/resolve-url` | native `probeUrl()` (D10) — DMCA <20 MB heuristic + final-URL substitution preserved |
| `/stream` relay | **delete** — OkHttp datasource has Happy-Eyeballs + pooling; hand ExoPlayer the resolved final CDN URL |
| `/img`, `/imdb-rating`, `/tmdb-find`, `/tmdb-season-info` | direct to backend (caching/API-key value preserved) |
| `/stremio/*` (FB login) | **drop** (popup flow impossible on TV) |
| `/trakt` (never existed) | direct `api.trakt.tv` |

---

## 6. The hard-won behaviors registry (MUST survive the rewrite)

Distilled from every inventory's pitfalls — each encodes a real shipped bugfix:

**Playback & streams**
1. Dead-stream defense is three-layered: pre-load probe `0<len<20MB` → placeholder; post-load `0<duration<300s` → placeholder; growing `skip[]` list as the loop breaker. Auto-fallback fires **once** (`autoFallbackFiredRef`); the in-player auto-fallback stays **disabled** (the old detail↔player loop).
2. Hand the player the **final redirected CDN URL**, not the addon's 302 (Range across redirect breaks MKV EOF seeks).
3. Buffering veil driven only by buffering+seeking signals, with the "initial idle echo can't dismiss the splash" gate and the "playback advanced past start" fallback dismiss.
4. Resume start position is **baked into load** (not a post-load seek race); >0.5s threshold.
5. Exact-frame seeking everywhere (skip targets, party sync).
6. EndFile `'eof'` vs `'stop'` distinction gates binge auto-advance.
7. Bounded demux/load-control buffers (50/16 MiB class) — mpv's 225 MB default OOMs the panel.
8. Coalesced D-pad seek: accumulate ±seekSec, fire ONE absolute seek ~350ms after the last press.
9. Up-Next: time-based trigger + `ended` fallback (binge works even with notification off); cancel/fired latches; unaired-next gate (`released > now` disables).
10. Progress cadence: 1s Trakt heartbeat, 4.5s save throttle, explicit flush on pause/advance/unmount; mount/unmount Stremio item sync; `blissful:progress` event → CW refresh (RN event emitter).
11. Skip-Intro: chapters win over segments (`chapterSkip ?? segmentSkip`); non-sticky visibility (seek back re-shows); OK fires the **skip** when armed, not pause; classification regexes verbatim.
12. Subtitle rules: addon-sub active ⇒ native sub hidden (never two renderers at once); per-file sub state reset on URL change; auto-pick latches once per file; cue clock freezes on pause **and** buffering; the auto-pick `sorted[1] ?? sorted[0]` heuristic.

**Library & progress**
13. Time units: Stremio cloud = **milliseconds**, local store = **seconds**; `'anime'→'series'` normalization; `video_id` only for series; series cloud offset only applies when `video_id` matches.
14. `getProgressPercent` returns **2** (not 0) when duration unknown but time>0; watched ≥90%; higher-percent-wins local-vs-cloud merge.
15. TV reads/writes the **Blissful backend** library (soft-toggle `removed`), never the Stremio datastore; detail-open fires `syncStremioItem` then re-reads (cross-device watched freshness).
16. `nextToWatch` gated on `watchedReady` (bitfield decoded) — never transiently pick ep 1 and latch the wrong season.
17. WatchedBitField decode: anchor-id-contains-colons handling, LSB-first bits, zlib ('deflate' not raw), never-throws → empty set. Port the canonical test.
18. `rewindLibraryItem` re-reads and asserts the reset persisted; `_mtime` bumps so other clients don't overwrite.

**Detail / episodes**
19. On TV a URL `videoId` only **focuses** the episode (never auto-opens the stream popup); `autoplay=1` flows do select.
20. Episode-range pagination for >50-ep seasons (One Piece): ranges of 50, land on the next-to-watch range, `userMoved` gating so range arrows stay steppable.
21. Dedupe episodes by id (duplicate keys corrupt lists/focus); bitfield decode still uses the un-deduped native order.
22. Stream popup closes **only when navigation bailed** (close-on-success bounces back — "stream opens then nothing happens").
23. TV doesn't double-prompt resume (home CW modal already asked; the Continue-watching stream row resumes directly).
24. Anime absolute-numbering correction for TMDB stills/ratings (S2+ empty → refetch S1, shift by earlier-episode count).
25. `EpisodeThumb` fallback chain keeps the skeleton up while the TMDB still is in flight (Cinemeta 404 thumbnails).
26. RD-only guard (`isAndroidPlayableUrl`) + unreleased-episode guard, with the boolean-return contract.

**Shell / social**
27. Safe-back tracking (no raw history-back into /player); back-at-home exits the app; one overlay layer per Back press.
28. Hero auto-rotation **disabled on real TV hardware** (decode spike per rotation); 200ms TV debounce on focus-driven meta fetches.
29. Library focus tracks the item **by id**, not index (sort/filter reorder safety).
30. Watch-party: all sync constants verbatim (§5.3); seeks broadcast explicitly by the UI (never derived from player events); stream URLs never shared (each client resolves its own); passwords never in URLs; the 4-condition connection gate; room-code alphabet/format helpers; `messageKey = userId-at` reaction identity.
31. Friends: optimistic cancel with 404-swallow; online-first sort; presence sorted-join polling key; `fetchSeqRef` newest-wins.
32. Storage 401 short-circuit per auth key; WS always direct (never proxied).
33. Toast queues' fire-and-forget contract — data-layer calls never block UX.

---

## 7. Feature parity matrix (disposition of everything)

**Legend**: ✅ reuse (pure TS) · 🔧 adapt (shims) · 🎨 rewrite-ui (logic kept, visuals RN) · 🔁 replace-native (different mechanism) · ❌ drop

| Area | Disposition highlights |
|---|---|
| **lib/ data layer** | ✅ the bulk (§5.3) · 🔧 storage/url bases (direct), Trakt base, bitfield primitives · 🔁 platform.ts (constants: always-TV), desktop/tauriBridge (→BlissPlayer), useTvBack (→BackHandler) · ❌ stremioFacebook, playerPageLoader, profileAvatars hash-rescue |
| **Player** | 🔁 engine (mpv→BlissPlayer/ExoPlayer) · ✅ skip segments, scrobble, progress, next-episode compute, dead-stream logic, stream-URL resolution logic, sub parsers/pickers, track-shape contract · 🎨 all controls/overlays (BottomControls, PauseOverlay w/ episode meta, EpisodesDrawer→vertical FlashList, UpNext, ScrubBar→TV-only D-pad seek, badges, SettingsPanel, buffering veil) · ❌ SimplePlayer + hls.js + transcode tree + external-player handoff + volume slider/fullscreen chrome |
| **Pages** | 🎨 Home (classic only: hero + CW rail + windowed rows→FlashList), Detail (TvDetailLayout + TvEpisodesRow + ranges + TvStreamsPopup + TvSimilarRow), Discover (filters + live-preview aside), Search (✅ orchestration), Library (sort/filter/remove), Settings (8 panels; preset swatches only), Profile, Invite, Addons · ❌ AccountsPage (inert), MobileHero/iOS prompt, Modern + Netflix modes |
| **Shell** | 🎨 nav rail/top bar (TV variants only), all modals (Login w/ native TextInput, avatar picker w/ its 2D grid, WhoWatching, HomeSettings up/down reorder, ResumeOrStartOver, StreamUnavailable, AddAddon), CW pending veil + state machine, PartyInviteListener banner · 🔧 all providers (composition order preserved; UIProvider collapses to classic/dark) |
| **Spatial** | 🔁/❌ per §5.5 — the layer deletes; semantics survive as native patterns |
| **Native shell** | ❌ proxy.rs, MpvSurface, viewport hack, IME stripper, gen/ scaffold · 🔁 bridge+mpv vocabulary→BlissPlayer, BACK→BackHandler · 🔧 updater (+EAS), manifest TV bits (leanback, banner, landscape) carry over |
| **Social** | ✅ protocol/REST/UserSocket/ActiveParties (sessionStorage→memory) · 🔧 useWatchPartyMpv (bind to BlissPlayer), presence (complete activity wiring) · 🎨 TvFriendsRail, party drawer/button/prompts/toasts, profile page · ❌ useWatchParty (`<video>` variant; keep type exports), DMs UI, FriendsAccordion (desktop) |
| **Cross-cutting** | 🎨 theming/fonts/icons/toasts/skeletons/Rating/TruncatedText/MediaCard+Menu/MediaRail (§5.6) · 🔧 deep links (`blissful://invite/<code>` via Linking) · ❌ PWA/SW, ErrorBoundary reload, RouteTransition (→navigator options) |

---

## 8. What gets *simpler* (the payoff beyond performance)

- **Whole proxy layer deleted** (proxy.rs, proxyBase, PROXY_BASE branches, port-sync pitfalls, mixed-content constraints).
- **Whole Norigin layer deleted** (focus death watchdog, carry-over guard, click() synthesis, portal/capture-listener workarounds, offset-geometry windowing, pause/resume choreography).
- **Whole WebView problem class deleted** (transparent compositing + FORTIFY SIGSEGV, IME viewport squish, BACK swallowing + predictive-back dedup, viewport scaling, YouTube uncomposited fullscreen, synthesized-click quirks).
- Buffering/HLS/transcode decision tree collapses (native codecs).
- Dual subtitle clock collapses (0-based position).
- OTA updates become *legitimate* instead of impossible.

---

## 9. Phases & milestones

### Phase 0 — Hardware spike (~1 week) · **go/no-go gate**
Goal: prove the three risky claims on the real 65PUS7354 before committing.
- Expo SDK 56 + tvos scaffold; leanback manifest; deploy to the TV.
- One home screen: hero + 2 FlashList rails of expo-image posters from a live Cinemeta catalog.
- BlissPlayer v0: Media3 + **Jellyfin ffmpeg AAR (spike-only)**; play one real RD 4K HEVC + DTS stream; verify hw video + sw audio + bounded buffers; test a DTS-HD and a TrueHD sample.
- One **EAS Update** cycle landing on the TV.
- Focus sanity: rail navigation + per-route focus restore prototype (probe bugs #815/#1706 on 0.85).
**Exit criteria:** smooth rails on the panel · DTS/TrueHD audible · 4K stable >30 min · OTA lands · focus restoration workable. **If any fail hard → revisit (Kotlin/Compose fallback discussion).**

### Phase 1 — Foundations (~1–1.5 weeks)
Monorepo/Metro + `packages/blissful-core` extraction (with web app consuming it — CI proves desktop unchanged) · MMKV adapters · theme context + fonts + icons + toasts · navigation skeleton + back ladder + safe-back · auth (login screen, saved session) · providers composition · storage sync.

### Phase 2 — Browse surfaces (~2 weeks)
Home (hero w/ no-rotate-on-TV, CW rail + resume/start-over modal + pending veil, rows + customize-home) · Detail (full TvDetailLayout, episodes + ranges, stream popup + ranking + filters, autoplay/skip loop, RD/unreleased guards, trailer via YouTube intent) · Discover · Search · Library (incl. hold-OK remove) · Addons · Settings.

### Phase 3 — Player (~2–3 weeks, the core)
BlissPlayer full vocabulary + probeUrl + exact seek + track selection + CaptionStyle · player screen: D-pad mode machine (plain/transport/top/panels), controls auto-hide + pinned-while-loading, buffering veil state machine, coalesced seek, OK-skip arming · subtitles (embedded + addon overlay + styling + delay + auto-pick) · skip segments · Up Next/binge · progress/Trakt cadences · dead-stream chain · HDR/4K badges · pause overlay with episode meta · episodes drawer · per-title test matrix (§3).

### Phase 4 — Social & polish (~1.5–2 weeks)
Friends rail + actions + nickname · presence (complete activity wiring) · watch party (sync hook on BlissPlayer, drawer, prompts, invite banners, invite deep link) · profile page · avatar editor · updater (EAS + APK notify/installer) · WS Origin verification.

### Phase 5 — Hardening & release (~1–2 weeks)
**Own LGPL ffmpeg build** (opus/vorbis added) swapped in · perf/memory soak on the panel (fast-scroll a 2,000-item library; 4 hr playback) · VLC fallback decision · release signing + `Blissful-TV-RN.apk` sideload flow · retire `blissful-tv-shell` (docs note) · README/PORT-MAP updates.

**Total: ~8–11 weeks of focused work** (solo, with agent assistance). Phases 2–4 parallelize partially once Phase 1 lands.

---

## 10. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| RN-TV focus restoration bugs (#815, #1706, #670) | High | Phase-0 probe; own save/restore hook per route; pin tvos version; this is the #1 TV-UX risk |
| Embedded ASS styling regression vs mpv | Medium-high (anime) | §4: addon subs keep full styling; document limitation; libmpv engine as v2 escape hatch |
| 1.5–2 GB RAM ceiling | Medium | FlashList + expo-image discipline (recyclingKey/downscale/sized sources), bounded player buffers, Phase-5 soak |
| ffmpeg/NDK build fragility | Medium | Pin ffmpeg 6.0 + NDK r26b (Jellyfin known-good); spike with prebuilt AAR first |
| GPL contamination via Jellyfin AAR | High if shipped | Spike-only; LGPL own-build is a Phase-5 release blocker |
| Backend WS Origin allow-list rejects RN | Low-medium | Verify in Phase 1; one-line server config if needed |
| Android HEAD-fetch bug bites a missed code path | Medium | All probes through native `probeUrl`; lint-ban `method:'HEAD'` in JS |
| New-Arch-only: any old-bridge dep is a hard blocker | Medium | Dep audit at Phase 1; all chosen libs are New-Arch ready |
| Expo/EAS coupling + version lockstep (SDK↔tvos) | Low | Accept; upgrades are coordinated bumps |
| Two UIs to maintain (web + RN) | Structural | blissful-core extraction maximizes the shared brain; UI drift is the accepted cost of native TV |
| MKV first-seek slowness on huge files (index build) | Low | Buffering UX covers it; tune LoadControl; known ExoPlayer behavior |

---

## 11. Open questions (need Ivan's call, none block Phase 0)

1. **Watch party in v1?** Plan says Phase 4. If TV-v1 can ship without it, Phase 4 shrinks a lot.
2. **VT323/Mondwest fonts** (pixel-label sidebar aesthetic) — keep on TV or simplify to Fraunces+Plex?
3. **Trailer behavior**: YouTube-app intent (leaves app, D-pad native) vs embedded WebView (in-app, worse remote UX)?
4. **APK self-update**: notify-only (current) or download+PackageInstaller prompt?
5. **App identity**: same package id as the Tauri APK (in-place upgrade, inherits "unknown sources" grant) or new id (side-by-side during transition)? Recommend: **new id during development, decide at Phase 5**.
6. RD API key entry: keep paste-only or add QR/device-code pairing (PORT-MAP recommendation)?

---

## 12. Dev workflow (once Phase 0 lands)

- `adb connect <tv-ip>` → `npx expo run:android` (dev client on the TV) → Metro + Fast Refresh over Wi-Fi.
- Debugging: React Native DevTools (press `j` in Metro). Flipper is retired.
- Profile on the **real panel**, not the emulator (emulator is Android 16; the TV is Android 9).
- Production: EAS Build (`tv` profile) → APK sideload; JS iterations via `eas update`.

---

*Sources for the research findings are recorded in the workflow output (androidx/media docs, Jellyfin androidx-media, react-native-video source, Expo TV/EAS docs, react-native-tvos issues, RN networking docs, ExoPlayer/Media3 issue tracker, expo-image issues, MMKV benchmarks).*
