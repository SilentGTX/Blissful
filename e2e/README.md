# Blissful E2E tester

Project-wide end-to-end tests on [Playwright Test](https://playwright.dev). The goal:
**call one command after a change and run that feature's full scenario set**, across
every platform Blissful ships.

Runner config: [`/playwright.config.ts`](../playwright.config.ts). Artifacts (reports,
traces, shell logs, media) go to `.tmp-e2e/` (gitignored).

## Run it

```bash
npm run test:e2e            # everything
npm run test:e2e:web       # web project only (fast)
npm run test:e2e:desktop   # desktop project only (launches the real Rust shell)
npm run test:e2e:android   # android project (skips unless a device/emulator is attached)
npm run test:e2e:report    # open the last HTML report

npx playwright test --project web e2e/suites/player.web.spec.ts   # one suite
npx playwright test -g "renderer crash"                           # by title
```

Prereqs: `npm install` (root — pulls `@playwright/test`, `playwright`, `ws`) and once
`npx playwright install chromium`. Desktop needs the Rust toolchain + `libmpv-2.dll`.

## Platforms = Playwright "projects"

| Project | Drives | Fixture | Notes |
|---|---|---|---|
| `web` | the dev UI (vite `:5173`) via Playwright chromium | built-in `page` | `webServer` starts/reuses vite |
| `desktop` | the **real Rust shell** over a CDP debug port | [`fixtures/desktop.ts`](fixtures/desktop.ts) → `desktop` | no Playwright browser; shell points at the dev UI |
| `android` | the TV app over `adb` + CDP on its WebView | `fixtures/android.ts` (planned) | auto-skips when no device attached |

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

**Foundation (done + green):** Playwright Test wired; `web` smoke + `desktop`
renderer-recovery both pass — the shell-over-CDP fixture is proven.

**Roadmap (incremental):**
1. Migrate the legacy `scripts/e2e/*.mjs` harnesses into suites/fixtures (watch-party
   behavioral + protocol; the `verify-*` shell tests).
2. **Player suite** (web → desktop → android) — first priority: playback start,
   subtitles, audio tracks, seek, quality, buffering, resume.
3. Remaining features: detail + streams, home + browse, addons, auth + library, social.
4. `android` fixture (adb + CDP) and the Player android suite.
5. A "run only suites relevant to changed files" mode (git diff → suite map) + a `/test`
   skill, so a change auto-runs its scenarios.

## Gotchas baked into the fixtures (learned the hard way)

- Spawn the shell with `shell:false` (`process.execPath` has a space in "Program Files").
- **Free the binary first** — a running `blissful-shell.exe` locks it (build OS error 5);
  the desktop fixture taskkills it before launching.
- Fixtures are transpiled to **CommonJS** — no `import.meta`; use `process.cwd()`.
- After a renderer crash the prior `Page` stays "crashed" — reconnect **fresh** to probe
  for recovery, and don't `close()` a `connectOverCDP` browser (it disturbs the WebView).
- For watch-party media use **WebM over local http** (Chromium has no H.264/AAC; the
  player's DMCA fallback is https-only) and seed `localStorage` guestName.
