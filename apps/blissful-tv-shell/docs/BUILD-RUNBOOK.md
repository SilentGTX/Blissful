# Blissful TV — build an installable APK (RD‑only, native libmpv)

End‑to‑end, zero‑to‑APK guide for **Windows**. Goal: a sideloadable Android TV
APK that runs the Blissful UI, plays **Real‑Debrid** streams via **native
libmpv**, and shows up on the TV launcher. No local torrent server (RD‑only).

> **Reality check before you start**
> - The TV shell has **never been compiled** here, and the libmpv player +
>   SurfaceView‑under‑WebView compositing have **never run on hardware**. Expect
>   to iterate on the first build. Run the go/no‑go spike in
>   [`PHASE2-SPIKE.md`](./PHASE2-SPIKE.md) if the player misbehaves.
> - **Licensing:** the `dev.jdtech.mpv:libmpv` AAR bundles a **GPL** ffmpeg, so
>   the distributed **APK is GPL‑governed** (the Blissful source stays MIT). Fine
>   for personal sideloading; matters only if you redistribute the APK.
> - You need a real **Android TV** (or an Android TV **emulator** image). A phone
>   works for a smoke test but not for D‑pad/leanback validation.

---

## 1 · Install the toolchain (one‑time, Windows/PowerShell)

You currently have **JDK 17** only. Install the rest:

### 1a. JDK 17 — set `JAVA_HOME`
You already have Temurin 17. Point `JAVA_HOME` at it (adjust the path to your install):
```powershell
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-17.0.17.10-hotspot"
```
(Tauri/Gradle require JDK 17 — **not** 21. Verify later with `java -version`.)

### 1b. Rust + Android targets
Install Rust from <https://rustup.rs> (the `x86_64-pc-windows-msvc` toolchain),
then add the Android targets:
```powershell
rustup target add aarch64-linux-android x86_64-linux-android
# (arm64 = real TV hardware; x86_64 = the emulator. armv7/i686 only if you target old 32-bit TVs.)
```

### 1c. Android SDK + NDK
Easiest is **Android Studio** (<https://developer.android.com/studio>). During
setup or via **SDK Manager** install:
- **SDK Platform** API 34 (or latest) — *SDK Platforms* tab.
- **Android SDK Build‑Tools**, **Platform‑Tools** (gives `adb`), **Command‑line Tools** — *SDK Tools* tab.
- **NDK (Side by side)** — pick **r27 / 28.x** (≥ r26; r28 satisfies the 16 KB page‑size rule). *SDK Tools* tab → check "Show Package Details" to choose the version.

Default SDK location: `C:\Users\<you>\AppData\Local\Android\Sdk`.

### 1d. Environment variables
```powershell
setx ANDROID_HOME "C:\Users\Simos\AppData\Local\Android\Sdk"
# NDK path = <SDK>\ndk\<version>. List installed versions: ls "$env:ANDROID_HOME\ndk"
setx NDK_HOME "C:\Users\Simos\AppData\Local\Android\Sdk\ndk\27.2.12479018"
```
Add `platform-tools` (for `adb`) to PATH:
```powershell
setx PATH "$($env:PATH);$env:ANDROID_HOME\platform-tools"
```
**Close and reopen the terminal** so `setx` changes take effect.

### 1e. Verify
```powershell
java -version              # 17.x
rustc --version            # any stable
rustup target list --installed | Select-String android   # aarch64 + x86_64
adb --version              # platform-tools present
echo $env:ANDROID_HOME; echo $env:NDK_HOME; echo $env:JAVA_HOME   # all non-empty
```

---

## 2 · One‑time project setup (`apps/blissful-tv-shell`)

```powershell
cd D:\blissfullll\Blissful\apps\blissful-tv-shell
npm install                       # installs the Tauri v2 CLI locally

# App launcher/banner icons (tauri.conf.json references icons/* that must exist).
# Point at the Blissful logo PNG (≥512px square):
npm run icon -- ..\..\path\to\blissful-logo.png

# Generate the Android Gradle/NDK project under src-tauri/gen/android.
# This also runs `beforeBuildCommand` = build the UI (apps/blissful-mvs).
npm run android:init
```
After `android:init` you have `src-tauri/gen/android/`. **`gen/` is git‑ignored
and regenerated**, so the patches in step 3 must be re‑applied after any
re‑init (keep this doc + `MANIFEST_PATCH.md` as the source of truth).

---

## 3 · Wire native libmpv + the TV manifest (after every `android:init`)

### 3a. Copy the Kotlin player plugin
Copy the three files from `android-mpv/` into the app source set, **preserving
the package path** `com/blissful/tv/mpv`:
```powershell
$dst = "src-tauri\gen\android\app\src\main\java\com\blissful\tv\mpv"
New-Item -ItemType Directory -Force $dst
Copy-Item android-mpv\BlissfulMpvPlugin.kt,android-mpv\MpvBridge.kt,android-mpv\MpvSurface.kt $dst
```
No manual plugin registration — `src-tauri/src/mpv.rs` already calls
`register_android_plugin("com.blissful.tv.mpv", "BlissfulMpvPlugin")`; Tauri
discovers the `@TauriPlugin` class. Just keep the package/class names matching.

### 3b. Add the libmpv AAR + ABI filters
In `src-tauri/gen/android/app/build.gradle.kts`:
```kotlin
dependencies {
    implementation("dev.jdtech.mpv:libmpv:1.0.0")
}
android {
    defaultConfig {
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") } // arm64 = TV, x86_64 = emulator
    }
}
```
If Gradle can't resolve the AAR, add JitPack to the repositories block in
`src-tauri/gen/android/settings.gradle.kts` (or the app's `build.gradle.kts`):
```kotlin
maven { url = uri("https://jitpack.io") }
```
Confirm the AAR ships `arm64-v8a` (mandatory). If an ABI is missing you'd have
to build the `.so` from `media-kit/libmpv-android-video-build` — but 1.0.0
normally ships arm64‑v8a + x86_64.

### 3c. Patch `AndroidManifest.xml`
File: `src-tauri/gen/android/app/src/main/AndroidManifest.xml`. Apply **all** of
[`MANIFEST_PATCH.md`](./MANIFEST_PATCH.md):
1. `<uses-feature leanback required=false>` + `<uses-feature touchscreen required=false>` (before `<application>`).
2. On `<application>`: `android:networkSecurityConfig="@xml/network_security_config"` + `android:banner="@drawable/tv_banner"` — and create `res/xml/network_security_config.xml` (cleartext for `127.0.0.1` / `localhost` / `tauri.localhost`). **Without cleartext, every proxy/stream call fails.**
3. On the main `<activity>`: add the `LEANBACK_LAUNCHER` category to the existing intent‑filter (so it shows on the TV home), plus:
   ```xml
   android:configChanges="orientation|screenSize|smallestScreenSize|screenLayout|uiMode|navigation|keyboardHidden"
   android:screenOrientation="landscape"
   ```
   (`configChanges` is **required** — MPVLib is a process‑global singleton; an Activity recreation would crash/leak it.)
4. Drop a **320×180** `tv_banner.png` into `res/drawable-xhdpi/`.

---

## 4 · Build the APK

```powershell
cd D:\blissfullll\Blissful\apps\blissful-tv-shell
npm run android:build        # = tauri android build --apk  (also rebuilds the UI first)
```
Output (release, unsigned by default):
```
src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release.apk
```
> First build is slow (Gradle downloads, NDK compiles the Rust `.so` per ABI).
> For a quick signed‑debug iteration use `npm run android:dev` (below) instead.

---

## 5 · Install + launch on the TV

Put the TV in developer mode (Settings → About → click Build 7×), enable **USB/Network debugging**, then connect:
```powershell
# Network (most Android TVs): find the TV's IP in Settings → Network, then:
adb connect 192.168.1.XX:5555
adb devices                              # confirm it shows "device"

adb install -r "src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release.apk"

# Launch via the leanback launcher entry:
adb shell monkey -p com.blissful.tv -c android.intent.category.LEANBACK_LAUNCHER 1
```
The app should also now appear on the TV home screen (banner = `tv_banner.png`).

---

## 6 · Dev loop (hot reload on the TV)

```powershell
adb connect 192.168.1.XX:5555
npm run android:dev          # builds, installs, live-reloads the UI from Vite over the network
```
Keep the TV and PC on the same LAN. This is the fast loop for UI tweaks; you
only need the full `android:build` for a shareable APK.

---

## 7 · Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `android:init` fails: NDK/SDK not found | `ANDROID_HOME` / `NDK_HOME` unset or wrong version. Re‑check step 1d; reopen the terminal. |
| Gradle: can't resolve `dev.jdtech.mpv:libmpv` | Add the JitPack repo (step 3b). |
| App not on the TV home screen | `LEANBACK_LAUNCHER` category and/or the leanback `<uses-feature>` missing (step 3c.1/3). |
| Catalogs/login/streams blank or 404 | `proxy.rs` not running, **or** cleartext blocked (network_security_config missing — step 3c.2), **or** a route the UI calls isn't ported in `proxy.rs` (see the route‑audit findings). |
| Black screen where video should be / UI shows but no picture | The SurfaceView‑under‑transparent‑WebView compositing — run [`PHASE2-SPIKE.md`](./PHASE2-SPIKE.md). The WebView must be transparent and Z‑ordered above the Surface. |
| Player verb does nothing | A `window.blissfulDesktop` verb the UI calls isn't implemented in `tauriBridge.ts`/`mpv.rs` (see the player‑audit findings). |
| Crash on resume / rotate | `android:configChanges` missing on the activity (step 3c.3). |
| Magnet/non‑RD stream "does nothing" | Expected — RD‑only build has no torrent server; those are gated to a "Real‑Debrid required" state. Use RD streams. |
| Build wants JDK 21 / fails on JDK version | Force JDK 17 via `JAVA_HOME` (step 1a). |

---

## What's RD‑only about this build
- No embedded torrent streaming server (`ensureStreamingServer` → `false`).
- **Real‑Debrid** streams are direct HTTPS → play in libmpv with no local server.
- Magnet / `127.0.0.1:11470` / non‑RD rows are gated in the UI to a clear
  "Real‑Debrid required" state on Android (handled in `apps/blissful-mvs`, gated
  on `isAndroidTv()` — desktop still shows everything).
- Make sure your Real‑Debrid account is linked in‑app (Settings → the RD/debrid
  section) so the addons return `[RD+]` direct links.
