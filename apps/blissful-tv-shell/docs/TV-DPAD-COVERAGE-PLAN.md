# TV D-pad Coverage Plan

Source: multi-agent audit `tv-dpad-coverage-audit` (2026-05-31). Goal: every interactive
element in the app reachable by remote, TV-gated (`isTvMode()`), desktop untouched.

## What makes an element D-pad reachable
- `src/spatial/useTvFocusable.ts` (sets `data-focused`, opts: onPress/focusable/autoFocus/focusKey/onFocus/onBlur/onArrowPress) OR
- `src/spatial/FocusableButton.tsx` (button built on it; props onPress/autoFocusTv/focusableTv/focusKeyTv).
- Plain `<button onClick>`, HeroUI `<Button>/<Select>/<Dropdown>/<Tabs>`, `<a>`, role=button `<div>` are NOT reachable.
- Overlays must `pause()` Norigin + self-drive native focus (ProfileMenu / TvFriendActionsMenu pattern) OR use a Norigin focus boundary (`isFocusBoundary` + `FocusContext.Provider`, per DesktopNav).
- Scroll containers clip outset rings → use INSET rings.

## Shared primitives to BUILD (highest leverage — do first)
1. **`src/spatial/TvSelect.tsx`** — focusable replacement for HeroUI `<Select>`. FocusableButton trigger → on OK opens a self-contained overlay (pause/native-focus-first/ArrowUp-Down/Enter/Esc-stopPropagation/resume). Props: value, options[], onChange, placeholder + desktop passthrough to HeroUI Select when `!isTvMode()`. Option list self-scrollIntoView. **Unblocks:** Settings (~9 selects), Discover (3 filters), Library type filter, Detail season + addon selects.
2. **`src/spatial/TvTextInput.tsx`** — focusable native `<input>`; container onPress → `input.focus()` (summons Android IME); input onFocus `pause()` / onBlur `resume()`; Esc/Arrow blurs back. **Unblocks:** Settings (RD key, TMDB key, username, display name), Addons search + AddAddon URL, Accounts name, modal fields.
3. **`src/spatial/useTvOverlay.ts`** — reusable hook for the pause()+native-focus+onKeyDown-ring+resume() modal pattern. **Unblocks ~12 modals.**

## Apply order
1. Build the 3 primitives above.
2. **MediaRail "See All"** → FocusableButton on TV. ✅ DONE — unblocks See All on Home/Discover/Library/Search.
3. Per-screen entry autoFocus where MISSING: Discover (first grid card), Library (first card + logged-out Login), Settings (Classic theme btn), Addons (Add addon), Accounts (Add account). Detail + Search + Home already correct — DO NOT add a 2nd autoFocus (races).
4. Mechanical `FocusableButton` swaps (chips, theme/color/save buttons) — preserve className verbatim, `focusableTv={!disabled}`.
5. Detail right-aside: episode cards + stream rows + all-expanded buckets + season chevrons; consider wrapping the fixed aside in a focus boundary; inset rings.
6. Apply useTvOverlay to modals in reachability order: Resume/StreamUnavailable (auto-fire from Continue Watching) → Detail modals → Login/ProfilePrompt → HomeSettings/WhoWatching → WatchPartyJoin. Gate AccountModal/AddAddon OUT on TV (`!isTvMode()` mount).
7. Player (BottomControls buttons + volume/seek via onArrowPress + SkipChapterButton autoFocus) — largest; last. NOTE PlayerControlsBar/ScrubBar are a DEAD duplicate (BottomControls renders at NativeMpvPlayer:3250) — verify + skip.
8. Validate `tsc -b` (NOT --noEmit) + lint after each batch.

## Status (2026-05-31 — second pass)
- ✅ **3 shared primitives BUILT:** `src/spatial/TvSelect.tsx`, `TvTextInput.tsx`, `useTvOverlay.ts` (+ CSS `.tv-select-*`, `.tv-text-input`). Desktop passthrough confirmed (HeroUI off-TV).
- ✅ **MediaRail "See All"** → FocusableButton on TV.
- ✅ **DETAIL page** done: genre+cast chips, episode cards (`EpisodeCardButton`), stream rows (`StreamRowButton`), season prev/next + back/next-episode, addon filter (cycle-on-OK), buckets all-expanded on TV, inset rings, 10-foot sizing bump + section-label/summary/meta sizing. Action buttons + Back already focusable. Season Select left as display (chevrons drive nav). **Right aside wrapped in a Norigin focus boundary** (`asideFocusKey`, isFocusBoundary up/down) so LEFT-column → RIGHT crosses and Up/Down stay in the episode/stream list.
- ✅ **SETTINGS** (via workflow `tv-wire-screens`): 8 selects → TvSelect; 4 text inputs → TvTextInput; theme/accent/Save buttons + Stremio Authenticate/Sync/Unlink → FocusableButton; binge toggle → `BingeToggle` (useTvFocusable, keeps onClick/onKeyDown); react-color ChromePicker gated `!isTvMode()` and replaced with focusable preset swatch grids on TV; entry autoFocus = first theme button.
- ✅ **DISCOVER**: Type/Catalog/Genre-or-Year dropdowns → TvSelect (horizontal row); first grid card autoFocusTv; right detail sidebar chips + library/trailer/Show → FocusableButton.
- ✅ **LIBRARY**: Type filter → TvSelect; sort chips (last_watched/az/za/most_watched) + watched chips → FocusableButton; logged-out Login → FocusableButton autoFocusTv; first card autoFocusTv; per-card Remove-X gated `!isTvMode()` (no stacked focusables).
- ✅ **ADDONS/ACCOUNTS**: Add-addon + search (TvTextInput) + Uninstall → FocusableButton; Add-account/Back → FocusableButton; dead account-edit subtree skipped.
- ✅ **MODALS done** (via workflow `tv-wire-modals` + ResumeOrStartOverModal by hand): 1-D `useTvOverlay` (containerRef + onKeyDown + `data-autofocus` on primary btn, hook called BEFORE the `if(!isOpen)return` guard) on Resume, StreamUnavailable, UnreleasedEpisode, DetailModals (Trailer iframe wrapper + Share), LoginModal, WatchPartyJoin. 2-D focus-boundary + per-item `useTvFocusable` (extract a sub-component, `useFocusable` isFocusBoundary all-4-dirs + `FocusContext.Provider`, one autoFocus, KEEP Norigin running) on ProfilePromptModal (avatar grid), WhoWatchingModal, HomeSettingsModal (rows×actions). AccountModal verified desktop-only (never opens on TV). Native-focus ring = global `html[data-tv] button:focus-visible:not([data-focused])`. All `tsc -b` clean.
- ⬜ **REMAINING: player only** (device-only / Phase 2 — in the browser the player is the `<video>` SimplePlayer, not NativeMpvPlayer, so BottomControls/sliders/SkipChapterButton can't be browser-tested; needs the Android toolchain). Everything else browser-testable is DONE.

## tsc note
`npx node_modules/typescript/bin/tsc -b` is the gate (exit 0). `npm run lint` (`eslint .`) is SLOW (>6min on the whole repo) and was already failing on `main` from a repo-wide `react-hooks/set-state-in-effect` rule (useIsMobile, modal reset effects) — pre-existing, not from this work.

## Notes / 2D layouts
- ProfilePrompt avatar grid + HomeSettings rows are genuinely 2D → prefer per-element useTvFocusable + a Norigin focus boundary (keep Norigin running) over pause()+1D ring.
- Player controls focusability must follow controls-visible state (auto-hide must drop focus).
- Stremio OAuth `window.open` (SettingsStremioPanel) is a separate TV-functionality gap (not just focus).
- AccountsPage per-account edit subtree is DEAD CODE (savedAccounts always empty) — skip wiring it.
