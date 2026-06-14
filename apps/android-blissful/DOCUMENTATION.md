# Blissful Android TV (`apps/android-blissful`) — the React Native app

A ground-up **React Native (react-native-tvos) rewrite** of the Blissful client for
**Android TV** (leanback) and the real living-room TV. Replaces the superseded Tauri
`blissful-tv-shell`. **Goal: match the Windows/web app 1:1** in visuals and behaviour — read
the reference component + `index.css` and replicate exactly; no generic UI.

**Feature registry — read first, keep updated:** [`docs/FEATURES.md`](docs/FEATURES.md) holds
one structured record per screen/feature (files, the reference it mirrors, deliberate
decisions, gotchas, how to verify). **Before** working on a feature, Grep that file for its
heading and read the record (plus the *Cross-cutting: D-pad focus* record). **After** adding or
changing behaviour — or discovering a new decision/gotcha — update the record in the same
change. Records are current-state pointers, not changelogs; keep them ≤ ~15 lines.
**Doc hierarchy:** this file = stack + build/run + hard rules; `docs/FEATURES.md` = per-feature
truth; the memory dir = cross-session state.

## Stack

- **Expo SDK 56** + **react-native-tvos@0.85.3-0** + **New Architecture** (Fabric/Hermes).
  IMPORTANT (see [`AGENTS.md`](AGENTS.md)): Expo changed a lot — read the versioned docs at
  https://docs.expo.dev/versions/v56.0.0/ before writing Expo code.
- **expo-video** for playback (the mpv analogue; bridged via hook opts
  `{getTime, pausedRef, seek, play, pause, setRate}`). The **emulator cannot decode most video**
  (no x86 decoder → frozen picture) — the **real TV is the truth** for playback/4K. 4K MUST
  play perfectly; never downscale the pick to work around the emulator.
- react-native-svg, expo-linear-gradient, MMKV (`kv`), @react-navigation/stack
  (+ `lib/navigationRef`), reanimated/gesture-handler.
- **`@blissful/core`** (`apps/shared/blissful-core`) consumed as SOURCE — the home of
  cross-platform logic. Metro watches it via `watchFolders` + an `extraNodeModules` alias; a
  `node_modules/@blissful/core` junction (created by `scripts/link-core.js`, runs on
  `postinstall` / `npm run link:core`) makes release bundling resolve it too. After editing
  core: restart Metro with `--clear`.

## Build / run / test

**One command:** `npm run dev android` from the repo root (or the Dev Launcher's Android card —
plain `npm run dev`) runs `scripts/dev-android.cjs`, which does the whole loop below: boots the
TV emulator if no device is online, starts Metro, sets `adb reverse`, and launches the app.
Stop kills Metro only — the emulator stays warm for the next start.

**The manual steps it automates (emulator + Metro + app)** — Windows/PowerShell;
`$adb` = `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`,
`$emulator` = `%LOCALAPPDATA%\Android\Sdk\emulator\emulator.exe`, package = `com.blissful.tv.rn`:

1. **Boot the TV emulator** (background): `& $emulator -avd Television_1080p -no-snapshot-save
   -gpu host`. AVDs: `Television_1080p` (use this), `Television_1080p_old`. Wait until
   `& $adb shell getprop sys.boot_completed` → `1`.
2. **Start Metro from THIS app's root** — a wrong cwd makes Expo look for `assets/package.json`
   and fail. Background: `Set-Location D:\JS\Blissful\apps\android-blissful; npx expo start
   --port 8081`. If 8081 is taken, `expo start` silently skips the dev server — free it first
   (kill the PID from `Get-NetTCPConnection -LocalPort 8081 -State Listen`). Ready when
   `http://localhost:8081/status` returns `packager-status:running`.
3. **Point the device at Metro + launch:** `& $adb reverse tcp:8081 tcp:8081` then
   `& $adb shell monkey -p com.blissful.tv.rn -c android.intent.category.LAUNCHER 1`.
4. **Redbox "Cannot find native module …"** = the installed APK is stale vs current native
   deps. Reinstall the dev build (`& $adb install -r android\app\build\outputs\apk\debug\
   app-debug.apk`; on signature clash uninstall first). From-scratch native rebuild:
   `npx expo run:android` (regenerates the gitignored `android/`).

- **Typecheck (run before trusting changes):** `npx tsc --noEmit -p tsconfig.json` from this dir.
- **Release APK:** `npm run build:release` → standalone universal `app-release.apk`
  (debug-keystore signed, cleartext-traffic patched). Tee the build log; don't rely on bg output.
- **Hot reload on the real TV:** debug APK + `adb reverse tcp:8081 tcp:8081`. Real TV = Philips
  65PUS7354 @ `192.168.1.2:5555` (adb-wifi, Android 12, armeabi-v7a); scrcpy to view.
- **Verify TV interactions by DRIVING the app:** `adb shell input keyevent <code>` then
  `screencap`/pull and read the screenshot after each step. Never claim a screen works from one
  static shot — focus/nav bugs are invisible otherwise.
- **No unit tests** in this app — verification is `tsc` + driving, per the FEATURES.md *Verify* lines.

## Hard rules (the full focus model lives in FEATURES.md)

- **Focus:** `useTvFocusable({atRowStart, autoFocus, onPress, ...})` → `{focused, focusProps}`
  spread on a `Pressable`. Native geometry handles interior D-pad moves — `nextFocus*`
  overrides ONLY at a row's LEFT EDGE (`atRowStart`). Fix focus bugs at the shared layer
  (`useTvFocusable` / `FocusTrap` / `focusBus` / `railStore` / `overlayStore` / `contentFocus`),
  never per-control. Modals get a `FocusTrap`; modals with TextInputs also make the background
  content inert.
- **Metrics:** `useMetrics()` → `m.s(px)` scales 1920-design px to dp (TV canvas ~960×540 dp
  @ density 2×).
- **Accent:** `colors.accent` is a SINGLE solid hex (default lavender `#95a2ff`) for focus
  rings, fills, progress, active icon/text. **Keep it solid** — the gradient-accent experiment
  was built and fully REVERTED; do not reintroduce it.
- Rail open/close, the `isTVSelectable` cascade, `longSelect` hold-OK, tvos Modal quirks: the
  *Cross-cutting: D-pad focus* + *NavRail* records in [`docs/FEATURES.md`](docs/FEATURES.md).

## Screens & components

`App.tsx` wires the providers (Theme > Auth > Toast > UserSocket), the stack navigator +
`navigationRef`, the global `PartyInviteListener`, `usePresenceHeartbeat`, BootSplash.
Everything else — Home (immersive), Detail, Player (+ subtitles, episodes drawer), Discover,
Library, Search, Settings, Addons, NavRail, login (a modal — there is NO LoginScreen), watch
party, friends/profiles, the shared `ui/` primitives — has a record in
[`docs/FEATURES.md`](docs/FEATURES.md); read it instead of rediscovering the component tree.

## Watch Party / Trakt / presence

Ported from the **Windows app** (NOT OpenCode — it lacks `useWatchPartyMpv`). Protocol, file
map, sync guards and open items: the *Watch Party* and *Friends, presence & profiles* records
in FEATURES.md (+ memory note `project_tv_rn_watch_party`). Trakt is INERT until creds are
filled in `lib/traktConfig.ts`.

## Conventions

- **1:1 with the windows/web app** — read the reference component + `index.css`, replicate
  exact visuals: Fraunces (headings) / Spectral (immersive-home display) / IBM Plex Sans
  (body); glass surfaces; lavender accent `#95a2ff`; brand teal `#19f7d2`; IMDb-badged cards.
- TypeScript strict, 2-space indent. No emojis in code/commits. Commit messages end with the
  `Co-Authored-By` line.
