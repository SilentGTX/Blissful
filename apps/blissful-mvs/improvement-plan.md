# Blissful MVS — Improvement Plan

## Review Decisions (from interactive review)

Decisions captured during plan review to guide implementation:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Scope** | Full plan execution (all items) | Ship features alongside cleanups |
| **Testing strategy** | Type checking (`npx tsc --noEmit`) | No test infrastructure; type safety is the primary gate |
| **React version** | Acknowledge React 19 (`^19.2.0`), update docs | AGENTS.md incorrectly says React 18 |
| **State architecture** | Context providers (as planned) | Stay within React primitives, no new deps |
| **Cache strategy** | Cap + sweep at 200 entries | Simple, minimal code change |
| **AbortController pattern** | Signal threading (explicit, per-function) | Standard pattern, no abstraction layer |
| **PWA caching** | Full network-first | Accept stale data offline |
| **Auto-advance trigger** | Dual: >=95% OR remaining <90s | Covers both short and long episodes with credits |
| **Facade lifespan** | `@deprecated` immediately, remove after migration | Prevents adoption of old API |
| **Progress loss tolerance** | Accept 3s on crash | `beforeunload` + `visibilitychange` covers most exits |
| **Episode state passing** | `sessionStorage` (not URL params) | Cleaner URLs, survives page refresh |
| **Rollback strategy** | Git revert per commit | Each step = separate commit, granular rollback |
| **Loading states** | New Phase 6: skeleton screens | Glass-styled skeletons for key loading states |
| **AppShell sequencing** | Parallel after providers exist | AbortController + features can proceed once providers are stable |

---

## Phase 1: Structural Cleanup (High Impact, Low Risk)

### 1.1 Split AppShell into focused providers
**Problem:** `AppShell.tsx` is 992 lines with 33 `useState` calls and a 100-line `useMemo` for the context value. Every state change re-renders the entire context consumer tree. Hard to reason about, risky to modify.

**What already exists:** The `layout/app-shell/hooks/` directory already contains extracted hooks that do the heavy lifting:
- `useUserSession.ts` — fetches/validates user from authKey
- `useAddonsManager.ts` — addon collection get/set, install/uninstall
- `useStoredStateSync.ts` — hydrates storage state from server
- `useSearchMenu.ts` — search history, remote suggestions, menu open state
- `useThemeToggle.ts` — dark/light mode toggle
- `useContinueWatching.ts` — library polling, progress events
- `useContinueWatchingActions.ts` — open/remove continue watching items
- `useHomePrefsSync.ts` — home row order/hidden sync

The existing hooks are well-factored. The problem is that AppShell still owns all the *state* and just *calls* these hooks — so all 33 useState variables live in one component, and the single `useMemo` context object recreates on nearly any state change.

**Plan:**
- Create `context/AuthProvider.tsx` — wraps `useUserSession`, owns `authKey`, `user`, `savedAccounts`, login/logout/switch, profile prompt logic. Exposes `useAuth()` hook. Moves state from AppShell lines 97-106, 126-127 and callbacks from lines 377-470.
- Create `context/AddonsProvider.tsx` — wraps `useAddonsManager`, owns `addons`, `addonsLoading`, `addonsError`, install/uninstall, torrentio clone sync. Depends on `useAuth().authKey`. Moves state from AppShell lines 258-303.
- Create `context/StorageProvider.tsx` — wraps `useStoredStateSync`, owns `storageState`, `storageHydrated`, `persistStorageState`, player settings, home row prefs. Moves state from AppShell lines 114-124, 182-207.
- Create `context/UIProvider.tsx` — owns `uiStyle`, `isDark`, gradients, sidebar collapsed state, `homeEditMode`, wraps `useSearchMenu`/`useThemeToggle`. Moves state from AppShell lines 83-96, 118-121, 143-150.
- Compose in `App.tsx`: `AuthProvider > StorageProvider > AddonsProvider > UIProvider > Routes`
- Keep `AppContext` as a temporary facade that reads from all four providers via their hooks, so existing `useAppContext()` consumers don't break. **Mark `useAppContext()` as `@deprecated` immediately** with a JSDoc comment pointing to the specific hooks (`useAuth`, `useAddons`, `useStorage`, `useUI`). This prevents new code from adopting the old API during migration. Remove the facade entirely once all consumers are migrated.
- AppShell shrinks to layout shell: TopNav/NetflixTopBar + SideNav + `<Outlet />` + modals.

**Files touched:** `AppShell.tsx`, `context/AppContext.tsx`, `App.tsx`, + 4 new provider files. No changes needed in the existing `layout/app-shell/hooks/` files since the providers will import and wrap them directly.

**Risk:** Medium. Mitigate by doing one provider at a time (start with UIProvider — fewest cross-dependencies), verifying the app after each. The facade pattern means zero consumer changes until ready.

**Verification:** After each provider extraction, run `npx tsc --noEmit` and manual test the affected flows (login, addon install, theme toggle, search). No automated tests exist yet, so manual verification is required.

---

### 1.2 Route-level code splitting
**Problem:** All 9 page components are statically imported in `App.tsx` (lines 5-13). Users loading the home page download code for PlayerPage (which imports SimplePlayer.tsx at 1500+ lines with HLS.js), DetailPage (which imports the streams engine), SearchPage (concurrent addon search), etc.

**Plan:**
- Before implementing, run `npx vite-bundle-visualizer` to measure actual chunk sizes and identify the biggest wins. If Vite/Rollup already tree-shakes HLS.js into a separate chunk, the savings for PlayerPage may be smaller than expected.
- Replace static imports with `React.lazy()` for: `PlayerPage`, `DetailPage`, `DiscoverPage`, `SearchPage`, `SettingsPage`, `AddonsPage`, `AccountsPage`, `LibraryPage`.
- Keep `HomePage` eager (landing page).
- Add `<Suspense fallback={<LoadingRow />}>` wrapping the `<Outlet />` in AppShell (or at the route level in `App.tsx`).
- Verify Vite produces separate chunks per page in `dist/assets/` after build.
- Note: React 19 (which this project uses — `react ^19.2.0`) handles Suspense slightly differently from 18. No double-renders in strict mode, and the `use()` hook is available as an alternative. Lazy loading still works the same way.

**Files touched:** `App.tsx` only. Possibly `AppShell.tsx` if adding Suspense at the Outlet level.

**Risk:** Low. Only risk is a flash of loading state on slow networks; mitigate with a skeleton/spinner that matches the glass design.

---

### 1.3 Deduplicate DetailStreamsPanel props
**Problem:** `DetailStreamsPanel` is rendered twice in `DetailPage.tsx` — mobile (lines 202-259) and desktop (lines 376-433) — with 28+ identical props. The only differences are `variant` and `streamRows` (mobile uses `mobileTorrentioRows`, desktop uses `streamsViewDesktop.rows`). There's also an identical `onNavigate` inline lambda duplicated at both sites (lines 244-255 and 418-429) that builds a URL with poster/metaTitle/logo params.

**Plan:**
- Extract the `onNavigate` lambda into a `handleNavigateToPlayer` callback with `useCallback` above the return.
- Build a `sharedStreamsPanelProps` object containing all 28 common props.
- Render as:
  ```tsx
  <DetailStreamsPanel variant="mobile" streamRows={mobileTorrentioRows} {...sharedStreamsPanelProps} />
  <DetailStreamsPanel variant="desktop" streamRows={streamsViewDesktop.rows} {...sharedStreamsPanelProps} />
  ```
- `variant` prop already exists on `DetailStreamsPanel` (line 10 of `DetailStreamsPanel.tsx`), so no changes needed there.

**Files touched:** `DetailPage.tsx` only.

**Risk:** Low.

---

### 1.4 Deduplicate HomePage onSeeAll handler
**Problem:** The `onSeeAll` handler is copy-pasted character-for-character between `<MediaRailMobile>` (lines 302-329) and `<MediaRail>` (lines 350-377). Both have identical logic: check for popular movie/series built-in rows, check for addon rows, fallback to `/discover`.

**Plan:**
- Extract a `handleSeeAll` function using `useCallback`:
  ```tsx
  const handleSeeAll = useCallback((row: typeof rowsToRender[number]) => {
    if (row.id === HOME_ROW_POPULAR_MOVIE) { navigate('/discover/...movie/top', ...); return; }
    if (row.id === HOME_ROW_POPULAR_SERIES) { navigate('/discover/...series/top', ...); return; }
    if (row.addon && row.type && row.catalogId) { navigate('/discover/...', ...); }
    else navigate('/discover');
  }, [navigate]);
  ```
- Pass `onSeeAll={() => handleSeeAll(row)}` to both components.
- Note: the `dimmed` prop and `actions` prop also have minor duplication (both check `homeRowPrefs.hidden.includes(row.id)` and render a Show/Hide button), but the action buttons have different styling (`text-xs px-2 py-1` on mobile, no extra classes on desktop), so those should stay separate or use a conditional class.

**Files touched:** `HomePage.tsx`.

**Risk:** Low.

---

## Phase 2: Type Safety (Medium Impact, Low Risk)

### 2.1 Fix `any` types in streams.ts
**Problem:** Three `any` types in `features/detail/streams.ts`:
1. Line 3: `StreamsByAddon` type uses `streams: any[]`
2. Line 8: `StreamRow.stream` is `any`
3. Line 209: `(stream as any).deepLinks` cast

The actual type flowing in from `useMetaDetails.ts` (line 17) is `StremioStream & { deepLinks: StreamDeepLinks; progress: number }`.

**Plan:**
- Define `EnrichedStream` in `features/detail/streams.ts` (co-located, since it's only used here and in `useMetaDetails.ts`):
  ```typescript
  import type { StremioStream } from '../../lib/stremioAddon';
  import type { StreamDeepLinks } from '../../lib/deepLinks';
  export type EnrichedStream = StremioStream & { deepLinks: StreamDeepLinks; progress: number };
  ```
- Update `StreamsByAddon` locally in `streams.ts` (line 3): `streams: EnrichedStream[]`
- Update `StreamRow.stream` (line 8): `stream: EnrichedStream`
- Remove the `(stream as any).deepLinks` cast (line 209) — `stream.deepLinks` will now typecheck directly.
- Update `useMetaDetails.ts` to import `EnrichedStream` and use it in its own `StreamsByAddon` type (line 13-20) instead of the inline definition.
- Fix any downstream type errors in `StreamList.tsx`, `DetailStreamsPanel.tsx`, `DetailPage.tsx` that currently rely on the `any` escape hatch.
- The `.filter((row) => row.stream.url || row.stream.infoHash)` on line 290 will typecheck because `url` and `infoHash` are already optional fields on `StremioStream`.

**Files touched:** `features/detail/streams.ts`, `models/useMetaDetails.ts`, and downstream consumers if they cast `stream` to `any`.

**Risk:** Low — type-only changes, no runtime behavior change.

---

### 2.2 Remove unnecessary `as any` casts in DetailPage
**Problem (corrected from original plan):** The original plan stated these fields were "missing from the type." They are not. `StremioMetaDetail.meta` in `stremioAddon.ts` (lines 36-68) already defines: `logo` (line 41), `released` (line 46), `genres` (line 50), `genre` (line 51), `cast` (line 52), `trailerStreams` (line 54). The `as any` casts in DetailPage are unnecessary for 5 of 6 cases.

**Actual casts in DetailPage.tsx:**
| Line | Cast | Field exists in type? | Action |
|------|------|----------------------|--------|
| 156 | `(meta?.meta as any)?.logo` | Yes — `logo?: string` | Remove cast |
| 172 | `(meta?.meta as any)?.released` | Yes — `released?: string` | Remove cast |
| 177 | `(meta?.meta as any)?.genres` / `?.genre` | Yes — `genres?: string[]`, `genre?: string[]` | Remove cast |
| 178 | `(meta?.meta as any)?.cast` | Yes — `cast?: string[]` | Remove cast |
| 183 | `(meta?.meta as any)?.trailerStreams` | Yes — `trailerStreams?` | Remove cast |
| 175 | `(meta?.meta as { imdb_id?: string })?.imdb_id` | **No** | Add `imdb_id?: string` to `StremioMetaDetail.meta` |
| 482 | `itemInfo.type as any` | N/A — type enum mismatch | Fix by aligning the type parameter with the function signature |

Also check `HomePage.tsx` line 71: `!(item as any)?.removed` and line 173: `!(existing as any)?.removed` and line 182: `hero.type as any` — these suggest `LibraryItem` is missing a `removed` field and `addToLibraryItem` has a type mismatch on the `type` parameter.

**Plan:**
- Remove the 5 unnecessary `as any` casts (lines 156, 172, 177, 178, 183).
- Add `imdb_id?: string` to `StremioMetaDetail.meta` in `stremioAddon.ts`.
- Fix the `type as any` cast at line 482 by checking the `datastorePutLibraryItems` type signature and either widening the parameter type or using a proper type assertion.
- ~~Audit `HomePage.tsx` for its `as any` casts and fix them too~~ — moved to Step 2.3 below.

**Files touched:** `DetailPage.tsx`, `lib/stremioAddon.ts` (add `imdb_id`), `lib/stremioApi.ts` (fix type param alignment if needed).

**Risk:** Low.

---

### 2.3 Fix `as any` casts in HomePage
**Problem:** `HomePage.tsx` has three `as any` casts that indicate missing type definitions:
1. Line 71: `!(item as any)?.removed` — filters out removed library items, but `LibraryItem` type lacks a `removed` field.
2. Line 173: `!(existing as any)?.removed` — same pattern in a different filter.
3. Line 182: `hero.type as any` — type enum mismatch when calling `addToLibraryItem`, suggesting the function's `type` parameter is narrower than the actual values flowing in.

These were originally noted in Step 2.2 but are a separate concern (different file, different root causes).

**Plan:**
- Add `removed?: boolean` to `LibraryItem` in `lib/stremioApi.ts` (or wherever the type is defined). This field comes from the Stremio datastore and indicates soft-deleted items.
- Remove both `as any` casts on lines 71 and 173 — `item.removed` / `existing.removed` will typecheck directly.
- Fix the `hero.type as any` cast on line 182 by checking the `addToLibraryItem` (or `datastorePutLibraryItems`) type signature. Either widen the `type` parameter to accept all meta types, or use a union type that covers the actual values (`'movie' | 'series' | 'anime' | 'other'`).

**Files touched:** `pages/HomePage.tsx`, `lib/stremioApi.ts` (add `removed` field, widen type param).

**Risk:** Low — type-only changes, no runtime behavior change.

---

## Phase 3: Performance (Medium Impact, Medium Risk)

### 3.1 Cap in-memory addon caches + add stale sweep
**Problem:** Five `Map` caches in `stremioAddon.ts` (lines 99-103) grow unbounded. TTL of 5 minutes (line 97) only evicts lazily on read in `getCached()` (lines 144-148). Entries that are written but never re-read persist forever until page reload. Long browsing sessions accumulate stale data.

**Plan:**
- Add `MAX_CACHE_ENTRIES = 200` constant.
- In `setCached()` (line 152), after inserting, if `cache.size > MAX_CACHE_ENTRIES`, delete the oldest entries. Since `Map` preserves insertion order, iterate with `cache.keys()` and delete the first `cache.size - MAX_CACHE_ENTRIES` entries.
- Add a periodic stale-sweep: every 60 seconds, iterate each cache and delete entries where `Date.now() > entry.expiresAt`. Use a single `setInterval` at module scope. This prevents unbounded memory growth from entries that are written once and never read again.
- Alternative (more robust): replace the 5 Maps + `getCached`/`setCached` with a single generic `LRUCache<T>` class (~40 lines) that handles both max-size eviction and TTL expiry.

**Files touched:** `lib/stremioAddon.ts`.

**Risk:** Low. The only behavioral change is that very old cache entries get evicted, which just means slightly more refetching.

---

### 3.2 Debounce progressStore writes + add quota guard
**Problem:** `setProgress()` in `progressStore.ts` calls `readAll()` (JSON.parse of entire map from localStorage) then `writeAll()` (JSON.stringify + setItem) on every invocation. `SimplePlayer.tsx` calls `setProgress` on the `timeupdate` event, which fires ~4 times per second during video playback. That's ~4 full JSON parse+stringify cycles per second.

**Plan:**
- Add a module-level in-memory cache: `let cache: ProgressMap | null = null`
- `readAll()` populates `cache` on first call, then returns `cache` on subsequent calls.
- `getProgress()` / `getProgressPercent()` / `isWatched()` read from in-memory cache — zero JSON.parse overhead.
- `setProgress()` mutates in-memory cache immediately, then schedules a debounced `flush()` (3-second delay, not 5 — 5 is too much progress to lose on a crash/tab close).
- `flush()` does a single `JSON.stringify` + `localStorage.setItem` wrapped in try/catch.
- Add `window.addEventListener('beforeunload', flush)` to ensure final write.
- **Add quota guard:** Wrap `localStorage.setItem` in try/catch. On `QuotaExceededError`, prune the oldest N entries from the map (by `updatedAt` timestamp) and retry. This prevents the progress store from silently failing when localStorage fills up.
- Also handle tab-visibility: `document.addEventListener('visibilitychange', ...)` — flush when the tab goes hidden (covers mobile Safari backgrounding).
- **Flush on player pause:** Export a `flushNow()` function that `SimplePlayer.tsx` can call when the user pauses playback. Most deliberate exits involve pausing first, so this catches the common case without relying on browser lifecycle events. Low implementation cost (one function export + one call site).

**Files touched:** `lib/progressStore.ts`, `components/SimplePlayer.tsx` (add `flushNow()` call in pause handler).

**Risk:** Low. Worst case on crash is losing 3 seconds of progress. The `beforeunload` + `visibilitychange` + pause-flush listeners cover most exit paths.

---

### 3.3 Add AbortController to fetch calls
**Problem:** 27 instances of `let cancelled = false` across 20 files, with zero `AbortController` usage anywhere. The `cancelled` boolean prevents state updates after unmount but doesn't abort in-flight HTTP requests. Navigating away from DetailPage while streams are loading continues downloading responses from every addon. SearchPage fans out to all addons with a concurrency pool of 6 workers — navigating away keeps all of them running.

**High-impact targets (prioritized by fan-out / data volume):**
1. `useMetaDetails.ts` — iterates all addon bases for meta, then `Promise.all` for streams across all addons. Highest network waste.
2. `SearchPage.tsx` — concurrent 6-worker pool searching across all addons. Second highest.
3. `SimplePlayer.tsx` — `Promise.allSettled` for subtitles across all subtitle addons.
4. `useAddonRows.ts` — fetches catalog from every addon for home page rows.
5. `useContinueWatching.ts` — polls library on 15-second interval.

**Lower-impact targets (single fetches):**
- `useStoredStateSync.ts`, `useUserSession.ts`, `useAddonsManager.ts`, `useDiscoverCatalogData.ts`, `useImdbRating.ts`, `LibraryPage.tsx`, `PlayerPage.tsx`, `NetflixRow.tsx`, `useNetflixHero.ts`, `useLibraryState.ts`, `useSearchMenu.ts`, `useHomePrefsSync.ts`, `AppShell.tsx` (3 instances).

**Plan:**
- Add optional `signal?: AbortSignal` parameter to all fetch functions in `stremioAddon.ts` (`fetchAddonManifest`, `fetchCatalog`, `fetchMeta`, `fetchStreams`, `fetchSubtitles`). Pass through to the native `fetch()` call.
- Add optional `signal?: AbortSignal` to `stremioApi.ts` fetch functions (`datastoreGetLibraryItems`, `getUser`, `addonCollectionGet`, etc.).
- In each `useEffect` with the `cancelled` pattern, create `const controller = new AbortController()` and pass `controller.signal` to fetch calls. In cleanup: `controller.abort()` alongside `cancelled = true`.
- Handle `AbortError` in catch blocks: `if (err instanceof DOMException && err.name === 'AbortError') return;` (or simply ignore it since `cancelled` is already true).
- Start with the high-impact targets (items 1-4) and backfill the rest.

**Files touched (Phase 1):** `lib/stremioAddon.ts`, `lib/stremioApi.ts`, `models/useMetaDetails.ts`, `pages/SearchPage.tsx`, `components/SimplePlayer.tsx`, `features/home/hooks/useAddonRows.ts`.

**Files touched (Phase 2):** All remaining hooks listed above.

**Risk:** Low. `AbortController` is standard web API. The only subtlety is that `AbortError` is a `DOMException`, not a regular `Error`, so catch blocks that check `err instanceof Error` will still catch it (DOMException extends Error). The `cancelled` boolean guards cover any edge cases where abort fires after the response already arrived.

---

## Phase 4: Resilience (Medium Impact, Low Risk)

### 4.1 Add React error boundaries
**Problem:** No `ErrorBoundary` component exists anywhere in the codebase. Any component crash (malformed stream data from an addon, null pointer in meta panel, codec issue in player) takes down the entire app with a white screen.

**Plan:**
- Create `components/ErrorBoundary.tsx` — class component with `getDerivedStateFromError` + `componentDidCatch` for logging. Include a "Something went wrong" fallback with a reset button that calls `this.setState({ hasError: false })`.
- Create two styled variants:
  - `ErrorRow` — inline fallback for home page rows (shows "Failed to load" in the row space, doesn't break other rows).
  - `ErrorPage` — full-page fallback with "Go back" or "Return home" navigation.
- Placement:
  - Wrap each addon row in `HomePage.tsx` with `<ErrorBoundary fallback={<ErrorRow />}>` so one broken addon doesn't kill the entire home page.
  - Wrap `DetailPage` route with `<ErrorBoundary fallback={<ErrorPage action="go-back" />}>`.
  - Wrap `PlayerPage` route with `<ErrorBoundary fallback={<ErrorPage action="return-to-detail" />}>`.
  - Wrap the `<Suspense>` boundary (from step 1.2) with an `<ErrorBoundary>` to catch lazy-load failures (network errors during chunk loading).
- Style fallbacks to match glass design (`solid-surface bg-white/6 backdrop-blur rounded-[28px]`).

**Files touched:** New `components/ErrorBoundary.tsx`, `HomePage.tsx`, `App.tsx` (route wrappers).

**Risk:** Low. Error boundaries are a React fundamental that has been stable since React 16.

---

## Phase 5: Features (Lower Priority, Higher Effort)

### 5.2 Inline search results (live preview)
**Problem:** The search menu currently shows only text suggestions (names from Cinemeta catalog search). Users must submit the search and wait for the SearchPage to load results with posters.

**What already exists:** `useSearchMenu.ts` already fetches from Cinemeta on a 250ms debounce (lines 49-73), returning up to 5 name-only suggestions in `remoteSearchSuggestions`. The infrastructure for debounced fetching is in place.

**Plan:**
- Extend the existing debounced fetch in `useSearchMenu.ts` to also return the full `StremioMetaPreview` objects (which include `id`, `type`, `poster`, `name`, `year`), not just the `name` strings.
- Add a new state: `searchResults: StremioMetaPreview[]` (first 5 items).
- In `TopNav.tsx` and `NetflixTopBar.tsx`, render a "Results" section below the existing suggestions in the search dropdown. Each result shows a small poster thumbnail + title + year.
- Click a result: navigate to `/detail/{type}/{id}` and close the menu.
- The existing `searchSuggestions` (name strings) remain for the autocomplete UX. The new `searchResults` are richer visual previews shown below.
- Pass through `AbortSignal` from step 3.3 to cancel the preview fetch on menu close.

**Files touched:** `layout/app-shell/hooks/useSearchMenu.ts`, `layout/top-nav/TopNav.tsx`, `layout/netflix/NetflixTopBar.tsx`.

**Risk:** Low. The fetch infrastructure already exists. Main work is UI rendering in the dropdown.

---

### 5.3 Auto-advance episodes ("Watch Next")
**Problem:** After finishing an episode, users must manually navigate back to the detail page and select the next episode. No auto-advance or "Up Next" overlay exists.

**Plan:**
- **State passing via `sessionStorage`** (not URL params — keeps player URLs clean and survives page refresh):
  - In `DetailPage.tsx`, before navigating to the player, write next-episode info to `sessionStorage` under key `bliss:nextEpisode:{type}:{id}`:
    ```typescript
    sessionStorage.setItem(`bliss:nextEpisode:${type}:${id}`, JSON.stringify({
      nextVideoId, nextEpisodeTitle, nextSeason, nextEpisode
    }));
    ```
  - In `PlayerPage.tsx`, read and parse the sessionStorage key on mount. Pass the data to `SimplePlayer`. Clear the key on unmount or after auto-advance fires.
  - The `nextEpisode` value is already computed by `useEpisodeSelection` (line 86).
- **Dual auto-advance trigger** — show the "Next Episode" overlay when **either** condition is met (whichever fires first):
  1. Playback reaches **>=95%** of duration, OR
  2. **Remaining time <90 seconds**
  - This handles episodes with long credits (where 95% is reached well before credits end) and short episodes (where 90s remaining fires before 95%).
- **Overlay UI** (bottom-right) with:
  - Episode title (e.g., "S2E4 — The Reckoning")
  - 10-second countdown bar
  - "Play Now" button (skips countdown)
  - "Cancel" button (hides overlay, continues current playback)
- On auto-advance: look up the next episode's stored stream from `streamHistory` (`getLastStreamSelection({ type, id, videoId: nextVideoId })`).
  - If found: navigate to player with the stored stream URL.
  - If not found: navigate to `/detail/{type}/{id}?season={s}&episode={e}` so the user can pick a stream.
- Edge case: if the current episode is the last in the season, check the first episode of the next season. If it's the last episode of the series, show "Series Complete" instead of auto-advance.
- The overlay should not appear for movies (only for `type === 'series' || type === 'anime'`).

**Files touched:** `pages/PlayerPage.tsx`, `components/SimplePlayer.tsx` (overlay component + advance logic), `pages/DetailPage.tsx` (write sessionStorage before navigation), `features/detail/hooks/useEpisodeSelection.ts` (expose next episode details).

**Risk:** Medium. The main complexity is the stream lookup for the next episode and the edge cases around season boundaries. The overlay UI itself is straightforward. `sessionStorage` is cleared on tab close, so stale next-episode data is not a concern.

---

### 5.4 PWA / offline support
**Problem:** No PWA manifest, no service worker, no offline capability. The app is a plain SPA served by `serve`. Mobile users can't add it to their home screen with proper app-like behavior.

**Plan:**
- Install `vite-plugin-pwa` as a dev dependency.
- Configure in `vite.config.ts`:
  - `registerType: 'autoUpdate'` (auto-update SW on new build)
  - `manifest`: app name "Blissful", short name "Blissful", theme color `#19f7d2`, background color `#0a0a0a`, display `standalone`, icons (need to create icon assets in `public/`)
  - `workbox.runtimeCaching`:
    - Cache-first for static assets (JS, CSS, fonts, images under `/assets/`)
    - Network-first for API calls (`/addon-proxy/*`, `/storage/*`, `/stremio/*`) with a 10-second timeout fallback to cache
    - Stale-while-revalidate for poster images (Stremio CDN URLs)
- Add icon assets: `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`.
- The plugin auto-generates `manifest.webmanifest` and injects `<link rel="manifest">` into `index.html`.
- Cache the last-fetched library/continue-watching data for offline browsing (workbox will handle this via the network-first strategy for API calls).
- Test on iOS Safari: "Add to Home Screen" should show the app icon, launch in standalone mode, and work offline for previously-visited pages.

**Files touched:** `vite.config.ts`, new icon assets in `public/`, `package.json` (new dev dependency).

**Risk:** Medium. The Vite PWA plugin is well-maintained, but service worker caching of API responses needs careful testing — stale addon responses could show outdated stream lists. The network-first strategy mitigates this (cache is only used when offline).

---

## Phase 6: Loading States (Lower Priority, Medium Effort)

### 6.1 Skeleton screens for key loading states
**Problem:** The app has no consistent loading/skeleton states. When pages load data (HomePage fetching addon rows, DetailPage fetching meta, SearchPage fetching results), users see either nothing or a brief flash of empty content. Step 1.2 adds a Suspense fallback for route-level loading, but data loading within pages is unaddressed.

**Plan:**
- Create a `components/Skeleton.tsx` module with reusable skeleton primitives styled to match the glass design:
  - `SkeletonBox` — rectangular shimmer block (`solid-surface bg-white/6 backdrop-blur rounded-[28px]` with a CSS shimmer animation).
  - `SkeletonText` — line-height skeleton for text blocks (multiple widths).
  - `SkeletonPoster` — poster-card-sized placeholder (aspect-ratio 2:3, rounded corners).
- Build composed skeleton layouts:
  - `SkeletonHomeRow` — matches `MediaRail` / `MediaRailMobile` layout: title bar + horizontal row of 5-6 poster skeletons. Used while addon rows load in `HomePage.tsx`.
  - `SkeletonDetailPanel` — matches `DetailPage` meta layout: backdrop area + poster + title/year/genre lines + description block. Used while meta fetches.
  - `SkeletonSearchGrid` — matches `SearchPage` results grid: 4x3 grid of poster skeletons. Used while search fans out to addons.
- Integration points:
  - `HomePage.tsx` — render `<SkeletonHomeRow />` for each addon row while `useAddonRows` is loading.
  - `DetailPage.tsx` — render `<SkeletonDetailPanel />` while `useMetaDetails` is loading.
  - `SearchPage.tsx` — render `<SkeletonSearchGrid />` while search is in progress.
  - `App.tsx` / `AppShell.tsx` — use `<SkeletonHomeRow />` (or a simpler spinner) as the Suspense fallback from Step 1.2 instead of a generic `<LoadingRow />`.
- The shimmer animation should use CSS `@keyframes` with a gradient sweep, not JS-driven animation (no layout thrash).

**Files touched:** New `components/Skeleton.tsx`, `pages/HomePage.tsx`, `pages/DetailPage.tsx`, `pages/SearchPage.tsx`, `App.tsx`.

**Risk:** Low. Purely additive UI — no logic changes. Main effort is matching the glass design system.

---

## Implementation Order

| Step | Item | Est. Effort | Dependencies |
|------|------|-------------|-------------|
| 1 | 1.2 Route-level code splitting | Small | None — run bundle analysis first |
| 2 | 1.3 Deduplicate DetailStreamsPanel props | Small | None |
| 3 | 1.4 Deduplicate HomePage onSeeAll | Small | None |
| 4 | 2.1 Fix `any` types in streams.ts | Small | None |
| 5 | 2.2 Remove `as any` casts + add `imdb_id` | Small | None |
| 6 | 2.3 Fix `as any` casts in HomePage | Small | None |
| 7 | 3.1 Cap caches + stale sweep | Small | None |
| 8 | 3.2 Debounce progressStore + quota guard | Small | None |
| 9 | 4.1 Error boundaries | Small | Pairs well with 1.2 (wrap Suspense) |
| 10 | 1.1 Split AppShell into providers | Large | Benefits from 2-9 being done first |
| 11 | 3.3 AbortController (high-impact targets) | Medium | Parallel with step 10 once providers exist |
| 12 | 5.2 Inline search results | Medium | None |
| 13 | 5.3 Auto-advance episodes | Medium | None |
| 14 | 5.4 PWA / offline support | Medium | None |
| 15 | 6.1 Skeleton screens | Medium | Pairs with 1.2 (Suspense fallback) |

### Sequencing strategy

**Phase A — Quick wins (steps 1-9):** All independent, can be done in any order or in parallel. Each is a single-commit change. Completing these first reduces the surface area of the AppShell refactor.

**Phase B — AppShell refactor (step 10):** Extract one provider at a time (UIProvider first — fewest cross-dependencies). After all 4 providers are extracted and stable, steps 11-14 can proceed **in parallel** with consumer migration (the `@deprecated` facade keeps everything working).

**Phase C — Features + polish (steps 11-15):** AbortController (step 11) touches the fetch layer, not providers, so it can run alongside the AppShell consumer migration. Features (steps 12-14) are independent of each other. Skeleton screens (step 15) pair naturally with code splitting (step 1) since both involve loading states.

### Rollback

Each step is a separate git commit. If a step introduces a regression, `git revert <sha>` rolls back that change without affecting other completed steps. For the AppShell refactor (step 10), each provider extraction is its own commit for granular rollback.
