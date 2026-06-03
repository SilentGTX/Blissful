# Phase 3a — TV UI (Home D-pad), browser-testable

What's implemented in this pass, how to test it **in a normal browser**, and what's
deferred to 3b. Full design: [`PHASE3-PLAN.md`](./PHASE3-PLAN.md).

## How to test in Chrome (no Android needed)

```powershell
npm --prefix apps\blissful-mvs install      # installs @noriginmedia/norigin-spatial-navigation
npm --prefix apps\blissful-mvs run dev:vite # Vite only (skips the Rust shell)
```
Open **`http://localhost:5173/?tv=1`**. This forces the TV layout in the browser
(persisted to localStorage, so it survives in-app navigation). Then:

- **Arrow keys** move the focus ring (lavender) between cards; **Left/Right** within
  a row, **Up/Down** between rows. The rail scrolls to keep the focused card centred.
- **Enter** opens the focused item.
- The focused card shows its overlay (Play / Info / Trailer) + the meta panel below.
- In dev you'll see Norigin's **visual-debug** boxes around focusables.
- Exit TV mode: open `?tv=0` (or `localStorage.removeItem('bliss:forceTv')`).

Because `?tv=1` only forces the *UI*, the player still falls back to `SimplePlayer`
in the browser — so **don't** judge the native player here (that's device-only).

## What this pass changed (all gated on `isTvMode()` → no effect on the normal app)

| File | Change |
|---|---|
| `src/lib/platform.ts` | `forceTv()` (`?tv=1`) + `isTvMode()` |
| `src/main.tsx` | Norigin `init()` — **only** in TV mode (so it never hijacks arrow keys in the normal UI) |
| `src/context/UIProvider.tsx` | hard-pin `uiStyle='netflix'` on TV + set `html[data-tv]` |
| `src/index.css` | `html[data-tv]` layer: overscan insets, the **`[data-focused]`** lavender focus ring, hover→focus, `scroll-snap: proximity`, hide mouse rail-arrows |
| `src/features/home/components/NetflixRow.tsx` | `useFocusable` row + extracted `NetflixCard`; `scrollIntoView` on focus; debounced meta fetch on TV; `pause()`/`resume()` Norigin around the trailer modal |
| `package.json` | added `@noriginmedia/norigin-spatial-navigation` |

Key design fact baked in: Norigin's `useFocusable` does **not** call native
`focus()` — it sets a `data-focused` attribute — so the focus ring CSS keys off
`[data-focused="true"]`, not `:focus-visible`.

## Known limitations / deferred to Phase 3b

- **Top bar + hero are not D-pad-focusable yet** — so D-pad **Up** from the first
  row currently goes nowhere. Rows/cards navigation is the testable slice here.
- **Discover / Search / Library / Detail grids** have no focus-entry plan yet
  (the verifiers flagged it) — Home only for now.
- **The player's remote keys + Back button** are **device-only** and unchanged:
  - the player still binds Arrow-Left/Right to seek and reveals controls on
    mousemove — wrong for a remote; rebuild is Phase 3b/device work.
  - Android Back uses Tauri **`app.onBackButtonPress`** (2.9.0+) — to be wired on
    device (the modal→drawer→back→exit ladder can't be validated in a browser).
- **Search `<input>`** needs native focus; when wired, `pause()` Norigin while it's
  focused so typing isn't eaten by the spatial keymap.

## ⚠ Not yet compiled here

These edits were authored + reviewed but **not** type-checked/run in this
environment (no working npm install on this machine — Windows long-path bug). The
first real validation is your browser test above. If `tsc -b` flags the Norigin
`ref` typing on the card `<div>`, that's the most likely spot to need a tweak.
