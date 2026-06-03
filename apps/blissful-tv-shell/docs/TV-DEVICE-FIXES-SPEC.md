# Blissful TV — on‑device fixes spec

First real run of the APK on hardware (2026‑06‑02). The app launches, libmpv
initialises (`mpv: Done loading scripts / event: idle`), the UI renders, and the
D‑pad works — but there's a cluster of issues to fix. This is the working list,
ordered by impact, with confirmed root causes where known.

**Device under test:** generic Android TV, **1920×1080**, **density 320 dpi (= 2.0)**,
WebView **142.0.7444.171**, Android 8+ (minSdk 26). App id `com.blissful.tv`.

---

## P0 — Issue 1: Whole UI renders ~2× too big  ⭐ root of most visual bugs
**Symptoms (images 55–60):** nav rail huge + overlaps the search bar + "Friends"
cut off at the bottom; Continue‑Watching cards larger than the Popular rows
below; movie/series detail screen oversized so Episodes + "You may also like"
are pushed off‑screen (only labels visible); Settings tabs/cards clipped at the
edges. Everything is bigger than the `?tv=1` browser test (images 61–62).

**Root cause (CONFIRMED):** physical 1920×1080 at **density 2.0** ⇒ the WebView's
CSS layout viewport is **960×540**. The app + its `html[data-tv]` styling were
designed/validated at a ~1920‑px viewport (desktop Chrome at `?tv=1`, DPR 1), so
at 960 px every px‑/rem‑sized element is ~2× larger relative to the screen.

**Fix:** force a fixed **1920‑px layout viewport on the Tauri Android build only**
(the WebView then scales 1920→physical; 1:1 on 1080p, sharp 2× on 4K). Apply via
an inline `<head>` script in `apps/blissful-mvs/index.html` gated on the Tauri
origin so desktop/browser are untouched:
```html
<script>
  // Android TV WebView reports a density-scaled viewport (1920/2.0 = 960px),
  // making the 1920-designed UI render 2x too big. Pin a 1920 layout viewport
  // ONLY in the Tauri Android WebView (served from tauri.localhost). Windows
  // shell (127.0.0.1) + browser (localhost) keep width=device-width.
  if (location.hostname === 'tauri.localhost') {
    var vp = document.querySelector('meta[name=viewport]');
    if (vp) vp.setAttribute('content', 'width=1920, initial-scale=1, viewport-fit=cover');
  }
</script>
```
Must run in `<head>` before first layout. After this, re‑check the residual
per‑component issues below (most should resolve once the viewport is 1920).

**Residual to verify after the viewport fix:**
- Nav rail width / overlap with the centered search pill (`.tv-topbar`).
- Continue‑Watching card height vs the Popular rails (MediaRail variants).
- Detail page: Episodes rail + "You may also like" must fit (TvDetailLayout
  vertical budget).
- Settings panel clipping at the right edge (overflow / border-radius).

---

## P0 — Issue 2: Real‑Debrid streams don't open (FUNCTIONAL blocker)
**Symptom:** open a title → stream selector → click a Real‑Debrid stream →
**nothing happens** (no player, no error, no modal).
**Hypotheses (to confirm via logcat while clicking):**
1. `handleNavigateToPlayer` navigates to `/player?url=…` but `PlayerPage`/`NativeMpvPlayer` renders nothing on device.
2. The RD‑only guard (`isAndroidPlayableUrl`) wrongly rejects the RD URL (would show the RD‑required modal, not "nothing" — so less likely).
3. The stream's `deepLinks.player` is null on device, so `onPress` returns early.
4. Click/OK isn't reaching the row (focus/overlay issue in the popup).
**Diagnosis:** `adb logcat` filtered to the app PID while pressing OK on an RD
row; look for the `/player` navigation, `loadfile`, RustStdoutStderr, or a JS
error. Then fix the broken link in the chain.

---

## P1 — Issue 3: App is sluggish / slow (frequent jank)
**Symptom:** noticeable lag; `OpenGLRenderer: Davey! duration=700–1765ms` frames
on startup. **Likely cause:** `chromium: eglChooseConfig failed … EGL_BAD_ATTRIBUTE`
— the WebView's GL surface config is rejected, which can force software
compositing (slow) and is tied to the transparent‑WebView‑over‑SurfaceView setup
(Issue 6). **Plan:** fix the EGL config (the WebView GL attributes / transparency
setup) so the WebView is hardware‑accelerated; reduce first‑load cost (the JS
bundle is ~1.8 MB — code‑split / lazy‑load heavy routes); confirm `data-tv`
animations aren't thrashing on the slower TV GPU.

---

## P1 — Issue 4: Back button closes the wrong thing
**Symptom:** the remote **Back** button should go **back a page**, not just close
the current popup/return to the previous screen inconsistently. **Plan:** wire
Tauri v2 `app.onBackButtonPress` to a proper ladder — close topmost overlay/modal
first (stream popup, menus, drawers), else navigate router back, else exit at the
home screen. (Noted as unwired/device‑only in PHASE3‑STATUS.)

---

## P2 — Issue 6: Video compositing (libmpv SurfaceView ⟷ transparent WebView)
The make‑or‑break for playback once Issue 2 is fixed: the WebView must be
transparent and Z‑ordered above the mpv SurfaceView, or video shows as a black
rectangle behind the UI. Related to the EGL error (Issue 3). Validate per
`PHASE2-SPIKE.md` once a stream actually launches.

---

## Tackle order
1. **Issue 1 (viewport)** — one small, high‑impact change; fixes most of the visual report.
2. **Issue 2 (streams open)** — functional; diagnose with logcat, fix the chain.
3. **Issue 4 (Back button)** — quick, big UX win.
4. **Issue 3 (perf/EGL)** + **Issue 6 (compositing)** — related GL work; do together.
5. Re‑verify residual layout (Issue 1 list) after the viewport fix.

## Iteration loop
Full `tauri android build --apk` per change is ~2–5 min (Rust cached). For the
UI‑heavy fixes (Issues 1, 4) consider `npm run android:dev` (live‑reload the
WebView over LAN, no APK rebuild) once set up. After each rebuild:
`adb install -r Blissful-TV.apk` (re‑sign if release).
