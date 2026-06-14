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
- **Watch-party protocol** (`watch-party.protocol`, 15 tests, no browser): Layer A
  source relay (all kinds) + sanitize + snapshot + episode-clear + guards + tick +
  presence; Layer B request/decline. Live against the deployed backend.
- **Desktop shell** (`shell-*.desktop`): renderer-crash recovery, relay
  software-transcode (the GPU-crash fix — libx264 / native 4K), and leftover-stremio
  terminate+respawn.
- The `/test` runner (`e2e/run.mjs`): changed files → relevant suites.

**Roadmap (incremental):**
1. Migrate the last 2 `scripts/e2e/*.mjs`: the watch-party **behavioral** 2-client
   sync (web host + desktop guest) + the real **host-relay**. (renderer-recovery,
   software-transcode, leftover-replace, and the protocol suite are done.)
2. Remaining features: detail + streams, home + browse, addons, auth + library, social.
3. `android` fixture (adb + CDP) and `player.android`.
4. Richer player fixtures to lift the `test.fixme` scenarios (subtitles, audio
   tracks, quality, buffering, resume).

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
