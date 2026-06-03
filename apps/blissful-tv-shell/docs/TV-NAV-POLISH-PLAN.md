# Blissful TV Navbar + Visual-Polish Plan

> LEFT rail, modal-overlay, expand-on-focus (evidence-backed). Full visual-polish spec. Adversarially verified.

The research is verified against the actual codebase. One note: the home hero on the Classic TV path is `NowPopular.tsx` (report 3, used by HomePage), while `ModernHeroPanel.tsx` (report 2) is the netflix-shell hero — both need the same hero treatment depending on which shell is the TV default. I have everything needed to write the decisive plan.

# Blissful TV Navbar + Visual-Polish Plan

Scope: Android TV, **Classic shell** (sidebar + glass) as the TV default. All three research reports converge; I verified the cited files/lines against the live code (`DesktopNav.tsx`, `NavItem.tsx`, `AppShell.tsx`, `index.css` 2048–2169, `constants.ts`, `HomePage.tsx`, `NowPopular.tsx`). Where reports disagreed I made the call below.

---

## 1. Nav placement decision — LEFT rail, modal overlay, expand-on-focus

**Decision: keep the nav on the LEFT as a vertical rail. Not top, not right, not bottom. Final.**

**Evidence (decisive):**
- **Industry is left-nav for a 6-section + social app.** Mercury's streaming-TV analysis: 6 of 8 major paid streamers use left nav; Peacock and Prime Video both migrated FROM top TO left. Only Apple TV and Hulu remain top.
- **The two recent top-nav migrations both got slammed for the exact remote-ergonomic reasons that would hurt Blissful.** Netflix 2025 (left sidebar → top bar) — TechRadar "borderline unusable," top Reddit complaint is "scroll back up / press Back" on every nav change. Plex Fire TV 2026 (pinnable left sidebar → top overlay) — PiunikaWeb: certain actions went from 2 clicks to ~6, "designed for mouse, not TV."
- **YouTube's May-2026 TV redesign doubles down on the left sidebar** with grouped zones — current direction confirmation.
- **Official Android TV guidance** specifies a LEFT navigation drawer with collapsed (icons) + expanded (icons+labels) states, logo/search at top, 1–3 action buttons at bottom, and a **modal (overlay+scrim)** variant.
- **D-pad ergonomics:** every section stays one LEFT-press from the content grid; Back re-activates the rail on the active item. Top tabs force scroll-to-top-then-Back — the single most-cited backlash complaint.
- Bottom nav is the phone pattern (already used by `MobileNav`); top wastes scarce vertical 10-foot space and competes with the hero.

**Exact behavior:**
- **Two states.** COLLAPSED = icon-only rail, `--tv-rail-collapsed: clamp(104px, 6vw, 140px)`. EXPANDED = icons + labels, `--tv-rail-expanded: clamp(320px, 22vw, 420px)`.
- **Expand trigger = FOCUS, not OK/hover.** When any rail item is Norigin-focused (`data-focused`), set a rail-level `railFocused` flag and widen. Collapse when focus leaves the rail back to content. This replaces today's permanently-expanded TV branch (`DesktopNav.tsx:41` `collapsed = tv ? false`).
- **MODAL OVERLAY, not push.** The expanded panel floats OVER the content with a left-anchored scrim; the home grid never reflows. **This fixes the current bug:** today the always-expanded rail feeds `SIDEBAR_EXPANDED_WIDTH` (`clamp(280px,18vw,520px)`) into `--vertical-nav-bar-size` (`AppShell.tsx:387`), so `--content-left-offset` steals up to 520px of grid width forever. The collapsed rail reserves only the ~120px offset; the expanded panel overlays.
- **Sizing for 10-foot:** icons 32px (up from the `clamp(1.25rem,1.1vw,2rem)` cap in `NavItem.tsx:77`); label `clamp(1.125rem,1.4vw,1.75rem)` IBM Plex Sans semibold (today's `bliss-sidebar-label-text` is `clamp(1.05rem,1.1vw,1.5rem)` at `index.css:2166`); row height `clamp(56px,7vh,84px)` (up from `clamp(2rem,max(3vh,1.6vw),3.25rem)`); min focusable target 48px.
- **Focus return ("up-and-over"):** D-pad LEFT from the leftmost content column lands on the active rail item; Back re-activates the rail on the active destination. Because the collapsed rail still reserves the content offset, cards never sit under it — left-from-card → rail, right-from-rail → content. Restore last-active destination on launch (`useTvFocusable({autoFocus:true})` on the active item).
- **Focus style:** keys off `[data-focused]` (Norigin doesn't call native `focus()`). Reuse `html[data-tv] [data-focused]` (`index.css:2077`): 3px lavender `#95a2ff` outline + dark containment frame + glow. Active item = the persistent `layoutId="nav-active-desktop"` white/8 pill (`NavItem.tsx:61-67`). Active and focused must read distinctly — they already do (pill is fill, ring is outline-based above it).

**Three zones (top → bottom):**
1. **Brand/logo** — top (existing, `DesktopNav.tsx:120-144`). Wordmark visible only when expanded.
2. **PRIMARY (5–6 destinations):** Home, Discover, Library, Addons, Settings. (`Join Party` may stay here or move to the action cluster — keep in primary to hold the action cluster at 3.)
3. **BOTTOM ACTION CLUSTER (`mt-auto`):** **Search, Friends, Profile/Account** (+ Join Party if not in primary).

**Where Friends / Search / Profile / Settings live:**
- **Friends → bottom-cluster rail row** (`FriendsIcon` + "Friends" label + unread badge `friendsIncoming.length`, reuse the white pill at `DesktopNav.tsx:327-331`). On OK → open the existing **`FriendsDrawer` as a full-height focusable modal panel** overlaying content. The inline 11px-label footer accordion (`FriendsAccordion`, `DesktopNav.tsx:195-304`) is desktop-only and unreadable at 10 feet — it's already `tv ? null`; keep it hidden, replace with the rail row. **This fixes the current TV regression where Friends vanishes entirely on TV.**
- **Search → TOP of the rail near the logo** (YouTube/Netflix convention) OR bottom cluster; it routes to `/search` / `Discover`. The `TopNav` search bar is mouse/keyboard-built (HeroUI Dropdown popovers) and must be **hidden on TV** (`AppShell.tsx:455` `<TopNav>` → gate behind `!isTvMode()`).
- **Profile/Account → bottom cluster** (avatar row → opens Who's-Watching). Migrates off the un-focusable `TopNav` account dropdown.
- **Settings → primary zone** (acceptable per Android TV; keep it discoverable as a top-level destination rather than burying it).

**Anti-patterns to avoid:** no top tab bar; no overlay that adds clicks (Plex "2→6"); never icon-only-without-labels at 10 feet; never scroll-to-top-then-Back. Every section one LEFT-press from content.

---

## 2. Navbar redesign — concrete component + CSS changes

**`src/index.css` (add to the `html[data-tv]` block, ~2048–2169):**
```css
html[data-tv] {
  --tv-rail-collapsed: clamp(104px, 6vw, 140px);
  --tv-rail-expanded: clamp(320px, 22vw, 420px);
}
/* Rail reserves only the COLLAPSED width in layout; expanded panel overlays. */
html[data-tv] .bliss-shell {
  --content-left-offset: calc(var(--tv-rail-collapsed) - var(--horizontal-nav-margin, 1rem));
}
html[data-tv] .bliss-vertical-nav {
  width: var(--tv-rail-collapsed);
  overflow: visible;
  z-index: 60;
}
html[data-tv] .bliss-vertical-nav[data-rail-expanded="true"] .bliss-sidebar {
  width: var(--tv-rail-expanded);
  transition: width 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
/* Left-anchored scrim so the grid keeps layout + saved focus. */
html[data-tv] .bliss-vertical-nav[data-rail-expanded="true"]::after {
  content: "";
  position: fixed;
  inset: 0 0 0 var(--tv-rail-expanded);
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);   /* static surface — allowed (see §3) */
  z-index: -1;
}
/* 10-foot hit targets + icon. */
html[data-tv] .bliss-sidebar-link { height: clamp(56px, 7vh, 84px); border-radius: 18px; }
html[data-tv] .nav-icon-slot svg { width: 32px; height: 32px; }
html[data-tv] .bliss-sidebar-label-text {
  font-size: clamp(1.125rem, 1.4vw, 1.75rem);
  letter-spacing: 0.06rem;
}
/* Reclaim vertical space — no TopNav on TV. */
html[data-tv] .bliss-content { top: var(--tv-safe-y); }
```

**`src/layout/app-shell/constants.ts`:** add `SIDEBAR_TV_COLLAPSED = 'var(--tv-rail-collapsed)'` (or reuse `SIDEBAR_COLLAPSED_WIDTH`).

**`src/components/AppShell.tsx`:**
- `navSizeStyle` (line 385-388): on TV set `--vertical-nav-bar-size` to the collapsed/120px token **regardless of `sidebarCollapsed`** so content keeps full width.
- The `--bliss-sidebar-width` effect (184-190): skip the expanded value on TV.
- Gate `<TopNav>` (line 455): `{!isTvMode() ? <TopNav .../> : null}`.
- Thread new props `onOpenSearch` / `onOpenProfiles` down to `SideNav`.

**`src/components/SideNav/DesktopNav.tsx`:**
- Keep labels visible, but **drive expansion from focus**: `const [railFocused, setRailFocused] = useState(false)`; wire `onFocusCapture`/`onBlurCapture` on the nav root; set `data-rail-expanded={tv && railFocused}` on the `.bliss-vertical-nav` host (via ref/handler up to AppShell, or attr on the rail root).
- Replace the `tv ? null` footer (line 195) with a **bottom action cluster** of focusable rail rows: **Search** (`onPress → navigate('/search')`), **Friends** (`FriendsIcon`, badge `friendsIncoming.length`, `onPress → isSignedIn ? setIsFriendsOpen(true) : onOpenLogin()`), **Profile** (avatar → Who's-Watching). Each a real `<button ref={tvRef}>` via `useTvFocusable` so it inherits the lavender ring. **Keep the `FriendsDrawer` mount on TV** (`DesktopNav.tsx:383`). Continue Watching is NOT a rail row on TV — it's the home rail (§4).
- Wordmark (line 134) shows only when `railFocused` on TV.

**`src/components/SideNav/NavItem.tsx`:** rows already carry `useTvFocusable` (line 22) — rely on the index.css TV sizing above. Add an optional action-row variant with badge support for Search/Friends/Profile. The active pill (`layoutId="nav-active-desktop"`) stays; the outline ring reads above it.

**`src/components/SideNav/index.tsx` + `types.ts`:** thread `onOpenSearch` / `onOpenProfiles`.

**Overscan:** the rail panel already sits inside `rounded-[28px] solid-surface`; ensure the collapsed offset + `--tv-safe-x` keep it off the bezel. Keep brand glass (`bg-white/6`).

---

## 3. Visual-polish system — full ruleset

Extend the existing `html[data-tv]` layer (`index.css` ~2048–2169) — it already has the right bones (two-tone ring 2077-2096, `scale(1.08)` 2153, 180ms ease-out 2148, 5vw/4vh overscan 2052-2054). Tighten numbers; do not rewrite.

**Focus ring (keep + formalize) — two-tone, never a single bright ring:**
```css
/* already at index.css:2077 — confirmed correct, keep as canonical */
outline: 3px solid #95a2ff; outline-offset: 3px;
box-shadow:
  0 0 0 8px rgba(0,0,0,0.6),          /* dark containment frame ≥3:1 over bright art */
  0 0 24px 5px rgba(149,162,255,0.55),/* lavender glow */
  0 14px 44px rgba(0,0,0,0.5);        /* lift; large/landscape cards: 0 24px 60px rgba(0,0,0,0.6) */
border-radius: 14px;
```

**Card scale / lift / motion:**
```css
html[data-tv] .tv-focusable-card { transition: transform 180ms cubic-bezier(0.2,0.6,0.2,1); transform-origin: center; }
html[data-tv] .tv-focusable-card[data-focused="true"] { transform: scale(1.08); z-index: 3; }
/* normalize landscape card 220ms→200ms ease-out (index.css:1684); z-index 6 */
/* transition ONLY transform/box-shadow/outline — never width/height/backdrop-filter */
@media (prefers-reduced-motion: reduce) {
  html[data-tv] .tv-focusable-card[data-focused="true"] { transform: none; } /* keep ring only */
}
```

**Hero / billboard (NowPopular):**
```css
html[data-tv] .now-popular-hero {           /* applied via TV branch in NowPopular.tsx */
  min-height: clamp(420px, 52vh, 640px);    /* up from min-h-[280/360/420] line 107 */
  padding-left: var(--tv-safe-x);           /* hero currently ignores left overscan */
}
/* scrim: strengthen for legibility under the lavender ring */
background:
  linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 35%, transparent 65%),
  linear-gradient(to right, rgba(0,0,0,0.7), transparent 55%);
```
- Title → **Fraunces** (NowPopular line 132 currently `font-semibold`; the netflix `ModernHeroPanel.tsx:109` uses off-brand `Instrument_Serif` — replace with Fraunces) `clamp(2rem,3vw,3.5rem)` weight 600 line-height 1.05.
- Synopsis → IBM Plex Sans `clamp(1rem,1.4vw,1.5rem)`, `line-clamp-3`, `max-w ~50%`, `rgba(255,255,255,0.75)`.
- **Primary CTA = teal** `#19f7d2`, black text, `rounded-[28px]`, height `clamp(3rem,3.5vw,4rem)`, `px-8`. CTAs must be `useTvFocusable` (today's NowPopular text buttons render only `@md+` with no ring) — force the TEXT variant on TV, wrap Watch + LibraryActionButton refs, enlarge to `h-14 text-base px-6`.
- **Ken-Burns:** `transform: scale(1.0→1.08)` over 20s `ease-in-out alternate infinite`, varied `transform-origin`, container `overflow:hidden`; disabled under `prefers-reduced-motion`. (NowPopular has `now-popular-bg-motion` on the bg img at line 112 — wire the Ken-Burns keyframes to it.)

**Rails / card sizing (already correct — confirm):** poster `clamp(170px,13vw,230px)` 2:3 (`index.css:2136`); landscape `clamp(17.5rem,24vw,22rem)` 4:3 (`:1670`); gutter `clamp(16px,1.4vw,24px)`; `scroll-padding-inline:var(--tv-safe-x)` (already 2114). **Add `padding-block:12px` to rails** so `scale(1.08)`/lift isn't clipped; row-to-row gap `clamp(2rem,3vh,3rem)`.

**Type scale (5-step, TV minimums):** rail/section title Fraunces `clamp(1.5rem,1.8vw,2.25rem)` (2158); **card title — raise floor to 1.1rem** so it renders ≥24px (today `clamp(1rem,1vw,1.35rem)` 2162); meta 0.95–1.1rem; hero 2–3.5rem; body 1.1–1.5rem; nav labels `clamp(1.125rem,1.4vw,1.75rem)`.

**Spacing / overscan:** `--tv-safe-x:5vw`, `--tv-safe-y:4vh` (2052-2054). **Extend the same insets to the Classic board** — today only `board-content` gets safe-y (2140), and `netflix-*` gets safe-x; the Classic hero's internal left padding is missing. Apply to nav, top edge, rails, hero.

**Color/contrast:** lavender `#95a2ff` = **focus only**; teal `#19f7d2` = **action + progress only** (`--bliss-accent`). Never overlap roles. Text white 0.75–0.9 over scrim ≥0.55 = AA.

**Glass / blur performance policy (the load-bearing rule):**
- **KEEP `backdrop-filter:blur()` only on 2–3 large STATIC surfaces:** the nav rail (`.bliss-sidebar .solid-surface`) + the hero/scrim. **Cap at `blur(12px)`.**
- **DROP it everywhere that scrolls or scales.** `MediaCard.tsx` applies `backdrop-blur-xl` on poster (line 139) and details (line 234) Cards that BOTH scroll AND scale — the single worst case for low-end Android TV GPUs (GPU-recomputes every frame, tanks scroll FPS). Strip under `html[data-tv]`; replace with flat `bg-white/6 + 1px white/10 border`. Cards get depth from shadow + ring, not blur.
- **Never** put `backdrop-filter` on a scroll container or a `transform:scale()` target.
```css
html[data-tv] .tv-focusable-card,
html[data-tv] .netflix-card { backdrop-filter: none !important; background: rgba(255,255,255,0.06); }
```

**Motion timings:** focus 180–200ms ease-out; route/hero expand keeps `cubic-bezier(0.22,1,0.36,1)` 0.55s; keep the 250ms TV meta-fetch debounce (`NetflixRow.tsx:206`) so rapid D-pad travel doesn't thrash fetches; honor `prefers-reduced-motion` globally.

---

## 4. Continue Watching — placement CONFIRMED, no move

**Already correct.** `HomePage.tsx:329-356` renders `<NowPopular>` (hero), then the TV CW `MediaRail` (`isTvMode() && continueItems.length>0`, lines 348-356), then `rowsToRender.map` (line 365) whose first row is `'Popular - Movie'`. So **CW renders immediately above the first movie row.** No structural change.

Polish only: it already carries `className="board-row-poster"` + `noScroll`, so `html[data-tv] .board-row-poster` (2123) converts it to a D-pad rail; `MediaRail` applies `tv-rail-title` to the heading. **One focus-coordination fix:** only ONE `autoFocus` may win per screen. Pick the **hero Watch CTA** as the route-entry focus and drop the first-CW-card `autoFocusTv` (`MediaRail` passes `autoFocusTv={i===0}`) — so first D-pad DOWN lands on CW, then Popular. Avoids the focus-steal described in `useTvFocusable`.

---

## 5. File-edit list (grouped + concrete)

**A. Layout / shell width (fix the rail-steals-content bug):**
- `src/components/AppShell.tsx` — `navSizeStyle` (385-388) + `--bliss-sidebar-width` effect (184-190): use collapsed/120px TV token; gate `<TopNav>` (455) behind `!isTvMode()`; pass `onOpenSearch`/`onOpenProfiles` to SideNav.
- `src/layout/app-shell/constants.ts` — add TV rail width tokens.
- `src/index.css` — add `--tv-rail-collapsed/expanded`, `.bliss-vertical-nav` overlay + expand-on-focus + scrim `::after`, content offset overrides, larger `.bliss-sidebar-link`/`nav-icon-slot svg`, `.bliss-content { top: var(--tv-safe-y) }`.

**B. Navbar:**
- `src/components/SideNav/DesktopNav.tsx` — replace `tv ? null` footer (195) with focusable Search/Friends/Profile rows; add `railFocused` + `data-rail-expanded`; drive labels from focus; keep `FriendsDrawer` mount.
- `src/components/SideNav/NavItem.tsx` — action-row variant w/ badge; rely on TV CSS sizing.
- `src/components/SideNav/index.tsx` + `types.ts` — thread `onOpenSearch`/`onOpenProfiles`.
- `src/components/SideNav/FriendsDrawer.tsx` — promote to focusable full-height TV panel; verify Back/Esc focus return.

**C. Visual polish:**
- `src/index.css` (`html[data-tv]` ~2048–2169) — tighten focus to 180–200ms ease-out; add hero + Ken-Burns rules + `prefers-reduced-motion` guard; strip `backdrop-blur` from `.tv-focusable-card`/`.netflix-card`; cap remaining blur 12px; add rail `padding-block`; raise card-title floor to 1.1rem; normalize `.netflix-landscape-card` 220ms→200ms (1684).
- `src/components/MediaCard.tsx` — remove `backdrop-blur-xl` (139, 234) on TV.
- `src/features/home/components/NowPopular.tsx` — TV branch: taller hero, Fraunces title `clamp(2rem,3vw,3.5rem)`, bigger blurb, stronger scrim, force TEXT CTAs in `useTvFocusable` (h-14), overscan-safe left padding, wire Ken-Burns to `now-popular-bg-motion`.
- `src/features/home/components/ModernHeroPanel.tsx` (netflix shell, if used on TV) — swap `Instrument_Serif`→Fraunces (109), teal CTA (132), Ken-Burns on backdrop (87).
- `src/features/home/components/NetflixRow.tsx` — normalize landscape focus transition; keep 250ms debounce (206).

**D. Continue Watching:**
- `src/pages/HomePage.tsx` — NO structural change (346-356 correct); coordinate single autoFocus: hero CTA wins, drop CW `autoFocusTv`.

**E. TopNav:**
- `src/layout/top-nav/TopNav.tsx` — return null on TV (search + HeroUI account dropdown not D-pad friendly).

---

## 6. Phased plan — biggest visible win first

**Phase 1 — Reclaim the grid + make the rail a real TV nav (highest impact, fixes a live bug).**
Decouple rail width from content (`AppShell` `navSizeStyle` + index.css collapsed offset + overlay scrim), expand-on-focus, gate off `TopNav`. This instantly stops the rail from eating ~520px of every home screen and removes the broken top bar. Files: `AppShell.tsx`, `constants.ts`, `index.css`, `DesktopNav.tsx`.

**Phase 2 — Restore Friends + Search + Profile as focusable rail rows.**
Replaces the `tv ? null` dead footer; brings back the missing social entry point on TV via the `FriendsDrawer` modal. Files: `DesktopNav.tsx`, `NavItem.tsx`, `SideNav/index.tsx`+`types.ts`, `FriendsDrawer.tsx`, `AppShell.tsx` (props).

**Phase 3 — Hero glow-up (NowPopular).**
Tall billboard, Fraunces title, teal focusable CTAs, stronger scrim, Ken-Burns, overscan-safe padding. This is the screen users land on — the single most visible "premium" upgrade. Files: `NowPopular.tsx`, `index.css`, (`ModernHeroPanel.tsx` if netflix-on-TV).

**Phase 4 — Visual-polish ruleset sweep.**
Strip `backdrop-blur` from scrolling/scaling cards (perf win on low-end TV GPUs), normalize focus timings, raise card-title floor, add rail lift headroom, `prefers-reduced-motion` guard, single-autoFocus coordination for CW. Files: `index.css`, `MediaCard.tsx`, `NetflixRow.tsx`, `HomePage.tsx`.

Phases 1–2 are the structural backbone (and bug fix); 3 is the visible "wow"; 4 is the perf + consistency finish. CW (§4) needs no move — only the Phase 4 autoFocus coordination.

**Sources:** Android TV navigation-drawer + focus-system + layouts guides; Smashing Magazine 2025 "Designing for TV"; Amazon Fire TV guidelines; Mercury streaming-TV nav analysis; Netflix (TechRadar/AndroidPolice/Hollywood Reporter) and Plex (PiunikaWeb) backlash coverage; YouTube TV sidebar redesign (9to5Google/AndroidHeadlines); tvOS focus (devsign/Odd Networks); Ken Burns (Wikipedia/Cloudinary); backdrop-filter perf (JT.Createim/shadcn-ui #327). All file/line citations verified against the working tree.