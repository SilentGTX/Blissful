# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**Blissful** — the Blissful monorepo: a Stremio client shipped as three variants (web, Windows
desktop, Android TV) plus the backend that serves them all. Web + desktop share ONE React
codebase; the desktop is a thin Rust shell around it; Android TV is a separate React Native app.

**Each variant has its own `DOCUMENTATION.md` — read the relevant one BEFORE working in that
app. This file holds only repo-global facts.**

| Folder | What it is | Docs |
|---|---|---|
| `apps/web-blissful/` | THE React UI — one codebase, two personalities via `isNativeShell()`: web (`blissful.budinoff.com`) and the desktop shell's UI (thin shell) | [DOCUMENTATION.md](apps/web-blissful/DOCUMENTATION.md) |
| `apps/desktop-blissful/` | Rust native Windows shell — WebView2 + in-process libmpv, local proxy server, auto-updater, WiX installer, releases | [DOCUMENTATION.md](apps/desktop-blissful/DOCUMENTATION.md) |
| `apps/android-blissful/` | React Native (react-native-tvos) Android TV app | [DOCUMENTATION.md](apps/android-blissful/DOCUMENTATION.md) + per-feature registry [docs/FEATURES.md](apps/android-blissful/docs/FEATURES.md) |
| `apps/shared/` | `blissful-storage` (backend), `addon-proxy` (server-side proxy), `blissful-core` (`@blissful/core`, shared pure TS) | [DOCUMENTATION.md](apps/shared/DOCUMENTATION.md) |

Untracked working dirs you may see on disk (`apps/blissful-tv-shell` — the superseded Tauri TV
shell, `apps/stremio-custom`, `tools/`, `.tmp-shots/`, a leftover `apps/blissful-tv-rn` husk
with generated `android/`): not part of main; never stage them (`git add` explicit paths only).

## Quickstart (detail in each DOCUMENTATION.md)

```powershell
npm run dev                                       # opens the Dev Launcher GUI (start/stop web / desktop / android); CLI bypass: npm run dev desktop
npm --prefix apps\web-blissful run dev            # web UI on :5173 (+ desktop shell)
cd apps\desktop-blissful; cargo run --features spike0a   # desktop shell alone
cd apps\android-blissful; npx expo start --port 8081     # Android TV (Metro; see its docs)
```

- Web/desktop UI typecheck: `npx --prefix apps\web-blissful tsc -b` (build mode, NOT `--noEmit`).
- Android typecheck: `npx tsc --noEmit -p tsconfig.json` from `apps/android-blissful`.

## Reference apps & terminology (READ FIRST when porting)

When the user says "match/port/copy from the X app", these are the canonical sources of truth.
Read their code and replicate behaviour/visuals exactly — never invent generic UI.

- **"Windows app" / "desktop app"** → `apps/web-blissful` (the React UI) **and**
  `apps/desktop-blissful` (the Rust shell). The production reference for feature parity —
  playback, watch party, player UX. Watch-party logic lives in
  `apps/web-blissful/src/lib/useWatchPartyMpv.ts` + `lib/watchParty.ts` +
  `components/WatchParty/*`, NOT in OpenCode.
- **"Web version"** → `D:\JS\OpenCode\apps\blissful-mvs` (the pre-migration fork, checked out
  locally) — historical reference only since the monorepo migration.

## Branches & deploy model

- **`main`** — everything: web/desktop UI, desktop shell, Android app, shared services. Release
  tags are cut here; the web deploy and backend deploy run from here (on the Mac via
  `infra/scripts/blissful-web-deploy.sh` and the root `docker-compose.yml` — see
  [apps/shared/DOCUMENTATION.md](apps/shared/DOCUMENTATION.md)).
- **`react-native-blissful`** — the RN app's original development line. Its
  `apps/blissful-tv-rn` + `packages/blissful-core` were merged onto main 2026-06-12 (now at
  `apps/android-blissful` + `apps/shared/blissful-core`); the branch still holds a deferred
  `blissful-mvs` core-extraction refactor not yet on main.
- **`android-tv`** — the frozen, superseded Tauri TV effort.
- **UI changes ship via web deploy** (no desktop release — thin shell); **shell changes ship
  via tagged releases**; backend/proxy ship via compose on the Mac.

## Code style (repo-global)

- **TypeScript:** `strict: true`, 2-space indent, ES6 imports, `catch (err: unknown)` then narrow.
- **Rust:** standard `rustfmt`, `cargo clippy` clean. Tracing for logs (no `println!`).
- **Naming:** camelCase vars/functions, PascalCase components, UPPER_SNAKE_CASE constants.
- **Blissful styling:** glass surfaces, large corners, brand `--bliss-teal: #19f7d2`, fonts
  Fraunces (headings) + IBM Plex Sans (body); the Android app adds Spectral + lavender accent.
- **No emojis in code or commit messages.** Commit messages end with the `Co-Authored-By` line.
- When you add behaviour that could be a regression magnet (security validation, semver, URL
  normalisation), add a unit test next to the code.

## Licensing

Source is **MIT** ([LICENSE](LICENSE)); the shipped desktop installer bundles LGPL libmpv —
details in [apps/desktop-blissful/DOCUMENTATION.md](apps/desktop-blissful/DOCUMENTATION.md) and
the root [README](README.md).

## Local vision LLM (home-lab Mac)

An **Ollama** server runs on the M4 Mac mini home-lab (`192.168.1.11` — the same box as the
web/backend deploy), serving **`qwen2.5vl:7b`** for reading images (OCR, screenshots, documents,
sticker/album pages). Localhost-only on `:11434`; loads on demand and auto-unloads, so idle cost
is ~zero. When the user says "the local model / local LLM / local vision model" or asks to "read
this image," **this is it** — feed it the image via `ollama run qwen2.5vl:7b "read this: /path"`
or the HTTP API (`POST :11434/api/generate` with base64 `images`). Setup, RAM notes, and lighter
alternatives:
`C:\Users\origi\.claude\projects\D--JS-Blissful\memory\project_homelab_local_vision_llm.md`.

## Vidking/Videasy source pipeline (web player)

The web player's stream-source resolver. `/videasy-sources` (addon-proxy) fetches an encrypted
payload **in-process** from `api.speedracelight.com` via a two-step seed flow (`GET /seed` →
`GET /<provider>/sources-with-title?enc=2&seed=…`) and XOR-decrypts it with `videasy-decrypt-v2.js`
— ~250-520 ms, no browser, no token. A headed-Chrome fallback on the Mac
(`infra/scripts/videasy-resolver.py`, kept cold) covers response-cipher rotation only; Real-Debrid
(`/rd-fallback`) is the final fallback. NOTE: the segment CDNs 403 any request carrying an `Origin`
header, so the `vd=1` proxy path sends the Vidking Referer spoof but NO Origin. Anatomy, the moved-domain
history, and outside-in diagnosis: [apps/shared/DOCUMENTATION.md](apps/shared/DOCUMENTATION.md)
§Videasy/Vidking + the memory note `project_vidking_videasy_pipeline`.

## Key references

- [.github/workflows/release.yml](.github/workflows/release.yml) — desktop CI release pipeline.
- [docs/MONOREPO-MIGRATION-PLAN.md](docs/MONOREPO-MIGRATION-PLAN.md) +
  [docs/RN-MIGRATION-PLAN.md](docs/RN-MIGRATION-PLAN.md) — historical migration plans.
- Per-session feedback / project state lives under
  `C:\Users\origi\.claude\projects\D--JS-Blissful\memory\` (consult `MEMORY.md` there).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
