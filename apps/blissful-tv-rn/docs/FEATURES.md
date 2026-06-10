# Blissful TV (RN) — Feature Registry

One structured record per screen / feature of `apps/blissful-tv-rn`, so a fresh session knows the files, the reference being mirrored, the deliberate decisions, and the landmines — without re-discovering them.

**Rules**

- **Before** working on a feature: Grep this file for its heading and read that record (plus *Cross-cutting: D-pad focus* — it applies everywhere).
- **After** adding/changing behaviour, or discovering a decision/gotcha: update the record in the same change. Records describe **current state** — git is the changelog.
- Keep a record ≤ ~15 lines: pointers, decisions, gotchas, verify. Never prop lists or style values — the code says those. If a record outgrows this, move the detail to its own doc and link it.
- **Mirrors** = the reference implementation to read before changing anything (see root `CLAUDE.md` "Reference apps & terminology": Windows app = `apps/blissful-mvs`+`blissful-shell`, web = `D:\JS\OpenCode`).
- Build / run / emulator / real-TV recipes live in root `CLAUDE.md` — not repeated here. **Verify** lines assume that setup; drive with keyevents + screencap per step, never one static shot.
- Items under **Decisions** were chosen WITH the user, often after rejected alternatives — do not "fix" them without asking.

---

## Foundations (theme, metrics, images, storage, core)

- **Files:** `src/theme/{colors,metrics,ThemeProvider}`, `src/components/{Img,Toast,Skeleton,BootSplash}.tsx`, `src/lib/{images,storage,colorUtils,appInfo,navigationRef}.ts`, `App.tsx` (providers Theme > Auth > Toast > UserSocket; navigationRef; PartyInviteListener; usePresenceHeartbeat).
- **Mirrors:** blissful-mvs `index.css` tokens — Fraunces (headings) / Spectral (immersive-home display) / IBM Plex (body), glass surfaces, lavender accent `#95a2ff`.
- **Decisions:** `colors.accent` is a SINGLE solid hex used for rings/fills/progress/active — a gradient-accent system was built and FULLY REVERTED (user disliked it); do not reintroduce. `m.s(px)` scales 1920-design px to dp (TV canvas 960×540 dp @ 2×); memoise `useMetrics` — every card calls it.
- **Images:** `Img` = expo-image `cachePolicy='memory-disk'` + `transition` crossfade; `proxiedImage()` routes metahub/tmdb via `{backendRoot}/img`, fanart.tv via images.weserv.nl (backend allowlist excludes fanart). Bundled `require()` assets stay on RN Image.
- **Toast:** `useToast().show(msg)` — global top-center glass pill (ToastProvider in App).
- **Core:** `@blissful/core` consumed as SOURCE — Metro watchFolders + a `node_modules/@blissful/core` junction made by `scripts/link-core.js` (release bundling ignores extraNodeModules). After editing core: restart Metro with `--clear`.
- **Gotchas:** New Arch — never toggle `transform` between array and undefined (always `[{scale: …}]`); react-native-svg crashes under a parent scale transform. `console.log` reaches `adb logcat -s ReactNativeJS:V` (flat single-line strings), not the Metro bg output.
- **Verify:** tsc clean; boot to Home with Spectral titles + lavender focus ring.

## Cross-cutting: D-pad focus system

- **Files:** `src/lib/{useTvFocusable,focusBus,railStore,overlayStore,contentFocus,useSelfTag,settingsLeftTarget}.ts`, `src/components/FocusTrap.tsx`.
- **The rule:** native geometry handles interior moves — add NO `nextFocus*` except at a row's LEFT EDGE (gate on `atRowStart`; self-trap or route to a specific target). Fix focus bugs at the shared-control layer, never by patching one control.
- `useTvFocusable({atRowStart, autoFocus, onPress, …})` → `{focused, focusProps}`; spread on a Pressable, style off `focused`.
- **Modals:** wrap the panel in `FocusTrap` (TVFocusGuideView, trap all 4 directions + autoFocus); backdrop Pressable `focusable={false}`. FocusTrap registers in `overlayStore`, so NavRail's global open-on-Left no-ops over modals. Modals with TextInputs ALSO need the background inert (`useContentInert()` = rail open || login open — the IME flings D-pad focus past the trap), in-tree rendering (App-level siblings don't trap), Pressable-wrapped inputs (`hasTVPreferredFocus` on a bare TextInput doesn't grab), and `onSubmitEditing` guarded on filled fields.
- **Gotchas (each cost a session):** a standalone `<Modal>` gets focus but its onPress no-ops AND hardware Back falls through (exited the app) → use in-tree overlays, or one Modal with internal mode switches. `hasTVPreferredFocus` must NEVER track focus-driven state (infinite focus loop → crash; switch selection on OK, not on focus). `isTVSelectable` cascades — flip ONE container per screen, not per card (per-card flips made rail-open take 1.5s). Hold-OK = the `longSelect` TV event via `useTVEventHandler` (`Pressable.onLongPress` never fires for OK); guard the paired onPress with a consumed-ref. `adb keyevent --longpress 23` is flaky; tight scripted sequences mis-order — use ≥1s gaps or the real remote.
- **Verify:** every focus change by driving + screencap; focus must never land behind an overlay.

## NavRail (sidebar)

- **Files:** `src/components/NavRail.tsx`, `src/lib/{railStore,focusBus,contentFocus}.ts`. Hosts `LoginModal` + `JoinPartyModal` in-tree (returns a Fragment so they aren't clipped by the rail's overflow).
- **Model:** collapsed rail NOT focusable; opens ONLY on D-pad Left while resting (>130ms age gate in focusBus) on a content row's left-edge element; closes ONLY on Right — no auto-collapse. While open, content is inert via ONE `isTVSelectable={!railOpen}` container per screen.
- **Decisions:** Search is the FIRST nav item (moved out of the topbar in the immersive redesign). Flush full-height panel — transparent collapsed, dark `NAV_PANEL` + right border expanded (the old floating glass pill is gone). Nav focus = SOLID accent FILL + ink icon/label, not a ring. Inactive icons `textDim`, active page `accent`; the Friends icon is always `textDim` (only its request-count badge is accent). Friends accordion lives in the expanded panel — see *Friends* record.
- **Gotchas:** tvos sometimes swallows a 2nd consecutive Left on the very first grid cell (fix if needed: self-referencing `nextFocusLeft` on edge cards). The global open-on-Left handler must early-return on `isOverlayOpen()` — it used to open the rail behind modals.
- **Verify:** Left at a leftmost tile opens; Up/Down cycle rows; Right closes; with a modal open, Left must NOT open the rail.

## Auth, login & profile menu

- **Files:** `src/context/AuthContext.tsx`, `src/components/{LoginModal,ProfileMenu}.tsx`, `src/lib/{loginStore,avatars}.ts`. `LoginScreen.tsx` is DELETED — login is a modal.
- **Decisions:** login opens via `loginStore` (modelled on railStore) and renders inside NavRail gated `useLoginOpen() && useIsFocused()`. `ProfileMenu` is an in-tree absolute overlay at a FULL-SCREEN root (zIndex 200), NOT a `<Modal>` — Modal didn't capture hardware Back (app exited to launcher). The avatar picker is a MODE SWITCH inside ProfileMenu, not a second Modal (a second Modal's onPress silently no-ops on tvos). ProfileMenu also hosts the "Customize Home" row.
- **Gotchas:** LoginModal is the canonical TextInput-modal case — see the focus-system record. Set `cursorColor`/`selectionColor` to accent or the caret renders brand-teal.
- **Verify:** avatar → login modal; D-pad cannot escape to tiles behind; Back closes keyboard, then modal. Emulator: pull the JWT via `run-as com.blissful.tv.rn` (MMKV `files/mmkv/bliss`) to hit the storage API directly.

## Home (immersive)

- **Files:** `src/screens/HomeScreen.tsx`, `src/components/home/{HomeHero,LandscapeRail,LandscapeTile,HomeTopRight,HomeActionOverlay,homeData}`, `src/lib/tmdbArt.ts`.
- **Mirrors:** `design/home/` JSX mockup + the user's prototype SCREENSHOT — when they disagree, the SCREENSHOT wins (the clock+avatar exist only in it; the JSX's nav-hint pill was removed on request).
- **Model:** full-bleed Backdrop + InfoPanel FOLLOW the focused tile (fetchMeta debounced 180ms; `metaCache`; `focusedMeta = {key, meta}` NEVER null-cleared — nulling = flash). Lower band of 16:9 landscape tiles focus-scrolls: `ROW_STEP` must equal the REAL rendered row height (380); band paddingTop 0; ScrollView paddingBottom `m.height`; tile `transformOrigin:'left center'` so the focus scale never clips left.
- **Decisions:** NO topbar — top-right is a live clock + avatar (avatar reachable via published findNodeHandle → genre chips' `nextFocusUp`). NO Play/Watchlist CTAs in the InfoPanel: OK on a tile → Detail (CW tiles → Resume modal first); HOLD OK → `HomeActionOverlay`, a root-level box at the tile's MEASURED window rect (library Add/Remove + CW Remove-progress). Genre chips navigate to Discover. Tile focus ring = accent + glow (outer wrapper carries scale/ring/glow; inner box clips art). Tile art = TMDB 16:9 backdrop via the ACCOUNT tmdb key (`tmdbArt.ts`; PRODUCTION TODO: server-keyed backdrop endpoint), metahub fallback. Rows: CW + Popular Movies + Popular Series + addon rows.
- **Gotchas:** `cwReady` gates the band render + backdrop seed (CW resolving late stole focus = backdrop flash). The same title can sit in 2 rows — gate the overlay measure on `focused` or the off-screen twin clobbers the rect. The Backdrop keeps the previous art while new meta resolves and advances a candidate list on `<Img onError>` (fanart 404s → poster fallback).
- **Verify:** Right → backdrop/InfoPanel follow + kicker flips; Down → band scrolls flush; hold-OK on a CW tile → on-poster overlay; chip → Discover pre-filtered.

## Home addon rows & Customize Home

- **Files:** `src/lib/homeRows.ts` (row IDs byte-identical to web), `src/components/home/{useAddonRows,CustomizeHomeModal}.tsx`; prefs I/O in `src/lib/addons.ts` (`/state.homeRowPrefs` + kv cache).
- **Mirrors:** blissful-mvs home rows + home-settings modal. `homeRowPrefs` is SHARED with the Windows app via the same `/state` doc — verified round-trip on device.
- **Decisions:** one row per addon's FIRST catalog, fetched DIRECT (no `/addon-proxy` on RN); Cinemeta excluded (would duplicate the Popular rows); CW stays pinned top, outside the prefs order. Entry point = ProfileMenu "Customize Home" — the user REJECTED a top-bar icon next to the clock.
- **Gotchas:** addon-row meta prefetch uses 2 workers (4 starved the focused item's fetch and lagged the backdrop). Row "See All" → `navigate('Discover', {type, transportUrl, catalogId, title})`.
- **Verify:** Anime Kitsu row renders with backdrops; hide/reorder persists and matches the Windows app's hidden rows.

## Continue Watching & resume

- **Files:** `src/lib/continueWatching.ts`, `src/components/ResumeModal.tsx`, HomeScreen CW row + the black `BufferingVeil` pre-nav veil.
- **Decisions:** NO `!removed` filter (web semantics — soft-removed items keep progress and still show). Resume/Start-over resolves the REAL title (meta + streams) behind a black+logo veil; the logo is set on META resolve and cached per title (`cwLogoCache`) so it merges seamlessly into the player's buffering veil. Remove-progress (hold-OK) zeroes `state.timeOffset/duration/timeWatched/lastWatched` — keeps the library row, drops it from CW (OpenCode `useContinueWatchingActions` semantics).
- **Verify:** resume an episode → veil with logo → player at the saved position; remove progress → leaves CW, stays in Library.

## Detail

- **Files:** `src/screens/DetailScreen.tsx`, `src/lib/metaResolver.ts`, `src/components/{Hero,Rating,ItemsRail}.tsx`.
- **Mirrors:** blissful-mvs DetailPage; episode stills follow the Windows/OpenCode server-keyed TMDB approach.
- **Decisions:** meta via `resolveMeta` (NOT bare fetchMeta): prefix-owning addon first (`kitsu:` → Kitsu), then all installed addons, then Cinemeta; retry `anime`→`series` (load-bearing for Kitsu); `isSeries` must include `'anime'`. Episode stills/ratings: backend `/tmdb-find?imdbId` + `/tmdb-season-info?tmdbId&season` (server-keyed, no account key), mapped by ABSOLUTE episode position (TMDB and Cinemeta disagree on season boundaries, esp. anime), cached per season.
- **Gotchas:** poster-flash prevention is URL stability — `metahubPosterToBackdrop` keeps the Image source byte-identical when meta lands. The bottom episodes row needs a marginBottom (a flex spacer pins it to the screen edge); the episode-range `TvSelect` minWidth must fit "Ep 1101–1150"; `TvSelectOverlay` flips upward when the trigger is low.
- **Verify:** S2+ episode stills are unique (not the show poster); a Kitsu title shows background/genres/episodes.

## Stream picker

- **Files:** `src/components/StreamPicker.tsx`, `src/lib/streamPicker.ts`.
- **Mirrors:** the old app 1:1 — centered glass panel, TOP PICKS (best 4K + best 1080p pinned), accordion buckets 4K/1080p/720p/SD/Other with counts.
- **Decisions:** addon list from stored `state.addons` + Real-Debrid key injection; per-addon fetch is PROGRESSIVE (`onRows`) with a 30s per-addon timeout; addon URLs + per-title results cached 5 min (re-opens instant). SKIP the local `127.0.0.1:11470` addon — normalizeAddonBaseUrl rewrites it to host.docker.internal which hangs forever. expo-video cannot play magnet/infoHash — only HTTP urls (RD-resolved); infoHash-only rows render disabled "Real-Debrid required".
- **Gotchas:** 4K MUST play — 4K-black is the EMULATOR's missing decoder; never downscale the pick. Verify a title actually has streams via a direct torrentio fetch before blaming code.
- **Verify:** movie Watch → buckets with counts; play the 4K pick on the REAL TV.

## Player

- **Files:** `src/screens/PlayerScreen.tsx`, `src/components/player/{PlayerControls,PauseOverlay,BufferingVeil,SettingsDrawer}.tsx`, `src/lib/releaseInfo.ts`.
- **Mirrors:** Windows `NativeMpvPlayer` for chrome/UX. The Releases tab mirrors OPENCODE `ReleasesPicker` + `BottomControls` (the Windows desktop has no releases button — OpenCode is the reference there). A centered releases modal was REJECTED; removing the button was also rejected.
- **Engine:** expo-video behind hook opts `{getTime, pausedRef, seek, play, pause, setRate}`. `player.playing` LIES right after load/seek — play/pause is PURE INTENT: `userPausedRef` is the single truth; a 400ms interval re-asserts intent on the engine and mirrors intent (never the getter) to the UI; 250ms double-fire guard on OK (select+playPause both arrive).
- **D-pad:** virtual-index model — ONE focusable root + `useTVEventHandler` walks the control rows (native per-button focus fought itself). Drawers own the remote while open; Left/Back closes them.
- **Decisions:** buffering = FULL chrome immediately + the title's landscape-logo pulse overlay (below the controls' zIndex, never a blocking sheet) + `--:--` scrub; VideoView opacity 0 until revealed (duration > 45s — the DMCA-placeholder gate; shorter → auto-advance to the next stream). Controls auto-hide is INTERVAL-driven, not setTimeout (setTimeout doesn't reliably fire on TV): activity stamps `lastActivityRef`, the tick hides after 3.5s when revealed && !paused && no drawer. Back = `navigation.reset` to [Home, Detail(detailId)] — never goBack; carry the SHOW id as `detailId`. Bottom row: series `[play,next,episodes,subtitles,audio,releases]`, movies omit next/episodes — never mutate the array mid-mount (virtual index shifts). Track labels derive from the language CODE (`subtitleLangLabel`) — engine labels arrive device-localized. Badges RD/4K/HDR top-right + Watch Party pill. PauseOverlay shows the CURRENT EPISODE info for series (incl. per-episode TMDB rating).
- **Verify:** on the REAL TV — buffer shows chrome+logo; OK toggles correctly right after a seek; Back lands on Detail; chrome auto-hides after 3.5s.

## Player: subtitles

- **Files:** `src/lib/{subtitles,subtitleCues}.ts`, `src/components/player/{SubtitleMenu,SubtitleOverlay}.tsx`; styling prefs via Settings `SubtitleColorPicker` + player settings.
- **Why a custom overlay:** expo-video v56 cannot attach external subtitle URLs to a source — external subs are fetched from addons, parsed to cues, and rendered by `SubtitleOverlay` ON TOP so the saved colour/background/outline/size apply. Embedded tracks still go through `player.subtitleTrack`/`availableSubtitleTracks`.
- **Decisions:** the preferred subtitle auto-loads on file-load + a "Subtitles loaded" toast; the drawer has 2D D-pad nav and OK on X closes it; labels from language code (see Player record).
- **Verify:** subs drawer → pick an external language → styled cues render; reload the file → preferred auto-loads + toast.

## Player: episodes drawer & next-episode

- **Files:** `src/components/player/EpisodesDrawer.tsx`; `switchToEpisode` + binge logic in `PlayerScreen.tsx`.
- **Mirrors:** the web/Windows COVERFLOW drawer — right-anchored transform stack (focused card 1.15 + white ring + description + WATCHING badge; neighbours scale/darken), header pills [Search | Season ▾ | Auto play] + X, panel vertically centered maxH `m.s(800)`.
- **Decisions:** VIRTUAL focus — one Animated.Value drives translate + per-card scale/darken; render slice focus±6 (Kitsu 1000-ep safe); opens at the CURRENT episode; the season pill opens a DROPDOWN zone (not a cycle); the search TextInput is focused imperatively (`isTVSelectable={false}`). A "Season N" title+overview block scrolls inside the stack; per-episode runtime + overview come from the server-keyed `/tmdb-find` + `/tmdb-season-info` (direct per-season fetch, NOT the Detail mapping), module-cached.
- **Next-episode:** `next` is a skip-forward button, DIMMED but kept in the walk when last/unaired (press → "airs <date>" toast). `switchToEpisode` = save progress → black+logo veil → loadStreams → `navigation.replace('Player', …)` (full remount = fresh progress key/subs/badges); no streams → reset to the episode's Detail. Binge auto-advance fires once per file at duration−0.5 (`endFiredRef`, reset on url change), gated on Auto play + next aired.
- **Verify:** drive with ≥1s gaps (tight sequences ghost on the emulator); season dropdown OK-selects; binge advances at credits.

## Watch Party

- **Files:** `src/lib/{watchParty,useWatchPartyRoom,joinWatchParty,activeParties,presence}.ts`, `src/components/player/{WatchPartyDrawer,WatchPartyToast}.tsx`, `src/components/{PartyInviteListener,JoinPartyModal}.tsx`, `src/context/UserSocketContext.tsx`.
- **Mirrors:** the WINDOWS app — `apps/blissful-mvs` `watchParty.ts` + `useWatchPartyMpv.ts` + `components/WatchParty/*` + `UserSocketProvider` (NOT OpenCode; it lacks useWatchPartyMpv).
- **Protocol:** `/ws/room` (sync) + `/ws/user` (invites; `{t:'auth',token}` first frame) + REST under `getStorageBaseUrl()`. Control democratised; host-only = 2 Hz tick / episode / transfer. Sync = playback-rate MICRO-CORRECTION (rate 1 within 0.4s; nudge up to ±12% for 0.4–4s; hard seek >4s with 2.5s cooldown) — expo-video seeks are janky, do not regress to seek-only drift. `applyHostTick` reconciles TIME ONLY — never play/pause (it froze guests). Join is non-destructive: a promoted/rejoining host ADOPTS the room `lastTick`; members ignore a fresh joiner's events for 4s; the joiner self-suppresses outbound 2s; the join seek retries (expo-video drops pre-load `currentTime=`).
- **TV adaptations:** no clipboard — show the code LARGE + invite-link text; inputs = Pressable→inner TextInput→IME; chat reactions = focus-reveal emoji row. Invite pills (PartyInviteListener) = poster + eyebrow + title + Join/Accept, 60s TTL, navigate via `navigationRef`. NavRail "Join Party" opens `JoinPartyModal`; the friends accordion shows "Join party" when `activeParties` has the host.
- **Open items:** guest-name prompt missing (guest without a stored name never connects); `isInviteOverlayActive()` exists but PlayerScreen doesn't consume it (OK double-fire risk); 2-client sync + invite-pill appearance unverified (needs 2 devices).
- **Verify:** create a room in the drawer (status pill shows code); join via NavRail with the code; invite pill → player joins with real title/art.

## Friends, presence & profiles

- **Files:** `src/lib/{friends,presence,activeParties}.ts`, NavRail `FriendsBody`, `src/screens/ProfileScreen.tsx`, `src/components/FriendAvatar.tsx`.
- **Mirrors:** web `pages/ProfilePage.tsx` (profile) + the Windows friends/ActiveParties providers.
- **Decisions:** a friend row is an inline ACCORDION in the rail (a centered modal was REJECTED): OK expands → View profile / Request party (online+watching) / Join party (when an active party exists) / Nickname (inline field) / Remove. Requests keep ✓ accept + ✕ decline. Presence heartbeat 30s from App; PlayerScreen sets/clears `currentActivity` ("watching X"). Profile route = `Profile {userId, displayName?}` — header + "Recently watched" rail → Detail (friends-gated endpoint).
- **Verify:** party/invite paths need a 2nd account online; accordion actions + rail Right-to-close must not regress.

## Discover

- **Files:** `src/screens/DiscoverScreen.tsx`, `src/lib/addons.ts` `loadAllAddonCatalogs` (raw `/manifest.json` per addon, 5-min cache).
- **Mirrors:** the Windows app's unified Discover (all addons aggregated in one page).
- **Decisions:** Type selector = distinct catalog types across all addons (Movie/Series/Channel/Anime/…); Catalog = that type's catalogs across addons; Genre = the selected catalog's manifest `extra.options` — NOT item `genres[]` (Kitsu items return empty). Genre re-fetches `/catalog/{type}/{id}/genre=X.json`; pagination via `skip` on scroll-end. A home row's See All PRE-SELECTS that catalog; the bare nav entry defaults to the first catalog of the default type.
- **Verify:** Kitsu Most Popular exposes ~61 genres, Trending none; Cinemeta Popular paginates on scroll-end; Home chip lands pre-filtered.

## Library

- **Files:** `src/screens/LibraryScreen.tsx`, `src/components/{LibraryPosterCard,LibraryActionOverlay}.tsx`.
- **Decisions:** hold-OK on a poster → `LibraryActionOverlay` — a root-level box at the card's MEASURED rect (same pattern as HomeActionOverlay; compact buttons tuned for the narrow 2:3 poster), Remove-from-library inside a FocusTrap; Back closes (screen owns the state).
- **Gotchas:** hold-OK must come from `longSelect` (see focus record); test with a real remote — adb longpress is flaky.
- **Verify:** hold OK → on-poster overlay; remove updates the grid.

## Search

- **Files:** `src/screens/SearchScreen.tsx` — opened from the NavRail (item 0).
- **Decisions:** Search lives in the rail, not a topbar (immersive-home decision). Result rails drop `getItemLayout` and carry ~`m.s(20)` left padding so the focused card's scale isn't clipped at the viewport edge (getItemLayout makes Android ignore paddingLeft; re-add only with the pad folded into the offset).
- **Verify:** rail → Search → IME input → result rails navigable, first card's ring not clipped.

## Settings

- **Files:** `src/screens/SettingsScreen.tsx`, `src/components/settings/{PillButton,ColorSwatchRow,SubtitleColorPicker,TvTextField,TvToggle,AppearancePreview,SettingsStremioPanel,SettingsTraktPanel}.tsx`, `src/components/TvSelect.tsx`, `src/lib/{tvSettings,settingsLeftTarget}.ts`.
- **Mirrors:** the old app's SettingsPage — two-column: category list left, panel right.
- **Decisions:** the active category switches on OK, NEVER on focus (focus-driven `hasTVPreferredFocus` = infinite loop + crash). The panel's left edge routes Left to the active category via `SettingsLeftTargetContext` (and suppresses rail-open); `TVFocusGuideView autoFocus` lands Right from the categories onto the panel's first control; dropdown overlays return focus via `requestTVFocus()`. Accent presets = the original 10 SOLID colors incl. black — no gradient swatch (reverted feature).
- **Trakt:** INERT until `lib/traktConfig.ts` creds are filled; device-code OAuth via core (`traktApi.ts`).
- **Verify:** OK switches category; Left from a mid-row control goes to the previous control (geometry), only the edge reaches the categories.

## Addons screen

- **Files:** `src/screens/AddonsScreen.tsx`, `src/lib/addons.ts`.
- **Decisions:** manages the stored `state.addons` (same doc the Windows app uses — changes propagate both ways and feed home rows/Discover/stream picker).
- **Verify:** install by URL → addon appears here + its catalog row shows on Home (per Customize Home prefs).
