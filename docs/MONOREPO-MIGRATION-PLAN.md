# Monorepo Migration Plan

**Goal:** `D:\JS\Blissful` becomes the single monorepo for all of Blissful — the web app, the
Windows desktop app, and the Android TV app — with **one** React UI codebase shared by web and
desktop. When the web UI gets a feature, the next desktop release ships it automatically; the
only deliberate platform difference is the player (native libmpv on desktop, `<video>`/HLS on
web) and the stream-resolution pipeline behind it.

**Standing constraint (Ivan, 2026-06-11): nothing Android-related is touched. Ever.**
That covers, concretely:
- the `react-native-blissful` branch (never merged into main, never rebased/cherry-picked onto,
  never modified),
- the old `android-tv` branch (not deleted, not modified),
- the untracked Android working-tree dirs on disk (`apps/android-blissful/`,
  `apps/blissful-tv-shell/`, `tools/`, `.tmp-shots/`) — never staged, committed, edited, or
  cleaned,
- `apps/shared/blissful-core` (lives on the RN branch; no parallel copy is created on main).

Operational discipline that enforces this: **migration commits stage explicit paths only —
never `git add -A` / `git add .` from the repo root** — so the untracked Android dirs can never
sneak into a main commit. Where main wants knowledge from the RN branch (the PWA Vite config,
`PlayerPageLazy`), it is read with `git show react-native-blissful:<path>` (read-only, cannot
modify anything) and adapted into main's own files by hand.

"The monorepo contains the Android app" = it lives in this repo, on its own branch, evolving
independently.

**UI delivery: THIN SHELL (decided by Ivan, 2026-06-11, implemented in `34527b1`).** Release
builds of the desktop shell load the UI live from `https://blissful.budinoff.com` — a web
deploy updates every install instantly; desktop releases are only needed for Rust shell
changes. Specifics:
- Dev builds keep the local server (`npm run dev` hot-reload / `cargo run` serves dist);
  `BLISSFUL_UI_URL` overrides either mode.
- Navigation pinning allows exactly two document origins: the local server and the configured
  UI origin. The JS shim exposes `localServerBase` so loopback-only routes (`/resolve-url`,
  `/addon-proxy` wraps of the local stremio-service) still hit this machine's shell from the
  remote origin.
- Failure safety: remote navigation failure falls back once to the bundled UI; the deployed
  PWA's service worker absorbs short outages after first visit. (Accepted trade-off: the Mac
  backend is required for functionality anyway.)
- **Version-skew rule:** the deployed UI must tolerate older installed shells — IPC changes
  must be additive and feature-detected (`shellOrigin()` falls back to same-origin on old
  shells).
- **ACTIVATION GATE: do not tag a desktop release until the Mac serves THIS repo's unified
  build** — OpenCode's current web bundle has no native-shell support; installed shells
  pointing at it would lose mpv playback.

---

## 1. Current state (measured 2026-06-11)

There are **three divergent copies** of `blissful-mvs` and they must converge into one:

| Copy | Where | What it is |
|---|---|---|
| Desktop | `main` @ `apps/web-blissful` | Production Windows UI. NativeMpvPlayer + SimplePlayer fallback. Includes v0.1.6 work + the (uncommitted) 2026-06-11 watch-party port. |
| Multi-target | branch `react-native-blissful` @ `apps/web-blissful` | Desktop UI + PWA (web) + Tauri TV-WebView targets, gated by `TAURI_ENV_PLATFORM`; consumes `apps/shared/blissful-core` via Vite alias; has `PlayerPageLazy`. 113 commits ahead of main, +18.9k lines in the UI. No OpenCode web player. **Stays on its branch — NOT merged; useful scaffolding is lifted per-file only.** |
| Web | `D:\JS\OpenCode` @ `apps/web-blissful` (HEAD `15ce2f0a`) | Most feature-advanced. `BlissfulPlayer` (`<video>`/HLS/RD/Vidking) + resolve pipeline, `components/base/` design system, mini-player/PiP, latest watch-party hardening. **Zero native-shell code** (fully scrubbed). |

Other measured facts that shape the plan:

- **Dependencies are already aligned**: the only `package.json` dep delta between desktop and
  OpenCode is `concurrently` (desktop devDep). No dependency migration needed.
- **main ↔ OpenCode drift**: ~126 shared files differ, ~52 identical. Biggest shared divergers:
  `PlayerPage` (1445 lines churn), `index.css` (515), `DiscoverPage` (441), `DetailPage` (427),
  `SideNav/DesktopNav` (347), `AppShell` (320). Since the RN branch stays unmerged, this audit
  is current — the convergence is purely main ↔ OpenCode.
- **Web deployment today**: Mac `docker-compose.yml` in OpenCode; the `blissful` service is just
  `serve -s dist` over a volume-mounted `apps/web-blissful/dist`, behind `blissful.budinoff.com`.
  Cutover is "point the volume at this repo's dist".
- **Auth divergence**: OpenCode dropped `lib/stremioApi.ts` (web is Blissful-account-first with
  optional Stremio link via `StremioLinkPopupPage`); desktop keeps full Stremio accounts
  (`AccountsPage`, `savedAccounts`). The unified app keeps both, platform-gated. Audit item.
- **Addon-usage divergence**: home addon rows are parity (`useAddonRows` differs by 1 line;
  both sides build rows from ALL installed addons — Anime Kitsu, Torrentio RD, YouTube, ...).
  **Search is not**: desktop's `SearchPage` queries every installed addon's search-capable
  catalogs (`shouldShowCatalogForSearch` on `extraSupported`) and renders per-addon result
  rows; OpenCode's `SearchPage` is hardcoded Cinemeta-only (Movies/Series/Anime split).
  Desktop also has a dedicated `AddonsPage`; OpenCode manages addons via `useAddonsManager`.

## 2. End-state layout

```
main branch (this migration's scope):
  apps/
    blissful-mvs/      # THE UI - one codebase, two build targets:
                       #   desktop (served by blissful-shell, NativeMpvPlayer)
                       #   web     (PWA, BlissfulPlayer, deployed to budinoff.com)
    blissful-shell/    # Rust Windows shell (unchanged role; serves the desktop build)
  docs/
    MONOREPO-MIGRATION-PLAN.md   # this file

react-native-blissful branch (deliberately unmerged - the Android TV line; NOT touched):
  apps/android-blissful/      # native Android TV app (own RN UI)
  apps/blissful-tv-shell/   # legacy Tauri TV WebView shell
  apps/shared/blissful-core/   # shared pure-TS consumed by the TV app
  docs/RN-MIGRATION-PLAN.md
```

Backend services (`blissful-storage`, `addon-proxy`, resolver/transcoder infra) stay in
OpenCode through Phase 4; Phase 5 (optional, recommended) moves them here and archives OpenCode.

## 3. The platform boundary

Everything is shared except modules behind `src/lib/platform.ts` (already exists on main) +
runtime `isNativeShell()` gating. The boundary contract:

| Concern | Desktop impl | Web impl |
|---|---|---|
| Player component | `NativeMpvPlayer` (libmpv via shell IPC) | `BlissfulPlayer` (`<video>`/HLS) |
| Stream resolution | stremio-service torrent URLs (`127.0.0.1:11470`) | RD/Vidking/Videasy resolve via addon-proxy |
| Watch-party hook | `useWatchPartyMpv` | `useWatchParty` |
| Net layer | same-origin shell proxy (`/storage/*`, `/addon-proxy`) | direct service URLs (`VITE_STORAGE_URL`) |
| Shell bridge | `lib/desktop.ts` (`window.blissfulDesktop`) | absent |
| Updater | `useDesktopUpdater` | PWA `autoUpdate` |
| Accounts | Stremio login + `savedAccounts` + Blissful auth | Blissful auth + Stremio link popup |
| Chapter skip | mpv chapters + `aniskip`/`introdb` | `useChapterSkipWeb` |
| PiP / mini player | n/a | `MiniPlayerWindow` + `documentPip` |

Players load as **lazy chunks** (`PlayerPageLazy` pattern — read the RN branch's file via
`git show` as reference, write main's own) so web users never download mpv-player code and
vice versa.

Discipline rule (the thing that keeps this from regressing): a web-only API is never imported
from shared code directly — always through the platform module or behind a capability check.
`tsc -b` + a desktop boot is the gate for every UI change.

## 4. Phases

### Phase 0 — Baseline (trivial)

1. Commit the pending 2026-06-11 watch-party port on `main` (6 files, validated: tsc clean,
   tests 9/9).
2. Re-snapshot the OpenCode convergence baseline SHA (was `15ce2f0a` at planning time).
3. **No branch operations, nothing Android touched** (see the standing constraint up top).
   Anything main needs from the RN branch later is read via `git show` (read-only) and adapted
   into main's own files.

**Gate:** `tsc -b` + vitest green on main after the port commit (already verified).

### Phase 1 — Absorb OpenCode's web delta (the bulk; iterative, days)

Baseline: OpenCode `15ce2f0a` (re-snapshot at execution time; OpenCode keeps moving).

**Progress (2026-06-11):** Phase 0 done (`6923e22` port, `c873993` plan). Steps 1–5 done:
additive libs (`72e6c4f`), `base/` (`2fdf442`), BlissfulPlayer suite (`264447c`), lib
foundation (`2fd7284`), 64-file bulk + detail cluster (`cc39878`), wiring layer — App routes /
AppShell / SideNav (`5a9e55e`), pages + index.css (`4c576cc`). tsc + vitest + vite build +
cargo test green throughout. **Desktop-ahead reversals applied as planned:** HomePage +
homeRows (addon rows — OpenCode's web home went curated-only), DiscoverPage, SearchPage,
useContinueWatchingActions, stremioAddon, storageBaseUrl. Platform branches:
watchPartyWsUrl/UserSocketProvider WS, buildRoomPlayerUrl, /player route (PlayerPage vs
PlayerSeeder), PersistentPlayerHost (web-only), unreleased-episode block (web-only), Vidking
play CTA (web-only), imageProxy (desktop no-op). New shell route: `/imdb-rating` forward.

Remaining in Phase 1: **manual desktop pass** (the look changed — base/ components +
OpenCode's index.css landed; verify home rows, jujutsu-kaisen search test, detail, playback,
watch party), auth audit step 6 (stremioApi/AccountsPage surface), then Phase 2 (PlayerPage
unification — kept-ours desktop PlayerPage + web's persistent-player model merge).

1. Refresh the divergence audit against OpenCode's then-current HEAD:
   `git diff --no-index --numstat apps/web-blissful/src ../OpenCode/apps/web-blissful/src`.
2. ~~Web-target scaffolding~~ **OBSOLETE** — discovered during execution: main's vite config
   already ships `vite-plugin-pwa` (the build emits `dist/sw.js` + a 36-entry precache), so
   the web build target already exists. `PlayerPageLazy` remains a Phase 2 nicety.
3. **Additive imports first** (new files, no conflicts): `components/BlissfulPlayer/`,
   `components/base/`, `MiniPlayerWindow` + `PersistentPlayerHost` + `MiniPlayerProvider`,
   `ReleasesPicker`, web libs (`playerServers`, `playerAudioTracks`, `probeMkvCodecs`,
   `browserCodecSupport`, `fallbackReleases`, `documentPip`, `subtitleUtils`, `imageProxy`),
   `VidkingPlayerPage`, `StremioLinkPopupPage`, `useChapterSkipWeb`.
4. **Shared-file convergence**, batched by area (lib → context → components → pages). Default
   direction per file: take OpenCode's version (it leads on UI/features), re-insert the
   platform gates ours carries (find them: grep our copy for `isNativeShell|desktop\.|platform`).
   Suits a lean agent fan-out — batches of ~10 files, low tens of agents total, `tsc -b` green
   per batch.

   **Desktop-ahead inventory — convergence direction REVERSES for these (the feature superset
   must survive; the Phase 1 gate tests them):**
   - `pages/SearchPage.tsx` — desktop searches EVERY installed addon's search-capable catalogs
     and renders per-addon rows ("Popular Series", "Anime Kitsu", ...); OpenCode is
     Cinemeta-only. Unified page = desktop's multi-addon search engine + OpenCode's
     presentation. Multi-addon search benefits the web build too — this is an upgrade for web,
     not a desktop-only gate.
   - `pages/AddonsPage.tsx` — desktop's dedicated addon-management page stays; reconcile with
     OpenCode's `useAddonsManager` flow in the audit (both can coexist).
   - Stremio accounts (`AccountsPage`, `savedAccounts`, `lib/stremioApi.ts`) — see auth audit.
   - Home addon rows need NO special handling — measured parity (1-line drift in
     `useAddonRows`); just converge normally.
5. Visual identity lands here: desktop adopts OpenCode's current design (`base/` components,
   its `index.css`). **This is intended** — web drives the look from now on — but expect the
   desktop app to visibly change.
6. ~~Auth audit~~ **DONE 2026-06-11.** Findings: `AuthProvider` is a Blissful-JWT compat layer
   (both repos identical) — desktop and web share Blissful-first auth. `savedAccounts` remains
   functional (feeds `useTorrentioCloneSync`). `useUserSession` was pre-Blissful dead code
   (no callers even before convergence) — deleted. `AccountsPage`/`/accounts` was ALREADY
   orphaned on main pre-convergence (route exists, no UI links to it) — kept as-is, candidate
   for future removal (Ivan's call). Stremio-link popup on desktop: the Facebook path works
   (opener polls Stremio server-side with a state token, so the external-browser popup is
   fine); the email/password fallback path relies on `window.opener.postMessage`, which can't
   cross from the external browser into the shell — known limitation, low priority since the
   FB path + linked-state polling cover the sync use case.

**Gate:** `tsc -b` + vitest green; desktop full manual pass (browse, detail, play, subtitles,
watch party); web build renders and plays in a plain browser. Addon acceptance tests: home
shows rows for every installed addon (Anime Kitsu, Torrentio RD, YouTube, ...); searching
"jujutsu kaisen" returns BOTH a Popular Series row and an Anime Kitsu row.

### Phase 2 — PlayerPage unification — **DONE 2026-06-11 (`1d91ef3`)**

Shipped shape: the /player route dispatches by platform (`PlayerPage` = desktop,
route-mounted, NativeMpvPlayer eager — preserves the no-Suspense-flash decision;
`PlayerSeeder` + `PersistentPlayerHost` → `pages/PlayerPageWeb.tsx` = OpenCode's web player
verbatim, its own 650 KB lazy chunk web-only). `SimplePlayer` deleted (2,857 lines).
This also FIXED a live regression: since the cutover, the deployed site's persistent host had
been importing the desktop PlayerPage (renders null outside the shell) — web playback was
broken until this landed + deployed. Remaining nicety (optional): desktop's eager player is
in the shared main bundle, so web downloads ~unused native-player code — acceptable; revisit
with a PlayerPageLazy-style split if bundle size starts to matter.

**Gate (playback matrix):**
- Desktop: 4K HEVC torrent, embedded + addon subs, skip-intro, watch party host + guest,
  episode switch, resume.
- Web: RD stream + Vidking fallback, watch party, mini player, rotate/mobile.

### Phase 3 — Deploy cutover

1. ~~Web cutover~~ **DONE 2026-06-11**: `~/home-lab/Blissful` cloned on the Mac, unified UI
   built there, compose `blissful` volume repointed at its dist (backup:
   `docker-compose.yml.bak-thinshell`). blissful.budinoff.com serves the unified bundle;
   storage + proxy containers restarted on current code (gate/subs handlers + /imdb-rating
   verified live). **Deploy flow now:** ssh Mac → `git pull` + `npm run build` in
   `~/home-lab/Blissful/apps/web-blissful` — live instantly, no restart.
2. ~~Verification~~ **DONE**: desktop shell launched with
   `BLISSFUL_UI_URL=https://blissful.budinoff.com` — navigation pinned+allowed, bridge alive,
   desktop personality rendered from the live site.
3. **REMAINING — Desktop release tag** (Ivan's call): gated on his visual pass + ideally
   Phase 2. `release.yml` needs zero changes. From that release on, installs load the deployed
   UI (thin shell); subsequent UI changes need web deploys only.
4. **REMAINING — Freeze OpenCode's `apps/web-blissful`**: README pointer "UI moved to
   Blissful". All UI work happens in Blissful now; OpenCode is backend-services-only.
   (De facto already true — the deployed site no longer builds from OpenCode.)

### Phase 4 — Shared core growth (DEFERRED)

`apps/shared/blissful-core` lives on the `react-native-blissful` branch (consumed by the TV app),
and that branch stays unmerged — creating a parallel `blissful-core` on main would just
manufacture new drift. So protocol definitions (watch-party wire types, storage API client
types) stay in `blissful-mvs/src/lib` for now. This phase activates only if/when the TV-branch
strategy changes (Ivan's call). Until then, watch-party protocol changes are coordinated
manually across main, the RN branch, and the storage server.

### Phase 5 — Backend services move — **DONE 2026-06-11 (`ff8248b` / OpenCode `eaadcc8f`)**

Moved here: `apps/shared/blissful-storage`, `apps/shared/addon-proxy`, blissful infra scripts + launchd
plists (transcoder, videasy resolver/minter, backup, cache-cleanup, health-monitor, nas
tools, mac-up), stremio-dev compose, and a root `docker-compose.yml` carrying the 5 blissful
services (identical container names/ports/NAS binds — all state is NAS bind-mounted, so the
project move touched no data). The Mac runs the stack from `~/home-lab/Blissful` (compose
project `blissful`); launchd agents repointed + reloaded (transcoder 13098, resolver 13099
verified). Secrets: `~/home-lab/Blissful/.env` (subset carved from OpenCode's).

Stayed in OpenCode (per Ivan's scope): `discord-bot`, `mac-monitor`, `monitor`, nextcloud,
the shared Traefik proxy + ALL its dynamic configs (including `blissful.yml` — routing config
for the shared proxy), machine-level launchd, MCP/auth scripts. OpenCode's compose now
carries only `discord-bot`; its README points here; `apps/web-blissful` there is frozen
history. Protocol changes are now single-repo: client types + server handlers in one commit.

## 5. Risks

- **RN-branch drift (accepted)**: `react-native-blissful` stays unmerged and carries its own
  `blissful-mvs` evolution (~119 files). As main's UI converges with OpenCode, that branch
  drifts further and an eventual merge (if ever wanted) gets harder over time. Accepted
  trade-off per Ivan (2026-06-11); low practical impact — the TV-RN app has its own native UI
  and does not consume main's `blissful-mvs` builds.
- **Losing desktop fixes during Phase 1 convergence**: a shared file taken from OpenCode might
  drop a desktop-only fix made on main. Mitigation: per-file `git log main -- <file>` check for
  desktop-only commits before overwriting; the audit classifies, a human (or verifying agent)
  reviews the platform-gated files.
- **Web-only services leaking into desktop UI**: RD house key, videasy resolver, transcoder
  endpoints don't exist for desktop. Mitigation: capability flags in the platform module; any
  dead-end UI is a Phase 1/2 bug class to test for.
- **Two-target build matrix**: every UI change can now break web or desktop.
  Mitigation: `tsc -b` covers both (one codebase); CI builds desktop; web build is the same
  artifact.

## 6. Decision points (owner: Ivan)

1. **Backend services** — move into this repo (Phase 5) or stay in OpenCode permanently?
   *Recommendation: move, after the UI unification proves out.*
2. **TV-branch strategy, long-term** — settled for now: everything Android stays on its
   branches, untouched (standing constraint up top). Whether that ever changes is entirely
   Ivan's call; nothing in this plan depends on it (only the deferred Phase 4 would benefit).

## 7. Working rules after migration

- Nothing Android is touched — see the standing constraint. Stage explicit paths only
  (never `git add -A` from the repo root) so the untracked Android dirs never enter a
  main commit.
- One UI codebase. Never fork a file per platform — gate inside it or split behind
  `lib/platform`.
- OpenCode is no longer a porting source for UI; "check OpenCode first" applies only to backend
  services until Phase 5 retires that too.
- Protocol changes (watch-party, storage) land types in `blissful-core` + handlers in the
  storage server in the same change set.
- Desktop releases = UI snapshots; tag whenever web has accumulated features worth shipping.

---
*Authored 2026-06-11; revised same day — `react-native-blissful` stays unmerged (Ivan).
Baselines: main @ 5972ff6 (+uncommitted watch-party port), react-native-blissful @ bac10cf
(reference only), OpenCode @ 15ce2f0a.*
