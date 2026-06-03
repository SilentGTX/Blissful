# android-mpv — the libmpv-android player plugin (Kotlin)

The Kotlin half of the Phase 2 native player. The Rust half (`src-tauri/src/mpv.rs`)
registers this plugin via `register_android_plugin("com.blissful.tv.mpv",
"BlissfulMpvPlugin")` and routes the `window.blissfulDesktop` player verbs to it.

- `BlissfulMpvPlugin.kt` — `@TauriPlugin`; the `@Command` handlers + event wiring.
- `MpvSurface.kt` — SurfaceView-under-transparent-WebView compositing.
- `MpvBridge.kt` — libmpv (MPVLib instance) init/observe/serialize + EndFile mapping.

> **Status: API-verified scaffold (not yet run on hardware).** The
> `dev.jdtech.mpv:libmpv:1.0.0` (MPVLib.kt source) and Tauri-Android-plugin APIs
> were checked against source and corrected:
> - `MPVLib.create()` returns nullable `MPVLib?` — handled.
> - v1.0.0 does **not** deliver the end-file reason (native `event.cpp` discards
>   it; there is no `end-file-reason` property), so it's inferred from the cached
>   `eof-reached` flag (natural EOF → `"eof"`, else `"stop"`).
> - plugin `trigger()` is listener-scoped (not a global broadcast), so events are
>   buffered until the renderer's `addPluginListener` registers, then flushed.
>
> All cross-file wiring (command/event names, payload shapes, Rust generics) was
> verified consistent. The remaining real unknown is **runtime on real TV
> hardware** — run the go/no-go compositing spike (`../docs/PHASE2-SPIKE.md`)
> before trusting it.

## ⚖ Licensing — the Android build is GPL

The `dev.jdtech.mpv:libmpv` AAR bundles ffmpeg built `--enable-gpl
--enable-version3`. Per the project decision, **the Blissful Android APK is
GPL-governed on redistribution** (unlike the Windows installer, which is LGPL).
Document this in the repo `README`/`LICENSE` before any public release:

> The Blissful **Android** build statically links a GPL-configured libmpv/ffmpeg
> (`dev.jdtech.mpv:libmpv`); the distributed Android APK is therefore licensed
> under the **GPL**. (The Blissful source remains MIT; the Windows installer
> remains LGPL.)

## Wiring into the generated Android project

`tauri android init` generates `src-tauri/gen/android/`. `gen/` is git-ignored, so
apply these after init (and re-apply after regeneration):

1. **Copy the Kotlin** into the app source set, preserving the package:
   ```
   src-tauri/gen/android/app/src/main/java/com/blissful/tv/mpv/
     BlissfulMpvPlugin.kt
     MpvSurface.kt
     MpvBridge.kt
   ```
2. **Add the libmpv AAR** to `src-tauri/gen/android/app/build.gradle.kts`:
   ```kotlin
   dependencies {
       implementation("dev.jdtech.mpv:libmpv:1.0.0")
   }
   android {
       defaultConfig {
           ndk { abiFilters += listOf("arm64-v8a", "x86_64") } // arm64 = TV; x86_64 = emulator
       }
   }
   ```
   Confirm the AAR ships `arm64-v8a` (mandatory) + `x86_64`. If an ABI is missing,
   build the `.so` from `media-kit/libmpv-android-video-build`.
3. **Lock the player Activity** against recreation (MPVLib is a process-global
   singleton) in the manifest:
   ```xml
   android:configChanges="orientation|screenSize|smallestScreenSize|screenLayout|uiMode|navigation|keyboardHidden"
   ```
4. **No manual plugin registration needed** — Tauri discovers the `@TauriPlugin`
   class via the `register_android_plugin(...)` call already in `src/mpv.rs`. Just
   ensure the package/class names match (`com.blissful.tv.mpv` / `BlissfulMpvPlugin`).

## Event path note

The plugin emits `mpv-prop-change` / `mpv-event` via `trigger(...)` (plugin-scoped).
The renderer subscribes to these via `addPluginListener('blissful-mpv', …)` — see
`apps/blissful-mvs/src/lib/tauriBridge.ts`. The updater's `update-available` is a
*global* app event (`listen`). Both are handled by `tauriBridge.on()`. **Verify
this event delivery end-to-end in the spike** — it's the one seam most likely to
need adjustment.
