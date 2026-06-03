# Blissful TV Redesign Plan

> Classic-for-TV = default (ships first); Netflix-for-TV = polished alternative. Shared focus/token engine. Full D-pad coverage incl. the detail screen. Adversarially verified.

I now have thorough grounding in the actual code. I have confirmed all the key facts from the research against the source: the UIProvider hard-pin, the DetailPage zero-focusable structure, the NetflixRow Norigin pattern, the `board-row-poster` nth-child hiding, the existing `data-focused` ring at index.css 2077-2083, the tokens, and the ActionButtons plain-button cluster. I'm ready to write the plan.

---

# Blissful TV Redesign Plan

## 1. Design north-star

**One language, two skins, shared focus engine.** Blissful TV is a 10-foot experience built on a single set of TV primitives (focus tokens, overscan, type scale, motion, the Norigin spatial tree). Two visual skins ride on top of those primitives:

- **CLASSIC-for-TV — the DEFAULT, primary deliverable.** This is "Blissful TV." It keeps everything that makes Blissful *Blissful*: the glass `solid-surface` material, `rounded-[28px]` corners, lavender `#95a2ff` + teal `#19f7d2` accents, Fraunces headings + IBM Plex Sans body, and the persistent left sidebar as the navigation spine. The classic shell topology (left rail + horizontal content area of stacked rails) is already the canonical Android-TV / Mercury left-nav pattern — we amplify it at 10-foot instead of replacing it. **Ships first.**
- **NETFLIX-for-TV — a polished alternative.** A genuinely Netflix-quality top-bar + full-bleed-billboard skin for users who want that idiom. It is *not* the default and not a fallback; it's a real second theme that meets the same focus/overscan/type bar. **Ships second**, after Classic-TV is solid.

**How they relate.** Both consume the same `--tv-*` focus/overscan/type tokens (section 2) and the same `useFocusable` patterns mirrored from `NetflixRow.tsx`. The focus ring, scale, glow, motion timings, and social surfaces are identical across themes — only the *shell chrome* differs (left rail vs. top bar; rail-of-cards home vs. billboard home). A user can switch themes on TV and keep the exact same D-pad mental model.

**The unlock that makes any of this real.** `UIProvider.tsx` lines 40-44 and 55-63 currently *hard-pin* `uiStyle` to `netflix` whenever `isTvMode()` — so the classic branch never renders on TV and is unreachable. Step zero of this whole plan is removing that pin and defaulting TV to `classic` (section 3). Without it, the primary deliverable cannot even mount.

---

## 2. Global TV system (shared by both themes)

All of this lives under `html[data-tv]` in `src/index.css` (the existing TV layer starts at line 2048). Today that layer only styles `.netflix-*` classes; we generalize it.

### Focus model
Norigin's `useFocusable` sets `data-focused="true"` on the node (it does **not** call native `focus()`), so all focus styling keys off that attribute. The ring already exists at `index.css:2077-2083` — promote it to a reusable token-driven rule that any focusable surface inherits:

```css
html[data-tv] {
  --tv-safe-x: 5vw;
  --tv-safe-y: 4vh;
  --tv-focus-ring: 3px;
  --tv-focus-offset: 3px;
  --tv-focus-scale: 1.07;          /* cards; nav uses pill, not scale */
  --tv-focus-glow: 0 0 0 3px var(--bliss-accent-glow), 0 24px 60px rgba(0,0,0,.6);
  --tv-focus-teal-inner: inset 0 0 0 1px rgba(25,247,210,.35);
  --tv-motion: 180ms cubic-bezier(.2,.6,.2,1);  /* ease-out, 150-250ms band */
}

/* Generic focusable surface — replaces the netflix-only rule */
html[data-tv] [data-focused="true"] {
  outline: var(--tv-focus-ring) solid var(--bliss-accent);
  outline-offset: var(--tv-focus-offset);
  box-shadow: var(--tv-focus-glow), var(--tv-focus-teal-inner);
  border-radius: 18px;
}

/* Cards scale + lift on focus (transform/opacity only — GPU-cheap, no reflow) */
html[data-tv] .tv-focusable-card[data-focused="true"] {
  transform: scale(var(--tv-focus-scale));
  transition: transform var(--tv-motion), box-shadow var(--tv-motion);
  z-index: 2;
}
```

Rules: **brand lavender ring, never white**; scale 1.05-1.1; glow ~8-32dp; teal as a subtle inner edge so the focus reads as *Blissful*, not generic. Transitions are `transform`/`opacity` only.

### Overscan tokens
Keep the existing `--tv-safe-x: 5vw` / `--tv-safe-y: 4vh`. Apply them as **content insets over full-bleed art**, never as card margins (the current `.netflix-hero` margin bug, section 4). Add `scroll-padding-inline: var(--tv-safe-x)` to every rail so the first/last focused card never sits under the overscan edge.

### Type scale (10-foot floor)
Desktop type is roughly half what TV needs. Add a TV type scale:

```css
html[data-tv] {
  --tv-text-body: clamp(20px, 1.4vw, 24px);   /* 24px metadata/body floor */
  --tv-text-meta: clamp(18px, 1.2vw, 22px);
  --tv-text-card-title: clamp(20px, 1.3vw, 26px);
  --tv-text-rail-title: clamp(28px, 2.2vw, 40px);   /* Fraunces */
  --tv-text-hero-title: clamp(40px, 4vw, 72px);     /* Fraunces */
  --tv-text-nav: clamp(20px, 1.3vw, 26px);
}
```
Rail titles and hero titles in Fraunces; metadata/body in IBM Plex Sans. This is the identity lever at distance — type hierarchy + glass material, not chrome.

### Spacing
Rail gutter 20-24px (`gap: clamp(16px, 1.4vw, 24px)`), generous vertical rhythm between rails (`clamp(32px, 3vh, 56px)`). Budget card `gap` + scale headroom so a focused card's 1.07 growth + glow never collides with neighbors or the rail title.

### Nav model — **sidebar-as-focus-rail (Classic) / top-bar (Netflix)**
- **Classic (default):** persistent left rail, **collapsed icon-only ~5.5rem by default**, expands to Fraunces labels **only while focus is inside it**. Critically: expansion must **overlay** content (animate the rail *over* the rail area, or fix `.bliss-content` left at the collapsed width), NOT push `.bliss-content` sideways — today the width transition shoves the grid on every menu focus. One D-pad press Left from the leftmost card enters the rail; one press Right returns.
- **Netflix:** top bar, but D-pad-reachable (today it's hover-only and too small). Down from the bar enters the billboard.

### Motion
- Focus scale/glow: 150-200ms ease-out.
- Hero/billboard art fade: 400-600ms (today's 1500ms is sluggish at 10-foot).
- Rail card-to-card meta fetch: debounce 250ms (NetflixRow already does this at line 206 — reuse).
- Honor `prefers-reduced-motion`.

---

## 3. Classic-for-TV redesign (the primary deliverable)

### 3.0 — Unblock (must land first)
`src/context/UIProvider.tsx`:
- Initializer (lines 40-44): stop returning `'netflix'` for `isTvMode()`. Default TV to `'classic'` (read stored value, default classic).
- `setUiStyle` (lines 55-63): remove the `isTvMode()` short-circuit that ignores toggles and forces netflix. Persist the chosen style.
- Keep the `data-tv` attribute side-effect at line 68 — that gates the whole CSS layer and must stay.

### 3.1 — Nav (the focus rail)
`src/components/SideNav/NavItem.tsx`: wrap each item in `useFocusable({ focusable: isTvMode(), onEnterPress: props.onPress, onFocus: expandRail })`. Reuse the existing `layoutId="nav-active-desktop"` motion pill (lines 58-64) as the focus affordance — it already slides between rows with a spring; bind it (or a parallel focus pill) to `data-focused`. Bump label to `--tv-text-nav`. Drop the hover Tooltip on TV (lines 85-97) — it's a mouse affordance.

`src/components/SideNav/DesktopNav.tsx`: make the nav list a `FocusContext` boundary (`trackChildren`, `saveLastFocusedChild`), collapse from `focus-within` rather than the manual `#sidebar-toggle` (hide the toggle on TV). **Never focus a hidden item** — when collapsed, focus the visible icon/expander, not the `display:none` label. Surface **Friends** (the existing collapsed-footer icon at DesktopNav ~196-202, with its `incoming.length` badge) and **Continue Watching** as first-class focusable nav targets.

`src/components/AppShell.tsx` (classic branch 428-510): gate `<TopNav>` (453-493) and the mobile bottom-nav `<SideNav isMobile>` (514-528) behind `!isTvMode()`. Stop animating `.bliss-content` left on TV (overlay model — section 2).

`src/layout/top-nav/TopNav.tsx`: retire on TV; move **search** and **profiles/account** into the left rail as focusable destinations (search opens an on-screen-keyboard route, not an inline field).

### 3.2 — Home: hero + rails
`src/pages/HomePage.tsx` classic branch (325-413):
- **Hero (`NowPopular`):** make its Watch / Add-to-list / genre controls `useFocusable` leaves inside a `FocusContext`. Route-entry focus lands on **Watch**. Render full-bleed under overscan insets (don't card-margin it).
- **Rails:** the current `<MediaRail noScroll className="board-row-poster">` (lines 384-405) is **incompatible with D-pad** — `.board-row-poster` is a fixed-N flex row that hides overflow via `:nth-child(n+K){display:none}` (index.css 284-355), so cards 9+ are unreachable. On TV, route classic rows through a **horizontally-scrollable focusable rail** that mirrors `NetflixRow.tsx` exactly: row = `FocusContext` boundary; each card = `useFocusable` leaf with `onEnterPress` → navigate to detail, `onFocus` → `scrollIntoView({inline:'center'})`; first row's index-0 card claims initial focus via `focusSelf()` guarded by `!getCurrentFocusKey()`.

### 3.3 — Cards
`src/components/MediaCard.tsx` poster variant (106-209): add a `useFocusable` wrapper (`focusable: isTvMode()`) and the `tv-focusable-card` class. Re-bind the existing hover affordances to `data-focused`: the `group-hover:scale-110` poster zoom (line 139) and the `group-hover/poster:text-[var(--bliss-accent)]` title recolor (line 206) become focus-driven on TV. Enlarge title to `--tv-text-card-title` and the rating pill (lines 150-155). The existing glass `Card`, `rounded-2xl`, accent progress bar (line 192) already read well at 10-foot — keep them.

`src/components/MediaGrid.tsx` (Discover/Library): its fixed CSS grid needs a 2D-navigable focusable variant on TV so Up/Down/Left/Right traverse the grid (section 5).

### 3.4 — Brand surfaces
Amplify identity, don't add clutter: enlarged Fraunces rail/section headings, IBM Plex Sans metadata, generous negative space, glass `solid-surface` everywhere, lavender+teal as the single accent system, the left rail itself as the signature. This is "Blissful TV," not a Netflix clone.

---

## 4. Netflix-theme polish (the edit list to reach real-Netflix quality)

The Netflix theme is a desktop hover layout with a thin `html[data-tv]` override — it reads broken at 10-foot. Fixes (all in `src/index.css` `html[data-tv]` block + the named components):

**Billboard hero** — `src/index.css` (`.netflix-hero` 1037-1071, TV override 2068-2071) + `src/features/home/components/NetflixHero.tsx`:
- Remove the side margins/radius/radial on TV (lines 2068-2071) — it's currently a bordered inset card. Make it full-viewport artwork under the top bar, `min-height: 80-85vh`, content lower-left over a left+bottom scrim, overscan applied as *content inset* not image margin.
- Play / Trailer / More-Info are plain buttons (NetflixHero 62-77) — wrap the hero in a `FocusContext`, each button `useFocusable` + `onEnterPress`, **Play claims initial focus**.

**Card focus** — `src/features/home/components/NetflixRow.tsx` + `index.css` focus-width (1700-1704):
- Today focus swaps `flex-basis 22rem → 34rem`, reflowing the whole rail. On TV use **fixed flex-basis + `transform: scale(1.06-1.1)`** (the section-2 card rule).
- The in-card overlay stamps non-focusable Play/Info/Trailer buttons on the thumbnail (NetflixRow 99-146; force-shown by index.css 2094-2098). **Hide it on TV** and rely solely on `.netflix-row-details` as the single metadata surface (it already matches Netflix-TV).

**Top bar** — `src/layout/netflix/NetflixTopBar.tsx`:
- Nav `0.9rem` → `--tv-text-nav` (1.4-1.6rem); profile 32px → 48-56px. Make nav items, profile, and search `useFocusable`. Drop the hover-expand search; drop the empty `topbar-left` (line 52).

**Type/motion** — `index.css`:
- Card titles `1.35rem` → 28-36px; meta `0.85rem` → 20-22px; hero fade 1500ms → 400-600ms; focus scale 150-200ms.

---

## 5. Full D-pad focus coverage (per-screen) — DETAIL FIRST

**Foundation:** `main.tsx` already runs `initSpatialNavigation()` under `isTvMode()` (no change). Every screen gets: one `FocusContext` page boundary, a defined **route-entry focus owner**, predictable Up/Down between sections + Left/Right within, every leaf `useFocusable` with `onEnterPress` wired to the handler that already exists, `onFocus → scrollIntoView`, `focusable:false` on disabled controls, `saveLastFocusedChild` for restore, and `pause()/resume()` around HeroUI Modals/Selects (the NetflixRow 216-223 pattern). **Back** maps to the existing `bliss:safe-back` target (DetailPage 753) and never `navigate(-1)`.

### DETAIL (the user's bug — fix first)
`DetailPage.tsx` has **zero `useFocusable`** and `shouldFocusDOMNode` is false → the D-pad reaches nothing. This is the headline fix.
- Wrap the page in a `FocusContext` boundary.
- **Route-entry focus:** movies → **Play** (first action button); series → **first episode** (or Seasons header). Guard with `!getCurrentFocusKey()`.
- **`src/features/detail/components/ActionButtons.tsx` — PRIMARY BUG:** the `DesktopActionButtons` cluster (Play/Library/Trailer/Share, lines 84-129) is plain `<button onClick>`. Make each a `useFocusable` leaf with `onEnterPress = onClick`; add a **Watch Together** focusable button here too (section 6). `focusable:false` when `is-disabled` (e.g. no trailer).
- **Back button** (DetailPage 744): `useFocusable`, reachable via Up from the action row.
- **Streams aside** (DetailPage 819-833 → `DetailStreamsPanel`): make a focus boundary. `SeasonHeader` prev/next arrows + season Select focusable (pause Norigin while the HeroUI Select is open); `EpisodePanel` episode cards focusable (`onEnterPress = onSelectEpisode`); `StreamList` rows + the addon `StreamFilters` Select focusable; `MetaPanel` genre chips + cast pills focusable.
- **Traversal:** Up/Down = back→actions→(meta sections); Left/Right = within the action row and into/out of the streams aside; selecting an episode moves focus into the stream list. Modals (trailer, unreleased-episode, share) pause Norigin and handle BACK to close.

### HOME
Route-entry focus = hero **Watch** (Classic) / **Play** (Netflix). Up/Down: hero → rails → into nav (Left from leftmost card). Left/Right within a rail. Each rail is a boundary; cards are leaves (section 3.2 / 4). Friends "Watching now" rail (section 6) is the top-most rail and fully reachable.

### DISCOVER
`MediaGrid` becomes a 2D focusable grid: Up/Down/Left/Right across cells, `onEnterPress` → detail. Filter/genre/sort controls at the top are a focusable row above the grid; Up from row 0 of the grid lands on filters; Left from column 0 enters the nav rail. Route-entry focus = first grid cell (or first filter if empty).

### SEARCH
Route-entry focus = the search field, which on TV opens an **on-screen keyboard** (no hardware-keyboard assumption). Results render as a focusable grid (same component as Discover). Down from the field enters results; Up returns to the field. History/suggestion chips are a focusable row.

### LIBRARY
Same `MediaGrid` 2D focusable treatment as Discover. Tab/filter row (e.g. movies/series/watchlist) is a focusable row above the grid. Route-entry focus = active tab, then Down into the grid. Empty state shows a focusable "Discover titles" CTA.

---

## 6. Social on TV

All plumbing exists and is platform-agnostic — `FriendsProvider` (`useFriends`), `usePresenceLookup` (30s poll, online + "watching Title — S12E4" via `activityLabel`), `ActivePartiesProvider` (`byHost` open-room map), `requestPartyInvite`/`buildRoomPlayerUrl`, the WatchParty drawer/button. The problem is purely presentation: today social is a dense, hover-driven, text-entry accordion in the sidebar footer, none of it D-pad reachable. **The rule: read-mostly, no chat, no typing, one-press actions.**

**Placement:**
1. **Home "Watching now" rail** — passive, focusable horizontal rail of online friends (large landscape cards via the `NetflixRow` pattern) at the top of Home in both themes, shown when `friends.length && any presence.online`. Highest-value, lowest-effort couch signal; one press → "Join party" (when `byHost` has their room) or "Request to watch together."
2. **Friends nav entry** — a focusable **Friends** target in the Classic left rail (with the `incoming.length` badge) and a **Friends** item in `netflixNavItems` / `NetflixTopBar`. Opens a full-screen, grid-based **Friends & Parties** panel (a new TV-only `TvFriendsPanel` that reuses `FriendsAccordion`'s data wiring but renders large focusable zones — Watching-now / Online / Requests with big Accept/Decline / Add-a-friend). **No inline search box** — add-friend becomes a **code/QR pairing card**. Route the TV "Friends" press here, not to the desktop `FriendsDrawer`.
3. **Detail "Watch Together"** — a focusable button in the Play/Trailer/More-Info cluster (section 5). Opens the existing Open-Room flow; the create button and room-type cards become `useFocusable`.
4. **In-player** — `WatchPartyButton` gets `focusable: isTvMode()` + `onEnterPress` so Up from the controls reaches it. Reuse the People tab; **de-emphasize Chat on TV** (keyboard-bound). Surface room code to share, who's here, join, leave.

**Interaction:** each zone is a `useFocusable` boundary (`trackChildren` + `saveLastFocusedChild`); each row/card a leaf with `onEnterPress` + `onFocus → scrollIntoView`. Replace HeroUI `<Dropdown>` (PersonActionsRow 129-183; WatchPartyDrawer People rows 686-731) with an inline expand-in-place focusable action strip. Kill hover-only affordances (FriendRow Remove is `opacity-0` until group-hover — invisible on a remote). Panel-open focus lands on the first row of the highest-priority non-empty zone (requests → watching-now → friends), guarded by `!getCurrentFocusKey()`. Presence/parties already push live, so the surface updates without input.

---

## 7. File-edit list (grouped, concrete)

**A. Unblock + global system**
- `src/context/UIProvider.tsx` — remove TV→netflix pin (40-44, 55-63); default TV to classic; keep `data-tv` (68).
- `src/index.css` — generalize `data-focused` ring (2077-2083) to all focusables; add `--tv-*` focus/type/spacing tokens; convert `.board-row-poster` (276-355) to a scrollable rail under `data-tv`; make the rail overlay (not reflow `.bliss-content`); Netflix billboard/card/top-bar/type/motion fixes (1037-1071, 1700-1704, 2068-2071, 2094-2098, plus topbar/type lines per section 4).
- `src/main.tsx` — no change (Norigin init already gated); classic components must register nodes.
- `src/lib/platform.ts` — no change (`isTvMode`/`forceTv` gate).

**B. Classic shell**
- `src/components/AppShell.tsx` — classic branch (428-530): focus-expanding rail, stop `.bliss-content` reflow on TV, gate `TopNav` (453-493) + mobile nav (514-528) behind `!isTvMode()`.
- `src/components/SideNav/DesktopNav.tsx` — nav list as `FocusContext`; collapse on `focus-within`; hide `#sidebar-toggle` on TV; surface Friends + Continue as focusable.
- `src/components/SideNav/NavItem.tsx` — `useFocusable` per item; reuse `layoutId` pill as focus affordance; drop hover tooltip; bump type.
- `src/layout/top-nav/TopNav.tsx` — retire on TV; move search/profiles into rail.

**C. Home + cards + grids**
- `src/pages/HomePage.tsx` — classic rows through focusable rail on TV (replace 384-405 `noScroll`/`board-row-poster`); focusable hero (`NowPopular`); add Watching-now rail.
- `src/components/MediaRail.tsx` — TV branch with focusable scrollable rail (don't use the `noScroll` path on TV).
- `src/components/MediaCard.tsx` — poster variant (106-209): focusable wrapper, rebind scale (139) + title recolor (206) to `data-focused`, enlarge type.
- `src/components/MediaGrid.tsx` — 2D-navigable focusable variant (Discover/Library/Search).

**D. Detail (the bug)**
- `src/pages/DetailPage.tsx` — page `FocusContext`; route-entry focus (Play / first episode); focusable Back (744) + aside (819).
- `src/features/detail/components/ActionButtons.tsx` — PRIMARY: focusable Play/Library/Trailer/Share + Watch-Together (84-129).
- `src/features/detail/components/{SeasonHeader,EpisodePanel,StreamList,StreamFilters,MetaPanel,DetailStreamsPanel}.tsx` — focusable rows/controls; pause Norigin around HeroUI Select.

**E. Netflix polish**
- `src/features/home/components/NetflixHero.tsx` — focusable Play/Trailer/More-Info (62-77), Play initial focus.
- `src/features/home/components/NetflixRow.tsx` — drop in-card overlay on TV, scale not flex-basis.
- `src/layout/netflix/NetflixTopBar.tsx` — focusable nav/profile/search, drop hover-expand + empty `topbar-left` (52).

**F. Social**
- New `TvFriendsPanel` (adapt `src/components/Friends/FriendsAccordion.tsx` data wiring; drop search input 178-202).
- `src/components/Friends/PersonActionsRow.tsx` → `TvFriendRow` (replace Dropdown 129-183 with inline strip).
- `src/components/Friends/FriendRow.tsx` — large Accept/Decline; fix `opacity-0` Remove (138).
- `src/components/WatchParty/WatchPartyButton.tsx` + `WatchPartyDrawer.tsx` — focusable controls; de-emphasize Chat on TV.
- Reuse unchanged: `FriendsProvider`, `ActivePartiesProvider`, `lib/useSocial.ts`, `activityLabel.ts`, `FriendAvatar`.

---

## 8. Phased plan

**Phase 0 — Unblock (hours, no visual work).** `UIProvider.tsx`: remove the netflix hard-pin, default TV to classic. Now the classic shell renders on TV for the first time. This alone is a visible change to validate.

**Phase 1 — Testable win: Detail-screen focus + Classic-TV base.** *(recommended first, as the user asked.)*
1. **Detail focus** (section 5 / file group D): wrap `DetailPage` in `FocusContext`, route-entry focus on Play/first-episode, make `ActionButtons` + Back + the streams aside focusable. This directly kills the user's reported bug — the moment they can D-pad the detail screen, they have a concrete win to feel.
2. **Global focus tokens** (file group A): generalize the `data-focused` ring + add `--tv-*` tokens, so everything wired afterward gets brand focus styling for free.
3. **Classic-TV base** (file groups B + C): focus-expanding left rail (NavItem/DesktopNav/AppShell), convert `board-row-poster` → focusable rails on Home, focusable MediaCard. End of Phase 1: a coherent Blissful-TV that boots focused on Home, navigates Home↔Detail end-to-end with the D-pad, and looks like Blissful at 10-foot.

**Phase 2 — Coverage + grids.** Discover/Library/Search 2D focusable grids + on-screen-keyboard search (file group C, section 5). Now every primary screen is fully reachable.

**Phase 3 — Social on TV.** Watching-now Home rail + `TvFriendsPanel` + focusable Watch-Together on Detail + in-player party button (file group F, section 6). Mostly presentation over existing data.

**Phase 4 — Netflix-theme polish.** Billboard hero, card scale-not-reflow, focusable top bar, type/motion (file group E, section 4). Ships the second theme to genuine-Netflix quality once Classic-TV (the default) is solid.

Rationale for the order: Phase 1 gives the user a tangible, testable D-pad experience on the two screens they care about most (Detail bug + Home) before any breadth work; each later phase is additive and independently shippable.