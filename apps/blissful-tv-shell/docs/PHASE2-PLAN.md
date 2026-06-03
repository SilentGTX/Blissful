# Blissful Android TV — Phase 2 Native Player Plan

> Output of the Phase 2 design workflow (libmpv-android + Tauri compositing), adversarially verified. The implementation scaffold is authored from this.

All facts are verified against source. The four mpv.command verbs (`loadfile`, `stop`, `set`, `sub-reload`), the exact loadfile shape (`'loadfile', resolved, 'replace', '-1', opts`), the EndFile `eof` lowercase gate (line 1590), the setProperty calls (`mute`, `volume`, `aid` as String), and the seek absolute/relative usage all match the research. I now have everything to write the decisive plan.

---

# Blissful Android TV — Phase 2 Native Player Implementation Plan

Grounded against the actual repo state: the Tauri TV shell already exists at `apps/blissful-tv-shell/` with a working bridge stub (`src-tauri/src/bridge.rs`), proxy (`proxy.rs`), and updater (`updater.rs`). `gen/android/` has **not** been generated yet. The player commands in `bridge.rs:44-49` are the Phase-2 stubs this plan replaces. The string-typed mpv vocabulary in `apps/blissful-mvs/src/lib/desktop.ts` + `tauriBridge.ts` is final and must not change.

---

## 1. Backend decision — libmpv-android (FINAL)

**Decision: libmpv-android, consumed as a prebuilt AAR. media3/ExoPlayer is rejected as the primary backend and kept only as a per-device codec fallback (§8).**

Deciding reasons, each tied to code that already ships and that media3 *cannot* emulate:

1. **Embedded ASS force-styling is a hard media3 gap and is load-bearing today.** `NativeMpvPlayer.tsx:1696-1753` issues `set sub-ass-override force`, `set sub-ass-force-margins yes`, `set sub-ass-force-style <PrimaryColour/OutlineColour/BackColour/FontSize>`, and `set sub-color/sub-back-color/sub-border-color`. media3's `SubtitleView`/`CaptionStyleCompat` is a CEA-608/WebVTT-grade renderer with no `sub-ass-override=force` analog (PORT-MAP.md §6 "Hard"; jellyfin-android #1833/#1584). libmpv ships libass; this transfers unchanged.

2. **MKV chapter enumeration is a hard media3 gap and drives Skip-Intro.** `desktop.mpv.getChapters()` → `chapter-list/count` + `chapter-list/N/{time,title}` walk (`mpv.rs:303-321`), plus the observed `("chapter", Int64)` property (`mpv_events.rs:94`), feed `useChapterSkip.ts`. media3 exposes no chapter API (PORT-MAP.md §6).

3. **1:1 vocabulary reuse → near-zero renderer change.** The bridge is pure string-typed mpv (`loadfile`/`stop`/`set`/`sub-reload`, `setProperty`, `seek+exact`). libmpv-android's `MPVLib` (`command(Array<String>)`, `setProperty*`, `observeProperty`, `EventObserver`) maps the Windows shell's `player/mpv.rs` contract directly. media3 would require a hand-written translation shim for every verb, several with no target (volume>100%, ASS, chapters).

4. **Sidesteps the libmpv2 Node-format panic.** The Windows shell walks `track-list/N`/`chapter-list/N` one primitive at a time because libmpv2 5.0.3 panics on `MPV_FORMAT_NODE`. `MPVLib` has only typed getters (Int/Double/Bool/String) — the *same* constraint — so the existing count-then-loop logic ports verbatim (it produces the exact `MpvTrack`/`MpvChapter` JSON shape the renderer expects).

media3's only defensible edge — bitstream audio passthrough and HDR tunneling — is **unusable here**: ExoPlayer tunneling forces a top-most SurfaceView that cannot composite under a transparent WebView (ExoPlayer #7334). It would break the entire compositing architecture (§2). HDR detection (`video-params/gamma`, `dwidth`) is reproducible on libmpv as it is today.

**AAR choice:** `dev.jdtech.mpv:libmpv` (jarnedemeulemeester/libmpv-android, MIT wrapper, Maven Central, bundles libmpv+ffmpeg+libass `.so`). Used by Findroid; ships the exact `MPVLib` JNI surface. **Open license question (must resolve before ship, §8):** confirm whether the bundled ffmpeg is `--enable-gpl`. The Windows side deliberately ships an LGPL build (CLAUDE.md "Licensing"). If the AAR is GPL-configured, either rebuild ffmpeg/mpv LGPL for Android via media-kit/libmpv-android-video-build (MIT "default" flavor, v1.1.11) and write a thin JNI, or accept GPL for the Android artifact and document it. This is a build-flag question, not a code question.

---

## 2. Compositing architecture — SurfaceView UNDER a transparent Tauri WebView

This is the make-or-break risk (PORT-MAP.md §8). The proven prior art is the in-tree **tauri-apps/plugins-workspace barcode-scanner** Android plugin, which does exactly "native surface behind a transparent Tauri WebView." We mirror it, substituting a `SurfaceView` for the camera `PreviewView`.

### View hierarchy & how it's reached

- wry calls `setContentView(webview)` directly (no wrapper layout); `RustWebView extends android.webkit.WebView` (wry `src/android/main_pipe.rs`, `RustWebView.kt`).
- Android's window decor wraps that content View, so at plugin-load time **`webView.parent` is the activity's `android.R.id.content` FrameLayout** — a mutable `ViewGroup`. This is the documented reconciliation that lets barcode-scanner do `webView.parent as ViewGroup`.

### Transparency, z-order, hole-punch

```
android.R.id.content (FrameLayout)
 ├─ [0] SurfaceView        ← addView(surfaceView, 0): first child = drawn first = BEHIND
 └─ [1] RustWebView        ← bringToFront(); setBackgroundColor(Color.TRANSPARENT)
```

- A `SurfaceView` lives on its **own SurfaceFlinger layer** placed behind its host window; it "punches a hole" through the (now-transparent) WebView region. Video shows through with zero per-frame WebView cost.
- **Do NOT call `setZOrderOnTop(true)`** — that puts video above the whole UI, hiding the DOM controls. **Do NOT call `setZOrderMediaOverlay(true)`** — only relevant when stacking two SurfaceViews. The default behind-the-window order is exactly correct. (Research report 1 suggested `setZOrderMediaOverlay(true)`; report 2 — which is grounded in the actual barcode-scanner source — corrects this to *neither*. Follow report 2.)
- **Do NOT** use Tauri's `WebviewWindowBuilder::transparent` (desktop-only, tauri #10152) and **do NOT** `setLayerType(LAYER_TYPE_SOFTWARE)` (obsolete, Chromium-discouraged). A hardware WebView with `setBackgroundColor(0)` is transparent on API 24+.

### Tauri plugin Kotlin hook points

- `override fun load(webView: WebView)` — the only place the WebView is handed to the plugin (no public `getWebView()`); **cache it here**.
- **Enter player** (on the bridge `attachSurface`/first `loadfile`): create `SurfaceView`, `parent.addView(surfaceView, 0)`, save `webView.background`, `webView.setBackgroundColor(Color.TRANSPARENT)`, `webView.bringToFront()`.
- `SurfaceHolder.Callback` (mpv-android `BaseMPVView.kt` order):
  - `surfaceCreated` → `MPVLib.attachSurface(holder.surface)`, set `vo=gpu`, `force-window=yes`.
  - `surfaceChanged(w,h)` → `MPVLib.setPropertyString("android-surface-size","${w}x${h}")` — the Android analog of the Windows `WM_SIZE → resize_webview` path; must fire on every resize/rotation/fullscreen toggle or video mis-scales.
  - `surfaceDestroyed` → `vo=null`, `force-window=no`, `MPVLib.detachSurface()` **before** any destroy.
- **Exit player**: remove the SurfaceView, restore `webView.background`.
- **Lifecycle ordering rule:** Surface must be ready before `loadfile` and `detachSurface()` must precede destroy, or libmpv crashes on a freed Surface. Tie strictly to `SurfaceHolder.Callback`, never to React mount.
- **Focus:** `SurfaceView` is non-focusable by default; `bringToFront()` keeps the transparent WebView receiving D-pad/Back/media keys. Verify in the spike (§7).

---

## 3. libmpv integration — obtain, link, bind, drive

**Obtain & link (no from-scratch build for v1):**
- Add `gen/android/.../build.gradle.kts`: `implementation("dev.jdtech.mpv:libmpv:1.0.0")`. The AAR bundles libmpv+ffmpeg+libass `.so`. Confirm it ships **arm64-v8a** (mandatory for TV) and **x86_64** (emulator); add `ndk { abiFilters += listOf("arm64-v8a","x86_64") }`. If an ABI is missing, fall back to building `.so` from media-kit/libmpv-android-video-build.
- The Rust plugin `.so` (Tauri command handlers) is cross-compiled by Tauri's mobile pipeline via `cargo-ndk` (`aarch64-linux-android`). `reqwest` already uses rustls in `Cargo.toml`, so the proxy cross-compiles cleanly.

**Bind to the Surface:** `MPVLib.attachSurface(holder.surface)` (§2). No custom GL / `mpv_render_context` / EGL needed — libmpv's `--vo=gpu --gpu-context=android` renders straight into the Surface. **Use `--hwdec=mediacodec` (fallback chain `mediacodec → mediacodec-copy → no`), NOT `--vo=mediacodec_embed`** — the embed VO disables subtitle/OSD/filter rendering, which would kill ASS parity.

**Driving layer — Kotlin owns the player core; Rust owns the Tauri plumbing.** This split is mandatory and decisive:
- **Kotlin/NDK** owns: `Surface`/`SurfaceView`/`SurfaceHolder.Callback`, WebView transparency, the libmpv `pthread` event loop + `JNIEnv` thread-attach, and the `MPVLib.EventObserver` callbacks. These all *must* be Android-side, and mpv-android already implements the event-thread + JNI dispatch correctly. Do not re-implement libmpv's event loop or Surface attach from Rust JNI.
- **Rust** owns: the Tauri `bridge` command router (string vocabulary), the localhost proxy (already done), and the notify-only updater (already done).
- **Bridge between them:** Rust `bridge` arms forward to the Kotlin plugin's `@Command` methods (`mpvCommand`, `mpvSetProperty`, `mpvGetTracks`, `mpvGetChapters`); the Kotlin `EventObserver` thread emits `mpv-prop-change`/`mpv-event` back through the plugin's Tauri channel. The renderer's event stream is reproduced verbatim.

**Init options** (`MPVLib.setOptionString` before `init()`, mirroring `mpv.rs:60-119`): `idle=yes`, `keep-open=yes`, `hwdec=mediacodec` (Android, vs desktop `auto`), `sub-auto=fuzzy`, `sub-visibility=yes`, `sub-ass-override=force`, `sub-ass-force-margins=yes`, `sub-use-margins=yes`, `cache-pause-wait=5`, `volume-max=200` (must be set or the UI 0–200 slider clips), `osc=no`, `osd-bar=no`, `osd-level=0`, `input-default-bindings=no`, `input-vo-keyboard=no`, `cursor-autohide=no`. `vo=gpu`/`gpu-context=android` replace the Windows `wid=HWND`.

---

## 4. Player-adapter contract — full command/property/event mapping

**Commands (UI → native), the JS vocabulary is reused UNCHANGED** (verified in `desktop.ts` + `NativeMpvPlayer.tsx`):

| Bridge command | JS args (unchanged) | Native target (libmpv-android) | Reuse |
|---|---|---|---|
| `getAppVersion` | — | `app.package_info().version` (already real, bridge.rs:24) | ✅ done |
| `log` | `string` | `log::info!` + forward (already real, bridge.rs:25) | ✅ done |
| `ensureStreamingServer` | — | v1 RD-only → `Ok(true)` (NOT `false` — see §5) | ⚠ change |
| `play` | — | `MPVLib.setPropertyBoolean("pause", false)` | new |
| `pause` | — | `MPVLib.setPropertyBoolean("pause", true)` | new |
| `mpv.command` | `[name, ...args]` | allowlist → `MPVLib.command(arrayOf(name, ...))` | new |
| `mpv.setProperty` | `[name, value]` | typed cascade (below) | new |
| `mpv.getTracks` | — | walk `track-list/N` → `MpvTrack[]` | new |
| `mpv.getChapters` | — | walk `chapter-list/N` → `MpvChapter[]` | new |
| `seek` | `{seconds, mode}` or `number` | `MPVLib.command(["seek", sec, "${mode}+exact"])` | new |
| `toggleFullscreen`/`isFullscreen` | — | `Ok(true)` (no-op, already stubbed) | ✅ done |
| `openPlayer` | `opts` | `Ok(null)` no-op (already stubbed) | ✅ done |
| `getUpdateStatus`/`downloadUpdate`/`installUpdate` | — | notify-only (already real/erroring) | ✅ done |

**`mpv.command` verbs actually issued by the UI** (grep-verified — only FOUR are load-bearing): `loadfile`, `stop`, `set`, `sub-reload`. Keep the full `ALLOWED_MPV_COMMANDS` allowlist (20 entries) for parity/safety, but `sub-add`/`audio-add`/`screenshot`/`cycle`/`playlist-*`/`show-text` are **dead** for this UI (addon subs render as an HTML overlay, not via `sub-add` — `NativeMpvPlayer.tsx:124-128`; only embedded `sid` goes through libmpv).

**`loadfile` exact shape** (`NativeMpvPlayer.tsx:1214`): `('loadfile', resolved, 'replace', '-1', opts)` where `opts` is `''` or `'start=<intSeconds>'`. Native must pass 4 trailing args straight to `MPVLib.command(arrayOf("loadfile", url, "replace", "-1", opts))`. Start position is baked into loadfile (NOT a follow-up seek) to survive slow-demux races.

**`set` properties** (all string-typed, `NativeMpvPlayer.tsx:1696-1805,2321-2474`): `sub-ass-override`, `sub-ass-force-margins`, `sub-scale`, `sub-font-size`, `sub-color`, `sub-back-color`, `sub-border-color`, `sub-ass-force-style`, `sid` (`'no'`|intString), `sub-visibility`, `alang`, `slang`, `sub-pos`, `sub-margin-y` → each via `MPVLib.setPropertyString(name, value)` (what mpv's `set` does internally). Color format conversions are produced UI-side; native forwards strings verbatim.

**`mpv.setProperty` numeric type cascade** (must replicate `commands.rs:274-315`): JS `Bool`→`setPropertyBoolean`; JS `Number`→ try int→double→string (`setPropertyString` is the universal fallback since mpv parses to the real type); JS `String`→`setPropertyString`. The UI only calls setProperty for `mute`(bool), `volume`(int 0–200), `aid`(String). Simplest correct path: route JS `Number` to `setPropertyString(name, n.toString())`.

**`seek` +exact INVARIANT** (`commands.rs:351-387`): always append `+exact`. Load-bearing for Skip-Intro (`useChapterSkip.ts` absolute), skip-segments, scrub commit, arrow-key seek, and watch-party. Add a unit test asserting the command array ends with `<mode>+exact`.

**Observed properties → `mpv-prop-change`** (register all 16 via `MPVLib.observeProperty(name, format)`; `mpv_events.rs:51-95`). Format ints: STRING=1, FLAG=3, INT64=4, DOUBLE=5:

| Property | Format | Renderer consumer |
|---|---|---|
| `time-pos` | DOUBLE | playbackClock + throttled state + hasShownVideo |
| `playback-time` | DOUBLE | **subtitle rAF clock** (0-based) — MUST observe both, not just time-pos |
| `duration` | DOUBLE | <300s → RD-DMCA auto-fallback |
| `pause` | FLAG | play/pause state |
| `paused-for-cache` | FLAG | OR'd with seeking → buffering veil |
| `volume` | DOUBLE | slider |
| `mute` | FLAG | mute UI |
| `eof-reached` | FLAG | — |
| `idle-active` | FLAG | — |
| `aid` | INT64 | audio menu |
| `sid` | INT64 | sub menu (N / 'no'→off) |
| `video-params/gamma` | STRING | HDR badge ('pq'/'hlg') |
| `dwidth` | INT64 | 4K badge (≥3840) |
| `dheight` | INT64 | — |
| `seeking` | FLAG | OR'd with paused-for-cache → buffering veil |
| `chapter` | INT64 | Skip-Intro (`useChapterSkip.ts`) |

**Lifecycle events → `mpv-event`** (`MPVLib` event ids → mpv names): FILE_LOADED=8→`FileLoaded`, START_FILE=6→`StartFile`, SEEK=20→`Seek`, PLAYBACK_RESTART=21→`PlaybackRestart`, END_FILE=7→`EndFile` (read `end-file-reason` → emit lowercase-comparable string `eof`/`stop`/`quit`/`error`/`redirect`), SHUTDOWN=1→`Shutdown`. **`EndFile` reason MUST be `'eof'` on natural completion** — the binge/up-next gate is `(e.reason ?? '').toLowerCase() === 'eof'` (`NativeMpvPlayer.tsx:1590`); get this wrong and auto-advance silently breaks.

**Event envelopes (exact, unchanged):** `{event:'mpv-prop-change', data:{name, value}}` and `{event:'mpv-event', data:{type, reason?}}` (matches `mpv_events.rs::to_renderer`).

---

## 5. Rust changes — implementing the bridge.rs Phase-2 stubs

Current stubs to replace (`apps/blissful-tv-shell/src-tauri/src/bridge.rs`):
- `bridge.rs:44-47` — `play | pause | seek | mpv.command | mpv.setProperty | openPlayer` no-op arm.
- `bridge.rs:48-49` — `mpv.getTracks`/`getChapters` returning `[]`.
- `bridge.rs:40` — `ensureStreamingServer` returns `false`; **change to `true`** for RD-only v1 (the UI awaits this before every load at `NativeMpvPlayer.tsx:1109`; `false` blocks RD playback). Magnet/`127.0.0.1:11470` URLs route to the "torrents later" graceful state (UI must not throw — SPEC Phase 2).

**Implementation model:** the Rust `bridge` command becomes a thin router that forwards player verbs to the **Kotlin plugin** (which owns `MPVLib`). Two viable wirings; pick the **Kotlin-owns-MPVLib** model (recommended by report 4's threading analysis — replaces the Windows flume+NWG Notice):

- Rust `bridge` arm for `play`/`pause`/`seek`/`mpv.*` → invoke the registered Android plugin command (`tauri::plugin` handle) → Kotlin `MpvPlugin` method → `MPVLib`. Result `Value` returned through Tauri's normal invoke correlation.
- Kotlin `EventObserver` (on the libmpv event thread) → `plugin.trigger("mpv-prop-change"/"mpv-event", payload)` → reaches the renderer via the existing `tauriBridge.ts` `on()` → `event.listen` path. **No envelope change needed** — `tauriBridge.ts:62` already unwraps `e.payload`.

New Rust modules/files:
- `src-tauri/src/mpv.rs` — the bridge arms for `play`/`pause`/`seek`/`mpv.command` (with the `ALLOWED_MPV_COMMANDS` allowlist ported from `commands.rs:192-213`)/`mpv.setProperty` (the int→double→string cascade)/`mpv.getTracks`/`mpv.getChapters`. On desktop builds these are `#[cfg(not(target_os="android"))]` no-ops so the desktop dev build still compiles.
- `bridge.rs` itself: replace the stub arms with `crate::mpv::*` dispatch; flip `ensureStreamingServer → Ok(json!(true))`.
- `src-tauri/src/lib.rs` — register the Android plugin in the builder under `#[cfg(target_os="android")]`: `.plugin(tauri_plugin_blissful_mpv::init())`.
- `capabilities/default.json` — add the plugin's command permissions (the app-defined `bridge` command needs none, but plugin commands do).

Unit tests (next to the code): seek `+exact` suffix assertion; setProperty cascade for bool/int/float/string; allowlist rejection of `run`/`subprocess`.

---

## 6. File scaffold list (exact new files to author next)

**Rust (in `apps/blissful-tv-shell/src-tauri/`):**
- `src/mpv.rs` — player command router (`play`/`pause`/`seek`/`mpv.command`/`mpv.setProperty`/`mpv.getTracks`/`mpv.getChapters`); ports `ALLOWED_MPV_COMMANDS` + the setProperty cascade + seek `+exact`; Android arms call the plugin, desktop arms are no-ops. Contains the unit tests.
- *(edit)* `src/bridge.rs` — route the six player arms to `crate::mpv`; `ensureStreamingServer → Ok(true)`.
- *(edit)* `src/lib.rs` — `mod mpv;` + `#[cfg(target_os="android")] .plugin(...)`.
- *(edit)* `Cargo.toml` — add the local mpv plugin crate dependency (path).

**Tauri Android plugin (new crate `apps/blissful-tv-shell/tauri-plugin-blissful-mpv/`):**
- `Cargo.toml` — `tauri::plugin` crate (`crate-type = ["cdylib","rlib"]`).
- `src/lib.rs` — `init()` builder; registers `@Command`-bridged methods; defines the Kotlin plugin entry; declares the events `mpv-prop-change`/`mpv-event`.
- `permissions/` — autogenerated command permission TOMLs.
- `android/build.gradle.kts` — `implementation("dev.jdtech.mpv:libmpv:1.0.0")`, `abiFilters [arm64-v8a, x86_64]`, `minSdk 24`.
- `android/src/main/AndroidManifest.xml` — leanback + plugin registration.
- `android/src/main/java/.../BlissfulMpvPlugin.kt` — `@TauriPlugin` class: `load(webView)` caches WebView; `@Command mpvCommand/mpvSetProperty/mpvGetTracks/mpvGetChapters/play/pause/seek`; owns `MpvSurface` lifecycle + WebView transparency; bridges `EventObserver` → `trigger(...)`.
- `android/src/main/java/.../MpvSurface.kt` — the `SurfaceView` + `SurfaceHolder.Callback` (attach/detach/`android-surface-size`), the `addView(surfaceView,0)` + `bringToFront()` compositing, and the init-options block (mirrors `BaseMPVView.kt`).
- `android/src/main/java/.../MpvBridge.kt` — `MPVLib` init/observe-16-properties, the `track-list/N`/`chapter-list/N` count-then-loop serializers (port of `mpv.rs:221-321`), the setProperty cascade, the `EndFile` reason→string mapping.
- `guest-js/index.ts` + `src/commands.rs` — plugin command glue (standard Tauri plugin scaffold).

**Gen (generated by `tauri android init`, then patched):**
- `src-tauri/gen/android/` — the leanback Activity/manifest; the patched `app/build.gradle.kts` pulling in the plugin AAR dependency.

---

## 7. Spike-first checklist (compositing + single-video proof BEFORE feature work)

Do this on **real Android TV hardware** (Shield + at least one Amlogic/Realtek operator box — they composite SurfaceView via different paths) before any vocabulary work, because a correct bridge over a broken compositor shows nothing (PORT-MAP.md §8, report 2 "RISKIEST UNKNOWN").

Minimal proof:
1. `tauri android init`; leanback manifest; build runs on device.
2. Strip the plugin to: `load(webView)` cache → `addView(SurfaceView, 0)` → `webView.setBackgroundColor(0)` + `bringToFront()`.
3. `MPVLib.create/init` with `vo=gpu, gpu-context=android, hwdec=mediacodec`; `attachSurface` on `surfaceCreated`; hardcode `loadfile <one RD HTTPS HEVC test URL>`.
4. Render a bright DOM overlay div (fixed, semi-transparent) on top from the React side.

**Pass/fail criteria:**
- ✅ Video is visible through the transparent WebView region.
- ✅ The DOM overlay div renders **ABOVE** the video (controls will work).
- ✅ No flicker / no black where the WebView should show through / video not above controls.
- ✅ D-pad + Back + media keys reach the WebView (not stolen by SurfaceView).
- ✅ `surfaceChanged` resize keeps video correctly scaled on fullscreen/rotation.
- ✅ Embedded ASS subtitle renders (proves `vo=gpu`+libass, not `mediacodec_embed`).
- ✅ `hwdec=mediacodec` decodes HEVC; test a `loadfile ... replace` transition (next-episode flow — mpv-android #966/#1088 quirks).

**Fail → fallback ladder:** (a) try `TextureView` instead of SurfaceView (composites as a normal alpha view, costs latency/memory but sidesteps hole-punch); (b) if that also fails on the target box, escalate to the media3 fallback (§8).

---

## 8. Risks & fallbacks

| Risk | Mitigation / Fallback |
|---|---|
| **Compositing fails on TV-box GPU (hole-punch / overlay plane).** Top risk. | Spike first (§7). Fallback ladder: SurfaceView → TextureView → media3. |
| **libmpv-under-WebView infeasible on target hardware.** | **media3 fallback:** keep media3 as a *narrow* alternate backend behind the same `bridge` vocabulary. media3 covers HEVC/HDR/seek/tracks/volume-cap; accept the two regressions — embedded ASS force-style (degrade to size/fg/bg only via `CaptionStyleCompat`; addon HTML-overlay subs are unaffected) and MKV chapters (Skip-Intro falls back to the already-shipped AniSkip v2 + TheIntroDB path, `useChapterSkip.ts` is shaped for a second source). Do **not** ship both backends in parallel by default — the dual shim surface diverges. Adopt media3 only on a concrete device-incompat allowlist. |
| **AAR ffmpeg may be GPL (`--enable-gpl`), breaking the project's LGPL posture.** | Verify the AAR's ffmpeg flags. If GPL: rebuild LGPL via media-kit/libmpv-android-video-build (MIT default flavor) + thin JNI, OR accept GPL for the Android artifact and document it (Android static-link removes the Windows DLL-swap affordance regardless). |
| **`hwdec=mediacodec` device quirks + playlist `loadfile replace` failures.** | Fallback chain `mediacodec → mediacodec-copy → no (sw)`; test next-episode transitions explicitly in the spike. |
| **ABI coverage.** | Confirm AAR ships arm64-v8a (mandatory) + x86_64 (emulator); `abiFilters` enforce. |
| **`webView.parent as ViewGroup` could break across wry/Tauri versions.** | Pin wry/tauri versions; add a smoke test. Defensive option: custom Activity extending `WryActivity` that owns its own layout. |
| **`android-surface-size` desync on resize/rotation/fullscreen.** | Wire `surfaceChanged → setPropertyString("android-surface-size", "WxH")` as a hard rule (the Windows `WM_SIZE` analog). |
| **Observe `playback-time` AND `time-pos`.** | Both are in the 16-property set; dropping `playback-time` causes 5-10s subtitle drift on non-zero-start MKVs. |
| **`volume-max=200` must be set at init** or the 0–200 slider clips at mpv's default. | Set `setOptionString("volume-max","200")` before `init()`. |

---

**Key source files cited:** `apps/blissful-tv-shell/src-tauri/src/bridge.rs` (Phase-2 stubs to replace), `src/lib.rs`, `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`; `apps/blissful-tv-shell/docs/PORT-MAP.md` (§3,6,8,9); `apps/blissful-mvs/src/lib/{desktop.ts,tauriBridge.ts,platform.ts}` (unchanged contract); `apps/blissful-mvs/src/components/NativeMpvPlayer.tsx` (loadfile :1214, eof gate :1590, sub-* set :1696-1805/2321-2474, setProperty :1979-2047, seek :2798-2895, ensureStreamingServer :1109); `apps/blissful-shell/src/player/mpv.rs` (init :60-119, get_tracks :221-262, get_chapters :303-321), `mpv_events.rs` (OBSERVED_PROPERTIES :51-95, to_renderer), `src/ipc/commands.rs` (ALLOWED_MPV_COMMANDS :192-213, setProperty cascade :274-315, seek+exact :351-387); `CLAUDE.md` Licensing section. External: mpv-android `MPVLib.kt`/`BaseMPVView.kt`, jarnedemeulemeester/libmpv-android (`dev.jdtech.mpv:libmpv`), tauri-apps/plugins-workspace barcode-scanner Android plugin, wry `main_pipe.rs`/`RustWebView.kt`, tauri #10152, ExoPlayer #7334.

---

## 9. Critic corrections (apply these during implementation — from the adversarial verify pass)

The verify pass (3 lenses, 8 blocker/high) found the §1–8 plan is architecturally sound but needs these corrections. **Apply them; do not implement §3–§6 verbatim without them.**

1. **GPL licensing is a VERIFIED FACT, not an open question (ship-blocker — decide first).** The `dev.jdtech.mpv:libmpv` AAR bundles ffmpeg built `--enable-gpl --enable-version3`. That makes the Android artifact **GPL**, contradicting the project's deliberate **LGPL** posture (Windows ships LGPL libmpv so users can swap the DLL — an affordance Android static-linking removes anyway). **Decision required before any libmpv code:** (a) accept GPL for the Android build + document in README/LICENSE (needs explicit sign-off), or (b) rebuild ffmpeg/mpv **LGPL** for Android via `media-kit/libmpv-android-video-build` (MIT "default" flavor) + a thin JNI. This is a policy call, not a code task.

2. **The pinned AAR (`dev.jdtech.mpv:libmpv:1.0.0`) is INSTANCE-BASED, not the static `MPVLib`.** §3/§4/§6 Kotlin must use `val mpv = MPVLib.create(ctx); mpv.init(); mpv.command(arrayOf(...)); mpv.observeProperty(...); mpv.addObserver(observer)` — NOT `MPVLib.command(...)`. Verify the exact v1.0.0 signatures (`attachSurface`, `observeProperty`, `setPropertyString`, event ids) before writing the bridge.

3. **Compositing is validated only at the API level, NOT on TV-GPU hardware.** The barcode-scanner analogy is a *camera PreviewView*, not a `vo=gpu`/EGL video SurfaceView on Amlogic/Mali/Realtek operator boxes. Make the §7 spike a **hard go/no-go gate budgeted in weeks**, tested on ≥2 operator boxes + a Shield, with a **sustained 4K-HDR-HEVC performance gate** (play 5+ min, measure dropped frames) — not just "video is visible". Also de-risk by proving compositing with the *simplest* player first (bare `MediaPlayer`/media3 on a SurfaceView) before binding libmpv.

4. **Transparency theme caveat:** in patched `gen/android` `themes.xml`, ensure the Activity theme does NOT force an opaque `windowBackground` over the video region; confirm `WryActivity`'s theme. Transparent-on-Android is historically painful (tauri tracker) — the spike must distinguish "renders correctly" vs "opaque" vs "flickers".

5. **Z-order correction:** barcode-scanner appends the surface to the END then `bringToFront()`s the WebView. Net effect = surface behind. `addView(surfaceView, 0)` is equivalent; pick one and verify. Do **NOT** call `setZOrderOnTop(true)` or `setZOrderMediaOverlay(true)`.

6. **EndFile-reason bug (binge auto-advance):** the Windows shell emits a **numeric Debug string** for the end-file reason, but the React gate is `(e.reason ?? '').toLowerCase() === 'eof'` (NativeMpvPlayer.tsx:1590) — so auto-advance likely never fires even on Windows. The Android plugin MUST map libmpv's end-file reason int → lowercase strings (`0→"eof"`, `2→"stop"`, `3→"quit"`, `4→"error"`, `5→"redirect"`) and assert a natural-completion test yields `"eof"`. (Worth filing as a Windows bug too.)

7. **High-frequency event throttling:** `time-pos` + `playback-time` arrive on libmpv's native pthread at mpv's tick rate. Throttle on the **Kotlin** side (mirror the Windows ~5 Hz) before `trigger(...)`, but verify the cadence stays **≥5 Hz** — watch-party drift sync + scrub-hold release depend on it (measure in the spike).

8. **Buffering veil:** both `paused-for-cache` and `seeking` FLAGs must arrive, and BOTH true→false and false transitions are load-bearing. Spike must verify `seeking` flips around a `desktop.seek` with `hwdec=mediacodec`, and `paused-for-cache` flips on a cold RD stall.

9. **MPVLib is a process-global singleton** — fragile across Activity recreation. Lock the player Activity's `android:configChanges` (`orientation|screenSize|smallestScreenSize|screenLayout|uiMode|navigation|keyboardHidden`) so a config change doesn't recreate it mid-playback; define an explicit teardown ordering (`detachSurface` before destroy).

10. **`sid='no'` disabled-track case:** observe `sid`/`aid` as INT64, but when libmpv reports no track, emit the string `'no'` (the React handler accepts `'no'`/`false`/omit).

11. **16KB/NDK risk is CLOSED** for the pinned AAR (built with NDK 29) — drop it from the default-path risk list; re-add only if you take the LGPL-rebuild path (then use NDK r28+ or `-Wl,-z,max-page-size=16384`).

**Net re-weighting:** make (1) the licensing decision and (3) the compositing hardware gate explicit **pre-conditions with their own milestones BEFORE** any vocabulary/feature work. See `docs/PHASE2-SPIKE.md` for the concrete spike.