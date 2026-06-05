# Android TV manifest patch

`tauri android init` generates a **phone/touch** Android project under
`src-tauri/gen/android/`. Tauri does **not** emit a leanback (TV) manifest, so
after `init` you must patch the generated `AndroidManifest.xml`. Without this
the app **will not appear on the Android TV launcher** and fails Play Store TV
validation.

`gen/` is git-ignored (Tauri regenerates it), so keep this file as the source
of truth and re-apply after any regeneration. If you commit `gen/`, track the
manifest so the edits survive.

File: `src-tauri/gen/android/app/src/main/AndroidManifest.xml`

## 1. Feature declarations — inside `<manifest>`, before `<application>`

```xml
<!-- Android TV: leanback UI. required="false" so the same APK can still
     sideload on phones; the LEANBACK_LAUNCHER category below is what makes it
     show on the TV home screen. -->
<uses-feature
    android:name="android.software.leanback"
    android:required="false" />

<!-- A TV has no touchscreen — must be declared not-required or Play filters
     the app off all TV devices. -->
<uses-feature
    android:name="android.hardware.touchscreen"
    android:required="false" />
```

## 2. Cleartext to the localhost proxy + streaming server

The WebView runs on the cleartext `http://tauri.localhost` scheme and fetches
`http://127.0.0.1:11471` (proxy.rs) and later `http://127.0.0.1:11470`
(streaming server). Android blocks cleartext by default, so allow it for
loopback only via a network-security-config (preferred over the blunt
`android:usesCleartextTraffic="true"`).

On `<application ...>` add:

```xml
android:networkSecurityConfig="@xml/network_security_config"
android:banner="@drawable/tv_banner"
```

Create `src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">tauri.localhost</domain>
    </domain-config>
</network-security-config>
```

## 3. LEANBACK_LAUNCHER intent category — on the main `<activity>`

Tauri's main activity already has the `MAIN` / `LAUNCHER` intent-filter. Add the
leanback category so the TV launcher lists the app (keep `LAUNCHER` too so it
also works on phones / for `adb` launch):

```xml
<intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LAUNCHER" />
    <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
</intent-filter>
```

## 4. TV banner asset

Android TV requires a **320×180 xhdpi** banner (`@drawable/tv_banner`) — it's
the icon shown on the TV home row. Drop `tv_banner.png` into
`src-tauri/gen/android/app/src/main/res/drawable-xhdpi/`. Use the Blissful mark
on a dark `#0a0a0a` field (matches the PWA `background_color`).

## 5. (Optional) lock orientation to landscape

TVs are landscape-only; add to the main `<activity>`:

```xml
android:screenOrientation="landscape"
```

## 6. Soft keyboard: overlay, don't resize

Two pieces (both required — the manifest flag alone is NOT enough):

1. On the main `<activity>`:

```xml
android:windowSoftInputMode="adjustPan"
```

2. In `MainActivity.kt` (gen/, next to the `enableEdgeToEdge()` call the
   Tauri template emits), strip the IME inset before it reaches the view
   tree:

```kotlin
val content = findViewById<View>(android.R.id.content)
ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
  // setInsetsIgnoringVisibility(ime(), …) is NOT platform-supported
  // ("Maximum inset not available for IME" crash) — strip only setInsets.
  val stripped = WindowInsetsCompat.Builder(insets)
    .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
    .build()
  ViewCompat.onApplyWindowInsets(v, stripped)
}
```

Why: under `enableEdgeToEdge()` the window soft-input mode is effectively
ignored — the IME is delivered as a WindowInsets `ime()` inset that the
Chromium WebView consumes by shrinking its viewport, reflowing ("squishing")
the whole 1920px-design UI behind the keyboard. Stripping the inset makes
the keyboard a pure overlay; the login form sits in the top half of the
screen so the focused field stays visible.

## 7. Hardware BACK → the `window.__blissOnBack` ladder

Override `dispatchKeyEvent` in `MainActivity.kt` (gen/) to route
KEYCODE_BACK through the page's `window.__blissOnBack` (installed app-wide
by `useTvBackHandler`, overridden by the player while mounted), falling back
to WebView `goBack()` / `finish()` when it returns false:

```kotlin
override fun dispatchKeyEvent(event: KeyEvent): Boolean {
  if (event.keyCode == KeyEvent.KEYCODE_BACK) {
    if (event.action == KeyEvent.ACTION_UP) {
      val wv = findWebView(findViewById(android.R.id.content)) ?: return super.dispatchKeyEvent(event)
      wv.evaluateJavascript("window.__blissOnBack ? window.__blissOnBack() : false") { res ->
        if (res != "true") runOnUiThread { if (wv.canGoBack()) wv.goBack() else finish() }
      }
    }
    return true // swallow DOWN+UP so the WebView's own history-back can't race
  }
  return super.dispatchKeyEvent(event)
}
```

(`findWebView` = trivial recursive search over `android.R.id.content`.)

Why dispatchKeyEvent: a View-level `OnKeyListener` on the WebView (the
original approach, in BlissfulMpvPlugin) only fires while the WebView holds
NATIVE focus — on a D-pad TV it usually doesn't, so BACK fell through to the
default activity handling and exited the app from any non-player screen.

## Verify

```powershell
# Build + install to a connected Android TV / emulator
npm run android:build        # from apps/blissful-tv-shell
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk

# Confirm the leanback launcher sees it
adb shell pm list packages | Select-String blissful
adb shell monkey -p com.blissful.tv -c android.intent.category.LEANBACK_LAUNCHER 1
```
