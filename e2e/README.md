# Blissful E2E tester

Project-wide end-to-end tests on [Playwright Test](https://playwright.dev). The goal:
**call one command after a change and run that feature's full scenario set**, across
every platform Blissful ships.

Runner config: [`/playwright.config.ts`](../playwright.config.ts). Artifacts (reports,
traces, shell logs, media) go to `.tmp-e2e/` (gitignored).

## Run it

```bash
npm run test:e2e:changed       # ONLY suites relevant to what you changed (git diff -> areas)
npm run test:e2e:area player   # a named area: player | watch-party | shell
npm run test:e2e               # everything
npm run test:e2e:web           # web project only (fast)
npm run test:e2e:desktop       # desktop project only (launches the real Rust shell)
npm run test:e2e:android       # android project (skips unless a device/emulator is attached)
npm run test:e2e:report        # open the last HTML report

# direct: filename filter FIRST, then --project (a path after --project is read as a project)
npx playwright test player.web --project web
npx playwright test -g "renderer crash"
node e2e/run.mjs --changed -- --project web   # runner + passthrough args after --
```

There's also a local **`/test`** skill (in `.claude/`, gitignored) that wraps `e2e/run.mjs`
— "call it after a change and it runs that feature's suites."

Prereqs: `npm install` (root — pulls `@playwright/test`, `playwright`, `ws`) and once
`npx playwright install chromium`. Desktop needs the Rust toolchain + `libmpv-2.dll`.

## Platforms = Playwright "projects"

| Project | Drives | Fixture | Notes |
|---|---|---|---|
| `web` | the dev UI (vite `:5173`) via Playwright chromium | built-in `page` | `webServer` starts/reuses vite |
| `desktop` | the **real Rust shell** over a CDP debug port | [`fixtures/desktop.ts`](fixtures/desktop.ts) → `desktop` | no Playwright browser; shell points at the dev UI |
| `android` | the TV app over `adb` + CDP on its WebView | `fixtures/android.ts` (planned) | auto-skips when no device attached |
| `protocol` | raw `ws`/`http` against the deployed backend | (none) | no browser/shell; live wire-protocol + endpoint tests |

Suites are named `*.<platform>.spec.ts` so `--project <platform>` selects them.

## Layout

```
playwright.config.ts          projects, webServer, reporters
e2e/
  fixtures/   desktop.ts (shell+CDP)  •  web/android/backend/media (growing)
  suites/     <feature>.<platform>.spec.ts
  README.md   this file
```

## Status

**Done + green:**
- Foundation: Playwright Test wired; `web` smoke + `desktop` renderer-recovery
  (shell-over-CDP fixture proven).
- **Player** on both Playwright-drivable platforms: `player.web` (real `<video>`)
  and `player.desktop` (mpv) — loads+plays, pause/resume, seek. The reference suite.
- **Watch party**: `watch-party.sync.desktop` (the behavioral crown jewel — a WEB
  host + DESKTOP-mpv guest in one room; the guest follows play/pause/resume),
  `watch-party.protocol` (15, no browser — Layer A/B wire protocol),
  `watch-party.host-relay.desktop` (real Layer-B tunnel → key-rewritten HLS via the Mac).
- **Desktop shell** (`shell-*.desktop`): renderer-crash recovery, relay
  software-transcode (the GPU-crash fix — libx264 / native 4K), and leftover-stremio
  terminate+respawn.
- **Feature pages (web)**: `detail` (meta + episode list + Play), `home` (hero +
  rails + search + discover), `addons` (page + add-modal + **real install/uninstall**),
  `auth` (login/register form + logged-out CTA + **logged-in library**), `social`
  (logged-out gating + **logged-in friends accordion**). Auth-gated features are
  tested for REAL via throwaway **Blissful** accounts (`e2e/fixtures/auth.ts` —
  Blissful's own auth, NOT Stremio).
- **Social (real, two accounts)** `social.protocol`: friend request → accept →
  both friends, + friend-gated presence lookup. Over the live backend, no mocks.
- **Social over `/ws/user`** `social-ws.protocol`: two authed accounts on the
  live push socket — the socket IS the online signal (online + activity flip
  with it), and the party-invite request→accept handshake is pushed live (the
  room code B receives over its socket is the room A created). + offline-friend
  invite → 409. The WS layer the REST suite couldn't reach.
- **Android TV** (`smoke.android`): the RN app boots on the emulator — its activity
  is foreground + the process is alive, over `adb` (no DOM/CDP). Auto-skips with no
  device. Playback (the emulator can't decode video) + deep UI (needs an adb-keyevent
  harness on a real TV) are out of scope.
- The `/test` runner (`e2e/run.mjs`): changed files → relevant suites.

**Roadmap (incremental):**
1. ✅ All legacy `scripts/e2e/*.mjs` harnesses migrated (player, watch-party
   behavioral + protocol + host-relay, the shell `verify-*` trio).
2. ✅ Feature suites: detail+streams, home+browse, addons, auth+library, social
   (structure; auth-gated / second-user / live-content scenarios are `test.fixme`).
3. ✅ `android` boot smoke (the RN app launches on the emulator over adb). Deeper
   android (navigation/playback) needs the REAL TV (emulator has no video decoder) +
   an adb-keyevent + screencap harness.
4. ✅ Auth-gated features tested for REAL via throwaway Blissful accounts (login,
   logged-in library, two-account friend flow + presence lookup, addon
   install/uninstall) + ✅ player resume + ✅ player audio-tracks + subtitles
   (`player-tracks.desktop`, generated 2-audio/1-sub MKV) + ✅ player buffering
   (stalling server) + ✅ android boot smoke + ✅ the live `/ws/user` push layer
   (`social-ws.protocol` — online/activity signal + party-invite request→accept
   over two authed sockets). Only 2 `test.fixme` remain, each with a hard
   external blocker:
   - player **quality** switch → a multi-variant HLS that hls.js + Playwright's
     codec-free Chromium can decode (VP9 fMP4 — H.264/HLS is codec-blocked);
   - deeper android (navigation/playback) → the real TV (emulator has no video
     decoder) + an adb-keyevent + screencap harness.

## Gotchas baked into the fixtures (learned the hard way)

- Spawn the shell with `shell:false` (`process.execPath` has a space in "Program Files").
- **Free the binary first** — a running `blissful-shell.exe` locks it (build OS error 5);
  the desktop fixture taskkills it before launching.
- Fixtures are transpiled to **CommonJS** — no `import.meta`; use `process.cwd()`.
- After a renderer crash the prior `Page` stays "crashed" — reconnect **fresh** to probe
  for recovery, and don't `close()` a `connectOverCDP` browser (it disturbs the WebView).
- For media use **WebM over local http** (`fixtures/media.ts` — Chromium has no H.264/AAC;
  the player's DMCA fallback is https-only). `rdsel=1` plays a `url` directly (no Videasy /
  fallback / stream picker).
- The **desktop player is mpv, not `<video>`** — read playback state from `mpv-prop-change`
  events (`window.blissfulDesktop.on('mpv-prop-change', ...)`; the shim supports multiple
  listeners). `pause` only fires on CHANGE, so assert "playing" via `time-pos` advancing.
  The player can sit paused on frame 0 in the harness (loadfile/play race) — nudge
  `call('play')` until it advances.
- Combine fixtures with `mergeTests(desktopTest, mediaTest)` (Playwright's fixture merge).
- Run a single suite with the **filename filter FIRST**: `playwright test player.desktop
  --project desktop` (a path after `--project` is parsed as a project name).
