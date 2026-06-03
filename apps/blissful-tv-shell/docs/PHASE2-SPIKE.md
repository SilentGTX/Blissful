# Phase 2 compositing spike (DO THIS BEFORE writing the player)

This is the **go/no-go gate** for the whole native-player approach: prove a video
plane renders **under a transparent Tauri Android WebView** on *real TV hardware*
before building the mpv-vocabulary bridge. A correct bridge over a broken
compositor shows a black screen and wastes weeks. (See `PHASE2-PLAN.md` §7 and the
critic re-weighting in §9.)

> **Code below is a labeled skeleton, not copy-paste-final.** I authored it from
> the design analysis but could not compile it here (no Android toolchain). Two
> things in particular **must be verified against the actual artifacts**: (1) the
> `dev.jdtech.mpv:libmpv:1.0.0` API is **instance-based** — confirm the exact
> `create/init/attachSurface/command/observeProperty/addObserver` signatures; (2)
> the wry `webView.parent` reparent is version-sensitive — pin tauri/wry and
> re-run this spike on upgrade.

## Run it in two stages (isolate the two unknowns)

- **Stage A — compositing only.** Use a *trivial* player (Android `MediaPlayer`
  on the SurfaceView, or even a solid color fill) to answer ONLY: "does a Surface
  render under a transparent WebView, with DOM controls above it, at speed?"
- **Stage B — libmpv binding.** Swap the trivial player for libmpv. Answers:
  "does libmpv bind to the Surface with `vo=gpu`, decode HEVC via mediacodec, and
  render embedded ASS subs?"

If Stage A fails, libmpv was never the problem → go to the fallback ladder
(§ bottom) before touching mpv.

## Prerequisites

1. `tauri android init` has generated `src-tauri/gen/android/`.
2. The leanback manifest + `network_security_config` from `MANIFEST_PATCH.md` are
   applied (cleartext to `127.0.0.1`/RD test URL).
3. Build runs on a **real Android TV box** (Shield + ≥1 Amlogic/Realtek operator
   box — they composite SurfaceView differently). Emulator is NOT sufficient for
   the perf/hole-punch gates.
4. One RD (or any direct-HTTPS) **HEVC 4K HDR** test URL for the perf gate, and
   one **MKV with embedded ASS subtitles + named chapters** for Stage B.

## Where the spike code lives

Tauri app-local Android code goes under the generated project:
`src-tauri/gen/android/app/src/main/java/com/blissful/tv/`. For the spike, add a
small Activity hook or a minimal Tauri plugin. The cleanest is a tiny plugin so
it survives `init` regeneration; for a throwaway spike, hooking the generated
`MainActivity` is fine. Keep it isolated so it's easy to delete.

---

## Stage A — compositing (Kotlin skeleton)

`CompositingSpike.kt` — call `attach(activity)` once the Tauri WebView exists
(e.g. from the plugin `load(webView)` hook, or after `setContentView`).

```kotlin
package com.blissful.tv

import android.app.Activity
import android.graphics.Color
import android.media.MediaPlayer
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.ViewGroup
import android.webkit.WebView

object CompositingSpike {
    private var surfaceView: SurfaceView? = null
    private var player: MediaPlayer? = null

    fun attach(activity: Activity, webView: WebView, testUrl: String) {
        // wry calls setContentView(webView) directly, so the WebView's parent
        // is the activity's android.R.id.content FrameLayout — a mutable
        // ViewGroup. (Same reconciliation Tauri's barcode-scanner plugin uses.)
        val parent = webView.parent as ViewGroup

        val sv = SurfaceView(activity)
        surfaceView = sv

        // Index 0 = drawn first = BEHIND the WebView. (Equivalent to appending
        // then webView.bringToFront(); pick ONE and verify on device.)
        parent.addView(sv, 0)

        // Make the WebView transparent so the SurfaceView shows through.
        // Hardware WebView + setBackgroundColor(0); do NOT setLayerType(SOFTWARE).
        webView.setBackgroundColor(Color.TRANSPARENT)
        webView.bringToFront()

        // IMPORTANT: do NOT call sv.setZOrderOnTop(true) (hides DOM controls)
        // nor setZOrderMediaOverlay(true) (only for stacking two SurfaceViews).
        // The default "behind the window" order is exactly what we want.

        sv.holder.addCallback(object : SurfaceHolder.Callback {
            override fun surfaceCreated(holder: SurfaceHolder) {
                // Stage A: trivial player so we test ONLY compositing.
                player = MediaPlayer().apply {
                    setDataSource(testUrl)
                    setDisplay(holder)
                    setOnPreparedListener { it.start() }
                    prepareAsync()
                }
            }
            override fun surfaceChanged(h: SurfaceHolder, f: Int, w: Int, ht: Int) {
                // In Stage B this becomes:
                // mpv.setPropertyString("android-surface-size", "${w}x${ht}")
            }
            override fun surfaceDestroyed(holder: SurfaceHolder) {
                player?.release(); player = null
            }
        })
    }

    fun detach(webView: WebView, originalBackground: Int = Color.BLACK) {
        player?.release(); player = null
        surfaceView?.let { (it.parent as? ViewGroup)?.removeView(it) }
        surfaceView = null
        webView.setBackgroundColor(originalBackground)
    }
}
```

React side — render a **bright, obvious overlay** so you can see DOM-over-video:

```tsx
// Drop temporarily into the TV build (e.g. in App during the spike).
<div style={{
  position: 'fixed', left: 40, bottom: 40, zIndex: 9999,
  padding: 24, borderRadius: 16,
  background: 'rgba(149,162,255,0.6)', color: '#fff', font: '700 28px IBM Plex Sans',
}}>BLISSFUL OVERLAY — if you can read this OVER the video, compositing works</div>
```

### Stage A pass/fail (hard gates — must ALL pass on each box)

- [ ] Video is visible through the transparent WebView region.
- [ ] The lavender overlay div renders **ABOVE** the video.
- [ ] No flicker; no black where the WebView should be transparent; video is not
      drawn on top of the overlay.
- [ ] **Sustained perf:** play the **4K HDR10 HEVC** URL for **5+ minutes** with
      the fullscreen transparent WebView present; **dropped frames stay low**
      (use `adb shell dumpsys SurfaceFlinger` / `gfxinfo`). This is the real TV
      risk, not "does it render once".
- [ ] **Input:** on a **real remote** (not just `adb keyevent`), D-pad up/down/
      left/right reach DOM focus, OK toggles a DOM button, Back fires a DOM
      handler, and `MEDIA_PLAY_PAUSE` reaches JS — i.e. the SurfaceView does not
      steal input.
- [ ] `surfaceChanged` resize keeps video correctly scaled on fullscreen toggle
      / rotation.

If any fail → **fallback ladder** (bottom). Do not proceed to Stage B.

---

## Stage B — libmpv binding (skeleton; verify v1.0.0 API)

Add `implementation("dev.jdtech.mpv:libmpv:1.0.0")` +
`ndk { abiFilters += listOf("arm64-v8a","x86_64") }` to the app
`build.gradle.kts`. Replace the Stage-A `MediaPlayer` block with libmpv.

> ⚠ The v1.0.0 API is **instance-based**. The calls below show the *shape*;
> confirm the real method names/signatures against the AAR before relying on it.

```kotlin
// Pseudocode shape — verify against dev.jdtech.mpv:libmpv:1.0.0
val mpv = MPVLib.create(activity)            // instance, NOT static MPVLib.command(...)
mpv.setOptionString("vo", "gpu")
mpv.setOptionString("gpu-context", "android")
mpv.setOptionString("hwdec", "mediacodec")   // fallback: mediacodec-copy -> no
mpv.setOptionString("volume-max", "200")     // 0–200 slider parity
mpv.init()

// in surfaceCreated:
mpv.attachSurface(holder.surface)
mpv.setOptionString("force-window", "yes")
mpv.command(arrayOf("loadfile", testHevcUrl))

// in surfaceChanged(w,h):
mpv.setPropertyString("android-surface-size", "${w}x${h}")

// in surfaceDestroyed: detach BEFORE destroy
mpv.setPropertyString("vo", "null")
mpv.setOptionString("force-window", "no")
mpv.detachSurface()
```

### Stage B pass/fail

- [ ] `hwdec=mediacodec` decodes the HEVC test stream (CPU stays low).
- [ ] An **embedded ASS subtitle renders** through the transparent WebView
      (proves `vo=gpu`+libass — the whole reason for libmpv over media3).
- [ ] A `loadfile <url2> replace` transition works (next-episode flow; watch for
      mpv-android `FILE_LOADED`-on-replace quirks #966/#1088).
- [ ] `observeProperty("time-pos", DOUBLE)` ticks at **≥5 Hz** (log consecutive
      timestamps — watch-party drift + smooth scrub depend on it).
- [ ] `seeking` flips true→false around a seek; `paused-for-cache` flips on a
      cold stream stall (the two buffering-veil signals).
- [ ] End-of-file emits a reason that maps to lowercase **`"eof"`** (binge gate).

Only after BOTH stages pass on the target hardware do you build the full
`tauri-plugin-blissful-mpv` (`PHASE2-PLAN.md` §6).

---

## Fallback ladder (if Stage A fails on a target box)

1. **`TextureView` instead of `SurfaceView`** — composites as a normal alpha
   view (no hole-punch); costs latency/memory but sidesteps SurfaceFlinger
   layer issues. libmpv on a TextureView needs the render API
   (`mpv_render_context` + a `SurfaceTexture`/EGL surface) rather than `wid`.
2. **media3 fallback backend** (`PHASE2-PLAN.md` §8) — behind the *same* mpv
   vocabulary; accept the two regressions (ASS force-style → size/fg/bg only;
   chapters → AniSkip/IntroDB fallback, already shipped).
3. **Custom `WryActivity` that owns its own layout** — instead of reparenting
   the content view, control the FrameLayout from the start (more robust for a
   TV app; the critics suggest considering this from day one).
