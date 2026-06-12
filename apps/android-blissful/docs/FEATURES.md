# Blissful TV (RN) — Feature Registry

One structured record per screen / feature of `apps/android-blissful`, so a fresh session knows the files, the reference being mirrored, the deliberate decisions, and the landmines — without re-discovering them.

**Rules**

- **Before** working on a feature: Grep this file for its heading and read that record (plus *Cross-cutting: D-pad focus* — it applies everywhere).
- **After** adding/changing behaviour, or discovering a decision/gotcha: update the record in the same change. Records describe **current state** — git is the changelog.
- Keep a record ≤ ~15 lines: pointers, decisions, gotchas, verify. Never prop lists or style values — the code says those. If a record outgrows this, move the detail to its own doc and link it.
- **Mirrors** = the reference implementation to read before changing anything (see root `CLAUDE.md` "Reference apps & terminology": Windows app = `apps/web-blissful` + `apps/desktop-blissful`, web = `D:\JS\OpenCode`).
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
- `useTvFocusable({atRowStart, autoFocus, onPress, …})` → `{focused, focusProps}`; spread on a Pressable, style off `focused`. It ALSO reads `useSettingsLeftTarget()`: at a row start it routes Left to the Settings category when under that provider, else self-traps for the rail — so the shared `ui/Button`/`Chip`/`IconButton` work in both contexts with no per-call wiring. (`TvSelect` keeps an inline copy of this block because it needs its own ref.)
- **Modals:** wrap the panel in `FocusTrap` (TVFocusGuideView, trap all 4 directions + autoFocus); backdrop Pressable `focusable={false}`. FocusTrap registers in `overlayStore`, so NavRail's global open-on-Left no-ops over modals. Modals with TextInputs ALSO need the background inert (`useContentInert()` = rail open || login open — the IME flings D-pad focus past the trap), in-tree rendering (App-level siblings don't trap), Pressable-wrapped inputs (`hasTVPreferredFocus` on a bare TextInput doesn't grab), and `onSubmitEditing` guarded on filled fields.
- **Gotchas (each cost a session):** a standalone `<Modal>` gets focus but its onPress no-ops AND hardware Back falls through (exited the app) → use in-tree overlays, or one Modal with internal mode switches. `hasTVPreferredFocus` must NEVER track focus-driven state (infinite focus loop → crash; switch selection on OK, not on focus). `isTVSelectable` cascades — flip ONE container per screen, not per card (per-card flips made rail-open take 1.5s). Hold-OK = the `longSelect` TV event via `useTVEventHandler` (`Pressable.onLongPress` never fires for OK); guard the paired onPress with a consumed-ref. `adb keyevent --longpress 23` is flaky; tight scripted sequences mis-order — use ≥1s gaps or the real remote.
- **Verify:** every focus change by driving + screencap; focus must never land behind an overlay.

## UI primitives (ui/)

- **Files:** `src/components/ui/{Chip,Button,IconButton,MenuActionButton}.tsx`, the unified `src/components/PosterCard.tsx`, plus `src/components/{Rating,TvSelect}.tsx`. All call `useMetrics()` internally + focus via `useTvFocusable`; variants follow `Rating`'s model (a `size`/`variant` enum, exact 1:1 visuals — no generic UI).
- **`Chip`** — pill. With `onPress` → focusable (lavender ring; `active` = white fill + ink text); without → a static label tag (Addons resource pills). `size` sm (genre/cast) / md (filters). `ChipRow` maps a string[] → a wrapping chip row.
- **`Button`** — pill action (optional leading icon). `variant` glass (secondary / Back pills / modal secondary) / solid (white CTA: Save/Login/confirm) / accent (Detail "Watch"); `size` sm (h40) / md (h52); `disabled`/`busy`/`wrap`/`fullWidth`/`atRowStart`.
- **`IconButton`** — round icon-only (Detail season/range chevrons); `size` sm/md, `disabled` dims + non-focusable.
- **`MenuActionButton`** — the hold-OK overlay action: rounded-rect that FILLS with accent on focus (a stronger affordance than the ring family); `danger` (Remove progress), `wrap` (narrow portrait poster). Shared by Home + Library action overlays.
- **`PosterCard`** — THE poster card (absorbed the deleted `LibraryPosterCard`): `width` knob + `POSTER_W` presets, skeleton shimmer, IMDb badge (top-left), progress bar, `onFocus` (drives the ambient backdrops on Discover/Library), and optional `active`/`onActiveRect`/`onBlur` for the hold-OK rect measurement. `variant`: `portrait` (2:3, centered title below — Search/Detail) or `landscape` (16:9, image zooms inside a fixed frame on focus; art = `fetchTmdbBackdrop` server-keyed TMDB + `metahubPosterToBackdrop`/poster fallback). `titlePlacement` (landscape): `inside` over a bottom scrim / `below` left-aligned / `none`. IMDb badge top-left, opt-out via `hideRating`. Home = landscape + inside + `hideRating`; Discover/Library = landscape + inside, 4 per row (their screen heading was removed — the NavRail marks the page). The old `LandscapeTile` is DELETED; `nextFocusUp` routes Home's top row to the avatar; Home gates rail-open via ONE container (not per-tile).
- **`TvSelect`** — select/dropdown (behavior unchanged) + a `size` sm/md variant.
- **Decisions:** migrated app-wide (Detail/Settings/overlays/modals/Addons → these primitives). The player's internal virtual-index controls (`PlayerControls`, `WatchPartyDrawer`, `SubtitleMenu`, `EpisodesDrawer`) are intentionally NOT migrated (different focus model). `useTvFocusable` folding in the settings-left-target (see focus record) is what makes one Button/Chip work in both Settings and elsewhere.
- **Verify:** Library/Detail/Settings/modals — chips/buttons focus with the lavender ring + press fires; Settings Left from a panel control still reaches the active category; `tsc --noEmit` clean.

## NavRail (sidebar)

- **Files:** `src/components/NavRail.tsx`, `src/lib/{railStore,focusBus,contentFocus}.ts`. Hosts `LoginModal` + `JoinPartyModal` in-tree (returns a Fragment so they aren't clipped by the rail's overflow).
- **Model:** collapsed rail NOT focusable; opens ONLY on D-pad Left while resting (>130ms age gate in focusBus) on a content row's left-edge element; closes ONLY on Right — no auto-collapse. While open, content is inert via ONE `isTVSelectable={!railOpen}` container per screen.
- **Decisions:** Search is the FIRST nav item (moved out of the topbar in the immersive redesign). Flush full-height panel — transparent collapsed but with an always-on super-subtle right hairline so the rail's edge reads (the same hairline tone draws the two in-panel dividers, below the logo + above Friends); dark `NAV_PANEL` (near-black `rgba(10,11,15,0.99)`, deliberately darker/less-blue than the design) + brighter right border + gently-rounded top-right/bottom-right corners when expanded (the old floating glass pill is gone). Nav focus = an accent BORDER ring only (always-present transparent border recoloured on focus, so nothing shifts); icon/label keep their resting colour — NOT a solid fill. Inactive icons `textDim`, active page `accent`; the Friends icon is always `textDim` (only its request-count badge is accent). Friends accordion lives in the expanded panel — see *Friends* record.
- **Gotchas:** tvos sometimes swallows a 2nd consecutive Left on the very first grid cell (fix if needed: self-referencing `nextFocusLeft` on edge cards). The global open-on-Left handler must early-return on `isOverlayOpen()` — it used to open the rail behind modals.
- **Verify:** Left at a leftmost tile opens; Up/Down cycle rows; Right closes; with a modal open, Left must NOT open the rail.

## Auth, login & profile menu

- **Files:** `src/context/AuthContext.tsx`, `src/components/{LoginModal,ProfileMenu}.tsx`, `src/lib/{loginStore,avatars}.ts`. `LoginScreen.tsx` is DELETED — login is a modal.
- **Decisions:** login opens via `loginStore` (modelled on railStore) and renders inside NavRail gated `useLoginOpen() && useIsFocused()`. `ProfileMenu` is an in-tree absolute overlay at a FULL-SCREEN root (zIndex 200), NOT a `<Modal>` — Modal didn't capture hardware Back (app exited to launcher). The avatar picker is a MODE SWITCH inside ProfileMenu, not a second Modal (a second Modal's onPress silently no-ops on tvos). ProfileMenu also hosts the "Customize Home" row.
- **Gotchas:** LoginModal is the canonical TextInput-modal case — see the focus-system record. Set `cursorColor`/`selectionColor` to accent or the caret renders brand-teal.
- **Verify:** avatar → login modal; D-pad cannot escape to tiles behind; Back closes keyboard, then modal. Emulator: pull the JWT via `run-as com.blissful.tv.rn` (MMKV `files/mmkv/bliss`) to hit the storage API directly.

## Home (immersive)

- **Files:** `src/screens/HomeScreen.tsx`, `src/components/home/{HomeHero,LandscapeRail,HomeTopRight,HomeActionOverlay,homeData,useFocusedMeta}`, `src/lib/tmdbArt.ts`. Rows render the shared `PosterCard variant='landscape'` (the old `LandscapeTile` was deleted). `useFocusedMeta` (debounced no-flash focused-item meta + shared `metaCache`) is shared with Discover's ambient backdrop.
- **Mirrors:** `design/home/` JSX mockup + the user's prototype SCREENSHOT — when they disagree, the SCREENSHOT wins (the clock+avatar exist only in it; the JSX's nav-hint pill was removed on request).
- **Model:** full-bleed Backdrop + InfoPanel FOLLOW the focused tile (fetchMeta debounced 180ms; `metaCache`; `focusedMeta = {key, meta}` NEVER null-cleared — nulling = flash). Lower band of 16:9 landscape tiles focus-scrolls: `ROW_STEP` must equal the REAL rendered row height (380); band paddingTop 0; ScrollView paddingBottom `m.height`; the focused tile's IMAGE zooms inside its fixed frame (footprint unchanged → the row never reflows or clips).
- **Decisions:** NO topbar — top-right is a live clock + avatar (avatar reachable via published findNodeHandle → genre chips' `nextFocusUp`). NO Play/Watchlist CTAs in the InfoPanel: OK on a tile → Detail (CW tiles → Resume modal first); HOLD OK → `HomeActionOverlay`, a root-level box at the tile's MEASURED window rect (library Add/Remove + CW Remove-progress). Genre chips navigate to Discover. Tiles = shared `PosterCard variant='landscape'` with `hideRating` (fixed frame + accent ring, image zooms inside on focus, title over scrim — NO IMDb badge on Home); art = `fetchTmdbBackdrop` (server-keyed `/tmdb-find` first, ACCOUNT tmdb key fallback) → metahub/poster. Rail-open gated by ONE container (`isTVSelectable={!railOpen}` on the rows band), not per-tile. Rows: CW + Popular Movies + Popular Series + addon rows.
- **Gotchas:** `cwReady` gates the band render + backdrop seed (CW resolving late stole focus = backdrop flash). The same title can sit in 2 rows — gate the overlay measure on `focused` or the off-screen twin clobbers the rect. The Backdrop keeps the previous art while new meta resolves and advances a candidate list on `<Img onError>` (fanart 404s → poster fallback).
- **Verify:** Right → backdrop/InfoPanel follow + kicker flips; Down → band scrolls flush; hold-OK on a CW tile → on-poster overlay; chip → Discover pre-filtered.

## Home addon rows & Customize Home

- **Files:** `src/lib/homeRows.ts` (row IDs byte-identical to web), `src/components/home/{useAddonRows,CustomizeHomeModal}.tsx`; prefs I/O in `src/lib/addons.ts` (`/state.homeRowPrefs` + kv cache).
- **Mirrors:** blissful-mvs home rows + home-settings modal. `homeRowPrefs` is SHARED with the Windows app via the same `/state` doc — verified round-trip on device.
- **Decisions:** one row per addon's FIRST catalog, fetched DIRECT (no `/addon-proxy` on RN); Cinemeta excluded (would duplicate the Popular rows); CW stays pinned top, outside the prefs order. Entry point = ProfileMenu "Customize Home" — the user REJECTED a top-bar icon next to the clock.
- **Perf (SWR cache):** `useAddonRows` paints the last good addons+rows snapshot from MMKV (`blissAddonRows:v1`) synchronously on mount, then revalidates — rows land PROGRESSIVELY per addon (one slow addon, usually Kitsu, no longer blocks the rest), a down addon keeps its cached descriptor+row, and a pass with zero fresh rows never overwrites the cache. Stale rows of uninstalled addons are harmless — HomeScreen renders only ids present in `homeRowOptions` (live `addons`).
- **Gotchas:** addon-row meta prefetch uses 2 workers (4 starved the focused item's fetch and lagged the backdrop). Row "See All" → `navigate('Discover', {type, transportUrl, catalogId, title})`.
- **Verify:** Anime Kitsu row renders with backdrops; SECOND launch shows it instantly (cache) and refreshes silently; hide/reorder persists and matches the Windows app's hidden rows.

## Continue Watching & resume

- **Files:** `src/lib/continueWatching.ts`, `src/components/ResumeModal.tsx`, HomeScreen CW row + the black `BufferingVeil` pre-nav veil.
- **Decisions:** NO `!removed` filter (web semantics — soft-removed items keep progress and still show). Resume/Start-over resolves the REAL title (meta + streams) behind a black+logo veil; the logo is set on META resolve and cached per title (`cwLogoCache`) so it merges seamlessly into the player's buffering veil. Remove-progress (hold-OK) zeroes `state.timeOffset/duration/timeWatched/lastWatched` — keeps the library row, drops it from CW (OpenCode `useContinueWatchingActions` semantics).
- **Verify:** resume an episode → veil with logo → player at the saved position; remove progress → leaves CW, stays in Library.

## Detail

- **Files:** `src/screens/DetailScreen.tsx`, `src/lib/metaResolver.ts`, `src/components/{Hero,Rating,ItemsRail}.tsx`; shared `ui/{Chip,Button,IconButton}` (genre/cast = `ChipRow`, Watch = `Button variant="accent"`, Add/Trailer = `glass`, season+range steps = `IconButton`). Only the bespoke `EpisodeCard` stays inline.
- **Mirrors:** blissful-mvs DetailPage; episode stills follow the Windows/OpenCode server-keyed TMDB approach.
- **Decisions:** meta via `resolveMeta` (NOT bare fetchMeta): prefix-owning addon first (`kitsu:` → Kitsu), then all installed addons, then Cinemeta; retry `anime`→`series` (load-bearing for Kitsu); `isSeries` must include `'anime'`. Episode stills/ratings: backend `/tmdb-find?imdbId` + `/tmdb-season-info?tmdbId&season` (server-keyed, no account key), mapped by ABSOLUTE episode position (TMDB and Cinemeta disagree on season boundaries, esp. anime), cached per season.
- **Gotchas:** poster-flash prevention is URL stability — `metahubPosterToBackdrop` keeps the Image source byte-identical when meta lands, but ONLY for metahub (Cinemeta) titles; for addon titles (Kitsu) it returns null. The backdrop candidates must therefore NOT include the raw `params.poster` (a PORTRAIT): painting it stretched across the landscape backdrop and then swapping to `meta.background` (a fanart.tv landscape) is the "wrong poster flashes to the right one after a second" bug — leave the scrim dark until the real backdrop fades in (`transition`). The bottom episodes row needs a marginBottom (a flex spacer pins it to the screen edge); the episode-range `TvSelect` minWidth must fit "Ep 1101–1150"; `TvSelectOverlay` flips upward when the trigger is low.
- **Verify:** S2+ episode stills are unique (not the show poster); a Kitsu title shows background/genres/episodes — including after Back from the player (no portrait-poster flash, episode list populated).

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
- **Decisions:** buffering = FULL chrome immediately + the title's landscape-logo pulse overlay (below the controls' zIndex, never a blocking sheet) + `--:--` scrub; VideoView opacity 0 until revealed (duration > 45s — the DMCA-placeholder gate; shorter → auto-advance to the next stream). Controls auto-hide is INTERVAL-driven, not setTimeout (setTimeout doesn't reliably fire on TV): activity stamps `lastActivityRef`, the tick hides after 3.5s when revealed && !paused && no drawer. Back (`exitToDetail`) = `navigation.reset` to [Home, Detail(detailId)] — never goBack; carry the SHOW id as `detailId`, and carry the played episode's season/episode (from the matched `currentEp` in the loaded meta, via `currentEpRef`) so Detail opens FOCUSED on it — correct for every addon incl. Kitsu. Do NOT derive the season by parsing the episode id: Kitsu ids are `kitsu:showId:ep` (no season), so reading parts[-2] passes the numeric show id (48363) as the season → Detail's list comes up empty. The `tt…:S:E` id parse is only a fallback for before the meta list loads. Bottom row: series `[play,next,episodes,subtitles,audio,releases]`, movies omit next/episodes — never mutate the array mid-mount (virtual index shifts). Track labels derive from the language CODE (`subtitleLangLabel`) — engine labels arrive device-localized. Badges RD/4K/HDR top-right + Watch Party pill. PauseOverlay shows the CURRENT EPISODE info for series (incl. per-episode TMDB rating).
- **Verify:** on the REAL TV — buffer shows chrome+logo; OK toggles correctly right after a seek; Back lands on Detail; chrome auto-hides after 3.5s.

## Player: subtitles

- **Files:** `src/lib/{subtitles,subtitleCues}.ts`, `src/components/player/{SubtitleMenu,SubtitleOverlay}.tsx`; styling prefs via Settings `SubtitleColorPicker` + player settings.
- **Why a custom overlay:** expo-video v56 cannot attach external subtitle URLs to a source — external subs are fetched from addons, parsed to cues, and rendered by `SubtitleOverlay` ON TOP so the saved colour/background/outline/size apply. Embedded tracks still go through `player.subtitleTrack`/`availableSubtitleTracks`.
- **Decisions:** the preferred subtitle auto-loads + a single "Subtitles loaded" toast — gated on `revealed` (the auto-load effect bails until the file passes the DMCA gate), so the releases the player auto-advances PAST don't each re-toast (extTracks is content-keyed and always present, so without the gate every url-reset re-fired). The drawer has 2D D-pad nav and OK on X closes it; labels from language code (see Player record).
- **Verify:** subs drawer → pick an external language → styled cues render; reload the file → preferred auto-loads + EXACTLY ONE toast (even when the player skips past dead releases first).

## Player: episodes drawer & next-episode

- **Files:** `src/components/player/EpisodesDrawer.tsx`; `seriesVideos` (episode list), `switchToEpisode` + binge logic in `PlayerScreen.tsx`.
- **Episode list source:** `seriesVideos` resolves the show meta via `resolveMeta('series', detailId, token)` (the addon-routed resolver, same as Detail) — NOT raw `fetchMeta`, which defaults to Cinemeta and 404s for addon ids like Anime Kitsu's `kitsu:NNN`, leaving the drawer "No episodes found".
- **Mirrors:** the web/Windows COVERFLOW drawer — right-anchored transform stack (focused card 1.15 + white ring + description + WATCHING badge; neighbours scale/darken), header pills [Search | Season ▾ | Auto play] + X, panel vertically centered maxH `m.s(800)`.
- **Decisions:** VIRTUAL focus — one Animated.Value drives translate + per-card scale/darken; render slice focus±6 (Kitsu 1000-ep safe); opens at the CURRENT episode; the season pill opens a DROPDOWN zone (not a cycle); the search TextInput is focused imperatively (`isTVSelectable={false}`). A "Season N" title+overview block scrolls inside the stack; per-episode runtime + overview come from the server-keyed `/tmdb-find` + `/tmdb-season-info` (direct per-season fetch, NOT the Detail mapping), module-cached.
- **Closing (do NOT add a FocusTrap):** unlike the Settings/Watch Party drawers, this one drives ALL D-pad via `useTVEventHandler` (the coverflow animation fights native focus). A `FocusTrap` here CONSUMES the directional events the virtual nav needs — verified it breaks Up/Down. Instead: Left closes from the list AND from the header's left-most item (`hIdx<=0`), so you can't get stuck pressing Left; and PlayerScreen swallows select/playPause for 450ms after a close (`drawerClosedAtRef`) so the OK that closes via X can't bounce back into the episodes button (TVs emit select+playPause / a double select per OK press). Real-TV "many presses to close" tracks to these; the emulator closes in one press so it can't reproduce it.
- **Next-episode:** `next` is a skip-forward button, DIMMED but kept in the walk when last/unaired (press → "airs <date>" toast). `switchToEpisode` = save progress → black+logo veil → loadStreams → `navigation.replace('Player', …)` (full remount = fresh progress key/subs/badges); no streams → reset to the episode's Detail. Binge auto-advance fires once per file at duration−0.5 (`endFiredRef`, reset on url change), gated on Auto play + next aired.
- **Verify:** drive with ≥1s gaps (tight sequences ghost on the emulator); season dropdown OK-selects; binge advances at credits.

## Watch Party

- **Files:** `src/lib/{watchParty,useWatchPartyRoom,joinWatchParty,activeParties,presence}.ts`, `src/components/player/{WatchPartyDrawer,WatchPartyToast}.tsx`, `src/components/{PartyInviteListener,JoinPartyModal}.tsx`, `src/context/UserSocketContext.tsx`.
- **Mirrors:** the WINDOWS app — `apps/web-blissful` `watchParty.ts` + `useWatchPartyMpv.ts` + `components/WatchParty/*` + `UserSocketProvider` (NOT OpenCode; it lacks useWatchPartyMpv).
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

- **Files:** `src/screens/DiscoverScreen.tsx`; ambient hero via `src/components/home/{HomeHero,useFocusedMeta}`; `PosterCard` rendered `variant='landscape'`, **4 per row** (title INSIDE, IMDb top-left; `onFocus` drives the backdrop); `src/lib/addons.ts` `loadAllAddonCatalogs` (raw `/manifest.json` per addon, 5-min cache).
- **Mirrors:** the Windows app's unified Discover (all addons aggregated in one page), restyled with the immersive Home's STYLE only — ambient full-bleed `Backdrop` of the focused card under a heavy `rgba(7,9,13,0.6)` dim, NO screen heading (the filter pills row only; the NavRail marks the page), no topbar. Deliberately NOT a Home clone: the user rejected the hero InfoPanel + clock/avatar here — a dense many-titles grid is the point.
- **Decisions:** Type selector = distinct catalog types across all addons (Movie/Series/Channel/Anime/…); Catalog = that type's catalogs across addons; Genre = the selected catalog's manifest `extra.options` — NOT item `genres[]` (Kitsu items return empty). Genre re-fetches `/catalog/{type}/{id}/genre=X.json`; pagination via `skip` on scroll-end. A home row's See All PRE-SELECTS that catalog; the bare nav entry defaults to the first catalog of the default type. `focused` re-seeds from item 0 of each page-0 load so the ambient art follows a filter change while D-pad sits on the pills.
- **Gotchas:** the grid FlatList needs an EXPLICIT height — `flex:1` inside the absolute content View lays out at ZERO height (silent empty grid). The page-0 fetch is GATED on `allCats.length || params.transportUrl` — without it a bare nav fetched Cinemeta-top, then re-fetched when `catKey` resolved (a load→flash→reload). Route params are consumed by the useState initializers only — react-navigation 7's navigate() PUSHES a fresh Discover even when one is already stacked (verified: a Detail genre chip stacks a new instance), so a mounted instance never receives new params.
- **Verify:** Kitsu Most Popular exposes ~61 genres, Trending none; Cinemeta Popular paginates on scroll-end; Home chip / See All land pre-filtered; a Detail genre chip opens a re-filtered Discover; the backdrop follows card focus under the dim.

## Library

- **Files:** `src/screens/LibraryScreen.tsx`, `src/components/LibraryActionOverlay.tsx`; shared `PosterCard` rendered `variant='landscape'`, **4 per row** (title INSIDE, + hold-OK props) + `ui/{Chip,Button,MenuActionButton}` + `home/{HomeHero Backdrop,useFocusedMeta}`.
- **Mirrors:** the Windows LibraryPage (Type/sort/watched filters, progress bars, soft-remove) restyled as a Discover SIBLING — ambient full-bleed `Backdrop` of the FOCUSED card under a heavy `rgba(7,9,13,0.6)` dim, NO screen heading (filter pills row only), NO topbar.
- **Decisions:** card focus drives BOTH the hold-OK target ref AND the ambient backdrop (`focused` HomeItem + `useFocusedMeta`, shared with Home/Discover; NEVER null-cleared = no flash; seeded once from cell 0, not re-seeded on the 30s poll). Filters = Type `TvSelect` (atRowStart) + sort `Chip`s + watched `Chip`s (active = white fill). hold-OK on a poster (longSelect) → `LibraryActionOverlay` at the card's MEASURED rect, `MenuActionButton` Remove inside a FocusTrap; Back closes (screen owns state). 30s refresh + optimistic soft-remove (removed:true). Logged-out → a glass panel with Spectral heading + a `Button variant="solid"` Login. `LibraryPosterCard` was DELETED — its hold-OK measurement folded into the shared `PosterCard` (`active`/`onActiveRect`/`onBlur`).
- **Gotchas:** hold-OK must come from `longSelect` (see focus record); test with a real remote — adb longpress is flaky. FlatList needs an EXPLICIT height (flex:1 in the absolute parent lays out at 0 — same gotcha as Discover).
- **Verify:** backdrop follows card focus under the dim; landscape cards 4/row with the title inside; sort/watched/type filters work; hold OK → on-poster overlay; remove updates the grid; Left at the Type select / a leftmost card opens the rail, Right closes it.

## Search

- **Files:** `src/screens/SearchScreen.tsx` — opened from the NavRail (item 0).
- **Decisions:** Search lives in the rail, not a topbar (immersive-home decision). Result rails drop `getItemLayout` and carry ~`m.s(20)` left padding so the focused card's scale isn't clipped at the viewport edge (getItemLayout makes Android ignore paddingLeft; re-add only with the pad folded into the offset).
- **Verify:** rail → Search → IME input → result rails navigable, first card's ring not clipped.

## Settings

- **Files:** `src/screens/SettingsScreen.tsx`, `src/components/settings/{ColorSwatchRow,SubtitleColorPicker,TvTextField,TvToggle,AppearancePreview,SettingsStremioPanel,SettingsTraktPanel}.tsx`, `src/components/{TvSelect,ui/Button}.tsx`, `src/lib/{tvSettings,settingsLeftTarget}.ts`. (`settings/PillButton` was REMOVED — buttons use `ui/Button`, `variant="solid"` for the primary Save/CTA.)
- **Mirrors:** the old app's SettingsPage — two-column: category list left, panel right.
- **Decisions:** the active category switches on OK, NEVER on focus (focus-driven `hasTVPreferredFocus` = infinite loop + crash). The panel's left edge routes Left to the active category via `SettingsLeftTargetContext` (and suppresses rail-open); `TVFocusGuideView autoFocus` lands Right from the categories onto the panel's first control; dropdown overlays return focus via `requestTVFocus()`. Accent presets = the original 10 SOLID colors incl. black — no gradient swatch (reverted feature).
- **Trakt:** INERT until `lib/traktConfig.ts` creds are filled; device-code OAuth via core (`traktApi.ts`).
- **Verify:** OK switches category; Left from a mid-row control goes to the previous control (geometry), only the edge reaches the categories.

## Addons screen

- **Files:** `src/screens/AddonsScreen.tsx`, `src/lib/addons.ts`.
- **Decisions:** manages the stored `state.addons` (same doc the Windows app uses — changes propagate both ways and feed home rows/Discover/stream picker).
- **Verify:** install by URL → addon appears here + its catalog row shows on Home (per Customize Home prefs).
