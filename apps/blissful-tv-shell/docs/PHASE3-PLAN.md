# Blissful Android TV — Phase 3 (TV UI) Plan

> Output of the Phase 3 design workflow (Norigin spatial nav + remote keys + overscan/focus), adversarially verified. Browser-testable via a force-TV dev flag.

All research details are confirmed against the source. The seek handlers (2862-2873, 2888-2897), Escape→onBack (2900-2901), auto-hide (1904-1917, 1914-1916 timer), and the white focus-visible ring (1722-1725) all match. I have everything needed to write the plan.

---

# Blissful Android TV — Phase 3 Implementation Plan

**Scope:** add a TV interaction layer on top of the existing `netflix` uiStyle, gated by a single `isTvMode()` boolean. No new theme; classic/modern stay untouched. Focus ring is lavender `#95a2ff` (= existing `--bliss-accent`), not teal.

---

## 1. Browser-testability — the force-TV dev flag

The whole point is that a tester drives the same spatial-nav code in Chrome with arrow keys + Enter + Esc, no device. This works because Norigin binds a single `window` keydown listener using the default keyMap `{left:37,up:38,right:39,down:40,enter:13}`, and an Android System WebView delivers the D-pad as those exact standard `Arrow*`/`Enter` events. So Chrome arrow keys === real D-pad.

**Implementation** — extend the existing platform helper (`src/lib/platform.ts`), which already has `isAndroidTv()` → `isTauri()`:

```ts
// src/lib/platform.ts — NEW
export function forceTv(): boolean {
  if (typeof window === 'undefined') return false;
  const param = new URLSearchParams(window.location.search).get('tv');
  if (param === '1') localStorage.setItem('forceTv', '1');   // persist: RR drops the query string on nav
  if (param === '0') localStorage.removeItem('forceTv');
  return localStorage.getItem('forceTv') === '1';
}
export function isTvMode(): boolean {
  return isAndroidTv() || forceTv();
}
```

Persisting `?tv=1` to localStorage on first read is mandatory — React Router client navigations drop the query string, so without it TV mode silently turns off after the first in-app navigation.

**How a tester exercises it:**
1. `npm --prefix apps\blissful-mvs run dev`, open `http://localhost:5173/?tv=1`.
2. The app hard-pins netflix, mounts the focus tree, and shows the lavender ring on the first card.
3. Arrow keys move focus; Enter activates; Esc = Back (the browser-dev equivalent of the Android hardware Back).
4. To exit TV mode: `?tv=0` (clears the localStorage key) or `localStorage.removeItem('forceTv')` in devtools.
5. Optional spatial overlay: gate Norigin's `visualDebug:true` behind `isTvMode()` in `init()` so the tester sees focusable boxes + scoring.

**Limits a tester must know (still need the device for):** remote key-repeat timing (`throttleKeypresses`), media keys, and the real Android hardware Back wire. Esc in the browser only stands in for Back at the player; the full modal→drawer→exit ladder via the Tauri `back-button` event can only be validated on-device.

---

## 2. Theme pinning — hard-pin netflix, drop classic/modern on TV

Single edit site: `src/context/UIProvider.tsx`.

- **Initializer (line 39-42):** if `isTvMode()` return `'netflix'` regardless of stored value.
- **`setUiStyle` (line 52-55):** if `isTvMode()`, coerce to `'netflix'` / no-op (never write `'classic'`).
- **data-attr effect (line 57-59):** alongside `data-ui`, set `document.documentElement.setAttribute('data-tv', '')` when `isTvMode()` (remove otherwise) so CSS can gate `html[data-tv]` rules.

```ts
const [uiStyle, setUiStyleRaw] = useState<UiStyle>(() => {
  if (isTvMode()) return 'netflix';
  const stored = localStorage.getItem('uiStyle');
  return stored === 'netflix' ? 'netflix' : 'classic';
});
const setUiStyle = useCallback((value: UiStyle) => {
  if (isTvMode()) { setUiStyleRaw('netflix'); return; }
  setUiStyleRaw(value); localStorage.setItem('uiStyle', value);
}, []);
```

**Dropping classic/modern from the TV bundle (no extra deletion needed — pinning does it):** `AppShell.tsx` gates the entire layout on `isNetflix` (line 170). The classic sidebar (`aside.bliss-vertical-nav`, ~433-451), mobile bottom-nav (second `SideNav isMobile`, ~513-528), and mobile swipe rails live only in the `!isNetflix` branch, so pinning netflix removes them outright.

**One required cleanup:** the uiStyle toggle UI (wherever settings/account calls `setUiStyle`) becomes a dead control on TV — hide it when `isTvMode()`. Also stop conditionally mounting the focus tree outside netflix so Norigin's global keydown handler never hijacks arrow keys on classic/modern in a browser.

---

## 3. Spatial navigation — Norigin wiring

**Dependency:** add `@noriginmedia/norigin-spatial-navigation` to `package.json` (verify React 19 peer compat on install).

**init() — `src/main.tsx`, module scope, once.** Place between the `./lib/tauriBridge` import and `createRoot`. Never in a component/effect — the library is a global singleton and React 19 StrictMode double-invokes effects.

```ts
import { init } from '@noriginmedia/norigin-spatial-navigation';
import { isTvMode } from './lib/platform';
init({
  debug: false,
  visualDebug: isTvMode() && import.meta.env.DEV,
  distanceCalculationMethod: 'center',
  throttle: 100,
  throttleKeypresses: true,
  shouldFocusDOMNode: false,   // cards are <div role=button>; drive ring off data-focused (see §5)
});
```

> **Critical focus-model fact:** `useFocusable` does **not** call native `element.focus()` by default. It returns a `focused` boolean and toggles a `data-focused` attribute on the node. So `:focus-visible`/`:focus-within` will **not** fire on D-pad-focused div cards — the ring CSS must key off `[data-focused="true"]` (see §5). The only exception is the search `<input>`, which needs real native focus to receive keystrokes; either set `shouldFocusDOMNode:true` globally and accept the cost, or call `el.focus()` from the search field's `onFocus`.

**Focus tree layers:**

**(a) Screen** — new `src/spatial/SpatialScreen.tsx`. Wrap the netflix branch at `AppShell.tsx` 577-581. Mount the `NetflixTopBar` (533) and the routed `<Outlet/>` (578) as **siblings inside one `FocusContext.Provider`** so D-pad Up from a row reaches the top bar.
```tsx
const { ref, focusKey } = useFocusable({ focusable: true, saveLastFocusedChild: true, trackChildren: true });
return <FocusContext.Provider value={focusKey}><div ref={ref}>{children}</div></FocusContext.Provider>;
```
Keep this strictly inside the `isNetflix` branch.

**(b) Top bar** — `src/layout/netflix/NetflixTopBar.tsx`. Nav items, search toggle, profile, and the in-DOM search-dropdown result/history buttons become focusable leaves inside a top-bar `FocusContext`. The search dropdown is a focus boundary (see modals below); restore to the search button on close.

**(c) Row** — `src/features/home/components/NetflixRow.tsx`. Wrap `<section className="netflix-row">` (129) with `useFocusable({ trackChildren:true, saveLastFocusedChild:true, focusKey:`row-${rowId}`, onFocus: onRowFocus })`. Attach `ref` to the section; reuse the existing `scrollRef` (22) as the horizontal scroller. Return `<FocusContext.Provider value={focusKey}>`.

**(d) Card leaf** — replace the manual div (144-158) wiring (`onMouseEnter`/`onFocus`/`onKeyDown`) with a `useFocusable({ focusKey:`card-${rowId}-${i}`, onEnterPress: () => onItemPress(item), onFocus: onCardFocus, extraProps:{item} })`. Drive the existing `is-focused` class off the returned `focused`. **Keep** `onClick`/`onMouseEnter` for mouse coexistence, but treat hover as a `setFocus(focusKey)` call (single source of truth) — do **not** keep a parallel `focusedId` hover path or the ring and the meta panel will disagree. Wire `onFocus` to the existing `setFocusedId` (150) so the meta-fetch effect (38-65) keeps working.

> Scope card work to `NetflixRow` only. `MediaCard.tsx` (poster variant) feeds the **classic** `MediaRail`, not netflix rows — touch it only if poster rails are reused inside netflix.

**Rail D-pad scrolling (scroll-snap-safe — the crux).** Scroll the rail *programmatically* in the card's `onFocus(layout)`, not `element.scrollIntoView` (which fights snap and double-animates):
```ts
const onCardFocus = useCallback((layout) => {
  scrollRef.current?.scrollTo({ left: layout.x, behavior: 'smooth' });
}, []);
// center-bias: left: layout.x - (scrollRef.current.clientWidth - layout.width)/2
```
`layout.x` is relative to the rail and equals a snap point (`.netflix-landscape-card` has `scroll-snap-align:start`), so `scrollTo` and snap **agree** — no fight. The real hazard is **double-smoothing**: CSS `scroll-behavior:smooth` on `.netflix-rail` + `behavior:'smooth'` in JS both animate. **Fix:** remove `scroll-behavior:smooth` from `.netflix-rail` so JS is the single animator (the arrow-button `scrollBy` at 109 already passes `behavior:'smooth'`, so it keeps working). Vertical row scroll uses the same pattern via `onRowFocus((layout) => contentScrollRef.current?.scrollTo({ top: layout.y, behavior:'smooth' }))`.

**Route-change focus** — new hook `useFocusOnRouteChange`, mounted in `AppShell` only when `isNetflix`. Home catalog rows render **after** route mount (async `useHomeCatalog`), so a fixed first-card `setFocus` can target a not-yet-mounted node:
```ts
const location = useLocation();
useEffect(() => {
  const id = requestAnimationFrame(() => {
    const prior = focusByPath.current.get(location.pathname);     // back-nav restore
    if (prior && doesFocusableExist(prior)) return setFocus(prior);
    const first = `card-${firstRowId}-0`;
    if (doesFocusableExist(first)) setFocus(first);
  });
  return () => cancelAnimationFrame(id);
}, [location.pathname]);
```
Stash `getCurrentFocusKey()` per pathname (a `Map` ref) before navigating away. Belt-and-suspenders: `saveLastFocusedChild` + `autoRestoreFocus` on the Screen lets `focusSelf()` restore the last child if the deterministic key isn't ready. Use the deterministic key scheme `row-${id}` / `card-${id}-${index}` everywhere so `setFocus`/`doesFocusableExist`/`getCurrentFocusKey` target nodes by name.

**Modal focus trap** (HeroUI portal modals + the in-DOM search dropdown):
1. Before open: `const returnKey = getCurrentFocusKey()`.
2. Wrap modal body in a `useFocusable({ isFocusBoundary:true, focusKey })` and `focusSelf()` on open. For HeroUI **portal** modals, mount a `FocusContext.Provider` **inside** the dialog body (the portal is outside the AppShell tree, so D-pad would otherwise tunnel to elements behind it).
3. `pause()` the background tree on open, `resume()` on close (belt-and-suspenders with the boundary).
4. On close: `doesFocusableExist(returnKey) ? setFocus(returnKey) : setFocus(firstCardKey)`.

Modals to trap: NetflixRow trailer (266), HomePage hero trailer (~292), the AppShell account/login/who's-watching/add-addon/home-settings cluster (583+), and the NetflixTopBar search dropdown (in-DOM, not a portal — needs an explicit boundary that opens with `isNetflixSearchOpen` and restores to the search button).

---

## 4. Remote keys + Back

**Key map — no customization needed.** WebView translates raw Android codes 19-22/23 to standard `Arrow*`/`Enter` *before* dispatch. Map against `ArrowLeft/Up/Right/Down` + `Enter`, never 19-23. Norigin's default keyMap already matches. Media keys (Play/Pause 179, Rewind 227, FastForward 228) are unreliable, keyup-only, and absent on some ROMs — bind them on keyup as a bonus only; OK/Arrows are the real transport.

**Back handling — the ladder.** Android hardware Back does **not** arrive as a reliable JS keydown in a Tauri/wry WebView; it's consumed by the Activity's `OnBackPressedDispatcher`. Tauri default (2.9.x): `canGoBack() → goBack()` else **exit app** (issue #14406). Registering a JS listener for Tauri's `back-button` event **suppresses** the default and hands you control:

```ts
import { listen } from '@tauri-apps/api/event';
listen('back-button', () => {
  // priority chain — close top overlay, else player back, else allow exit
});
```

> Verify the exact event name / typed wrapper (`back-button` vs `app.onBackButtonPress`) against the **pinned Tauri version** in the Android port before coding — the surface shifted across 2.x. Add `@tauri-apps/api` as a UI dependency for the Android target.

**Ladder (decisive order):**
1. Any overlay open → close the top-most one, stop. Player overlays in priority: `showPasswordPrompt`/`showNamePrompt`, then `colorModal`, `showUpNext`, `settingsPanelOpen`, `episodesOpen`, `watchPartyOpen`. App-level: account/login/who's-watching/add-addon/home-settings/search dropdown.
2. Else if in the player → call the existing `onBack()` (lines 1956-1963; it navigates to /detail, **not** `navigate(-1)`).
3. Else (top of nav stack) → **allow app exit**. This terminal branch is mandatory — without it, registering the listener makes Back unable to exit the app ever.

Keep the existing `Escape → onBack()` branch (2900-2901) as the **browser-dev** equivalent of Back for force-TV testing.

**Player input rebuild (`NativeMpvPlayer.tsx`), gated by `isTvMode()`:**

- **Stop arrow-as-seek in BOTH sites** (guarding only one leaves a double-seek/black-screen bug — the exact bug the code comments at 2855-2861 warn about):
  - Global keydown effect (2876-2906): guard the `ArrowLeft`/`ArrowRight`→`desktop.seek` branches behind `!isTvMode()`. Keep `Space`/`KeyF`. Keep `Escape`.
  - `onScrubKey` (2849-2874): guard the `Arrow`→seek + `preventDefault()` at 2863 behind `!isTvMode()`. In TV mode let `Left/Right` seek **only when the ScrubBar tile holds spatial focus**, reusing the existing `seekSec`/`markSeekStart`/`broadcastSeek` logic.
- **Reveal controls on key activity:** a remote produces no `mousemove`, so `showControls()` (1904-1917, wired to `onMouseMove`/`onMouseDown` at 3000-3001) would never fire and controls would auto-hide unreachably. In TV mode, **every** D-pad key handler calls `showControls()`, and the 3s idle auto-hide (the `setTimeout` at 1914-1916) is **disabled/paused while focus is inside the controls** (tie the timer to focus state, not mouse idle — otherwise the 3s timer can hide the bar with focus still on it). Set initial focus to the play/pause tile when controls appear.
- **OK/Down behavior:** OK/Enter on a focused control activates it. When the ScrubBar holds focus, `Left/Right` seek and `Up/Down` release focus back to the row. When any other control holds focus, `Left/Right` just move focus. The native `<input type=range>` ScrubBar has built-in arrow handling that competes with both seek and focus-nav — in TV mode make the scrub a **custom focusable** rather than relying on the native input's key handling, to remove the third conflicting consumer.

---

## 5. Overscan + focus rings

**Overscan tokens** (`src/index.css`, `:root` ~15-22). `env(safe-area-inset-*)` returns 0 on Android WebView — use fixed clamps (Android TV guidance ~48dp x / 27dp y):
```css
:root { --tv-safe-x: 0px; --tv-safe-y: 0px; }
html[data-tv] {
  --tv-safe-x: clamp(24px, 5vw, 64px);
  --tv-safe-y: clamp(16px, 3vh, 40px);
}
```
Apply the inset to every edge-bleeding element (the wrapper alone is not enough):
- Netflix content wrapper, `AppShell.tsx:578` — under `html[data-tv]` override the `px-*` utilities with `padding-inline:var(--tv-safe-x); padding-block:var(--tv-safe-y)`.
- `.netflix-topbar` (1446-1462) — `padding-inline: max(2rem, var(--tv-safe-x)); padding-top: max(1.25rem, var(--tv-safe-y))`.
- `.netflix-rail-arrow-left/-right` (1273-1279) — `left/right: calc(0.6rem + var(--tv-safe-x))` so arrows clear overscan.
- `.netflix-rail.netflix-rail-landscape` (~1669-1676), `.netflix-row-title` (~1655-1661), `.netflix-row-details` (~1851-1861) — fold `var(--tv-safe-x)` into horizontal padding so first/last cards and titles sit inside safe-x. Use **padding-inline, not margin**, so the scroll-snap origin math stays inside the scroller; verify the first card isn't clipped (rail sets `scrollLeft=0` on mount at NetflixRow:86).

**Lavender focus ring.** `--bliss-accent` is already `#95a2ff` and `--bliss-accent-glow` `rgba(149,162,255,0.55)` exist (index.css ~20-21) — reuse them; do not inherit the teal `--bliss-teal`. Re-key the existing white ring (1722-1725) off the Norigin `data-focused` signal (keep `:focus-visible` as a browser-tab twin):
```css
.netflix-landscape-card[data-focused="true"] .netflix-landscape-frame,
.netflix-landscape-card:focus-visible .netflix-landscape-frame {
  outline: 3px solid var(--bliss-accent);
  outline-offset: 3px;
}
/* glow on the WRAPPER, not the frame — the frame has overflow:hidden (~1709) and would clip box-shadow */
.netflix-landscape-card[data-focused="true"] {
  box-shadow: 0 0 0 3px var(--bliss-accent), 0 0 18px 4px var(--bliss-accent-glow);
}
/* generic TV ring for nav items, hero buttons, profile, search */
html[data-tv] [data-focused="true"] {
  outline: 3px solid var(--bliss-accent);
  outline-offset: 3px;
  box-shadow: 0 0 0 3px var(--bliss-accent), 0 0 18px 4px var(--bliss-accent-glow);
  border-radius: inherit;
}
```

**Exact `:hover → :focus` twin list** (every hover-only affordance gets a `:focus-within`/`[data-focused="true"]` twin, or D-pad users never see Play/Info — the in-card overlay defaults `opacity:0; pointer-events:none`, a functional dead-end, not just cosmetic):

| index.css line(s) | hover rule | add twin |
|---|---|---|
| 1294-1297 | `.netflix-card-wrap:hover` (lift) | `:focus-within, [data-focused="true"]` |
| 1320-1323 | `.netflix-card-wrap:hover .netflix-card-overlay` (opacity:1; pointer-events:auto) | `:focus-within`/`[data-focused]` variants |
| 1269-1271 | `.netflix-rail-arrow:hover` | `[data-focused="true"]` |
| 1187 | `.netflix-hero-btn:hover` | focus twin |
| 1196 | `.netflix-hero-btn-play:hover` | focus twin |
| 1206 | `.netflix-hero-btn-info:hover` | focus twin |
| 1216 | `.netflix-hero-btn-trailer:hover` | focus twin |
| 1353 | `.netflix-action-btn-play:hover` | focus twin |
| 1363 | `.netflix-action-btn-info:hover` | focus twin |
| 1434 | `.netflix-detail .action-button-Pn4hZ:hover` | focus twin |
| 1544 | `.netflix-nav-item:hover` | focus twin |
| 1830 | `.netflix-overlay-btn-trailer:hover` | focus twin |

> Add twins to **both** overlay families — `MediaCard`'s `.netflix-card-*` AND `NetflixRow`'s `.netflix-landscape-overlay`/`.netflix-overlay-btn` — fixing only one leaves the other row style without D-pad affordances. NetflixRow's `is-focused` overlay (148-149) already shows on focus state, so wiring `useFocusable.onFocus → setFocusedId` keeps it working under D-pad.

---

## 6. File-edit list

**New files**
- `src/lib/platform.ts` — **edit** (add `forceTv()`, `isTvMode()`).
- `src/spatial/SpatialScreen.tsx` — Screen-level `useFocusable` + `FocusContext.Provider`.
- `src/spatial/useFocusOnRouteChange.ts` — `useLocation` + rAF + `setFocus`/`doesFocusableExist`, with the per-path `getCurrentFocusKey()` Map.
- `src/spatial/focusKeys.ts` — naming helpers `rowKey(id)`, `cardKey(id, i)`.
- `src/spatial/useTvBack.ts` (or co-locate) — Tauri `back-button` listener + overlay ladder.

**Bootstrap / theme**
- `src/main.tsx` — add `init(...)` at module scope between the `./lib/tauriBridge` import and `createRoot`.
- `src/context/UIProvider.tsx` — pin netflix in init (39-42) + `setUiStyle` (52-55); add `data-tv` attr in the effect (57-59).
- `package.json` — add `@noriginmedia/norigin-spatial-navigation` and `@tauri-apps/api`.

**Spatial wiring**
- `src/components/AppShell.tsx` — wrap NetflixTopBar (533) + `<Outlet/>` (578) in `<SpatialScreen>`; mount `useFocusOnRouteChange` (isNetflix only); `pause()/resume()` around modals (583+); hide the uiStyle toggle when `isTvMode()`; tv padding on the 578 wrapper.
- `src/features/home/components/NetflixRow.tsx` — Row `useFocusable` on `<section>` (129) + `FocusContext.Provider`; replace card div wiring (144-158) with a card-leaf `useFocusable`; `onCardFocus` rail `scrollTo`; trap trailer Modal (266).
- `src/layout/netflix/NetflixTopBar.tsx` — nav/search/profile + search-dropdown result/history buttons as focusable leaves; search dropdown as a focus boundary restoring to the search button.
- `src/pages/HomePage.tsx` — expose deterministic `firstRowId`/focusKey on the first NetflixRow; trap hero trailer Modal (~292).
- `src/components/MediaCard.tsx` — **only if** poster rails appear in netflix mode (mirror the role=button/tabIndex/onKeyDown leaf).

**Player**
- `src/components/NativeMpvPlayer.tsx` — guard arrow-seek in both 2849-2874 and 2876-2906 behind `!isTvMode()`; `showControls()` on every D-pad key + focus-tied auto-hide (1904-1917); ScrubBar-focused seek; wire the `back-button` ladder reusing `onBack()` (1956-1963).
- `src/components/NativeMpvPlayer/{BottomControls,PlayerControlsBar,ScrubBar,TopOverlay,SettingsPanel,EpisodesDrawer}.tsx` — wrap interactive elements in `useFocusable`; ScrubBar becomes a custom focusable (drop native range key handling in TV mode).

**CSS**
- `src/index.css` — `--tv-safe-*` tokens + `html[data-tv]` block; remove `scroll-behavior:smooth` from `.netflix-rail` (1241-1242); re-key/recolor the ring (1722-1725); the generic `html[data-tv] [data-focused]` ring; overscan insets on topbar/arrows/rail/title/details; all 12 hover→focus twins above.

---

## 7. Test checklist

**Verify in the BROWSER (`?tv=1`, Chrome):**
- App hard-pins netflix; uiStyle toggle hidden; classic sidebar/mobile-nav absent.
- Arrow keys move focus topbar↔rows↔cards; lavender ring visible on every focusable (cards, nav, hero buttons, search, profile).
- Card focus shows Play/Info overlay (focus twin working) and scrolls the rail with **no jank** (single animator — confirm no double-smooth stutter).
- Down/Up scrolls rows vertically into view; route change lands focus on first card; back-nav restores prior focused card.
- Modals/drawers trap focus (D-pad can't tunnel behind); close restores focus to the opener.
- Overscan insets visible (first/last card + titles + topbar + arrows inside safe area).
- Player: Esc = back; arrow keys do **not** blind-seek; ScrubBar-focused Left/Right seeks; controls reveal on key activity and don't hide while focused.

**Still needs the DEVICE:**
- Real hardware Back → full overlay→player→exit ladder via Tauri `back-button` (and confirm the app can still exit at the top of the stack).
- D-pad key-repeat timing under `throttleKeypresses` (browser won't reproduce remote repeat cadence).
- That the WebView actually surfaces D-pad as `Arrow*`/`Enter` on this ROM (keymap shim only if not).
- Media keys (179/227/228) behavior, if bound.
- Overscan against a real TV's physical bezel; `env()` returning 0 confirmed irrelevant since we use fixed tokens.
- `isAndroidTv()`/shell detection routes to `NativeMpvPlayer` (not SimplePlayer) on Android.

---

## 8. Risks

- **Norigin `:focus` vs `data-focused` (biggest trap):** `useFocusable` doesn't native-focus div cards, so any ring written against `:focus`/`:focus-visible` silently never appears on D-pad. All ring CSS keys off `[data-focused="true"]`. The hover-only in-card overlay (`opacity:0;pointer-events:none`) without a focus twin is a *functional* dead-end (invisible AND non-interactive), not cosmetic.
- **Norigin vs scroll-snap / double-smooth:** snap does **not** fight `scrollTo({left:layout.x})` (x = a snap point), but CSS `scroll-behavior:smooth` + JS `behavior:'smooth'` both animate → janky on a slow TV CPU. Mitigation: JS is the single animator; remove CSS smooth on `.netflix-rail`. Adding safe-x padding shifts the snap origin — use padding-inline (not margin) and verify the first card isn't clipped.
- **Norigin vs React Router:** the focus tree rebuilds on each route mount and async catalog rows render *after* mount, so a fixed first-card `setFocus` can miss. Mitigation: rAF + `doesFocusableExist` guard, plus Screen `saveLastFocusedChild`/`autoRestoreFocus` fallback.
- **Player Back/seek conflict:** the seek-on-arrow logic is duplicated (global effect 2876-2906 + `onScrubKey` 2849-2874 + the native range input). Guarding only one site re-introduces the documented double-seek/black-screen bug — all three consumers must be neutralized together in TV mode.
- **Tauri `back-button` regression surface:** the event name/typed wrapper shifted across Tauri 2.x (#14406). Verify against the pinned version. Registering the listener disables default goBack/exit — the ladder **must** have a terminal "allow exit" branch or Back can never exit the app.
- **Auto-hide stranding focus:** the 3s idle timer currently keys off mouse idle; once playing, it can hide controls with focus still inside. Tie the timer to focus state, not mouse.
- **init() under StrictMode:** the singleton double-runs if `init()` is in a component/effect — keep it strictly at `main.tsx` module scope; `destroy()` only on true teardown.
- **Mouse + D-pad desync:** keeping `onMouseEnter` alongside `useFocusable` can desync hover from spatial focus. Drive the ring off `focused` (single source) and treat hover as `setFocus()`.
- **Stale layout math:** `layout.x/y` is cached; async poster image loads (MediaCard retries) can resize cards and stale the coords. If scroll lands wrong, `updateAllLayouts()` after rows settle, or `useGetBoundingClientRect:true` (costlier).
- **Scope creep:** AppShell shares search/modal infra across all uiStyles. Mount the focus tree only when `isNetflix`/TV so the global keydown handler never hijacks arrow keys on classic/modern.
- **Persisted `?tv=1`:** must mirror into localStorage on first read or TV mode drops after the first RR navigation.

**Key file references:** `src/main.tsx`, `src/lib/platform.ts`, `src/context/UIProvider.tsx`, `src/components/AppShell.tsx` (532-581, 583+), `src/features/home/components/NetflixRow.tsx` (22, 129-158, 266), `src/layout/netflix/NetflixTopBar.tsx`, `src/pages/HomePage.tsx`, `src/components/NativeMpvPlayer.tsx` (1904-1917, 1956-1963, 2849-2906), `src/index.css` (15-22, 1241-1242, 1187-1830 hover rules, 1722-1725 ring, 1446-1462/1273-1279/1669-1676 overscan anchors), `src/components/NativeMpvPlayer/{ScrubBar,PlayerControlsBar,BottomControls,TopOverlay,SettingsPanel,EpisodesDrawer}.tsx`.