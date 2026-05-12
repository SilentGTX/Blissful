# Blissful-MVS → HeroUI 3.0 Beta Migration Reference

**Purpose:** Hand this file to a capable model (e.g. Opus 4.6) to migrate the UI from HeroUI v2 to HeroUI v3 beta with minimal token usage. All file paths and component usages are listed so the model can edit by location without re-scanning the repo.

**HeroUI v3 docs:** https://v3.heroui.com/docs/react/getting-started/quick-start

---

## 0. Ready for agent?

**Yes**, with these prerequisites:

- **React 19+** and **Tailwind v4**: Already in use in this project (`package.json`).
- **Scope**: Migrate all `@heroui/*` imports and theme/config to v3 beta; preserve layout and styling called out in §9 and §10.
- **Validation**: After each migration step run `npx tsc --noEmit` and `npm run build`.

---

## 1. Current Setup (v2)

- **Package:** `@heroui/react: ^2.8.7` (single dependency; no `@heroui/styles` in v2).
- **Drawer:** One file uses `@heroui/drawer` (separate package in v2); rest use `@heroui/react`.
- **Entry:** `src/main.tsx` wraps app in `<HeroUIProvider>` from `@heroui/react`.
- **Styles:** `src/index.css` uses `@plugin "./hero.ts"` and `@source "../node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}"`. `src/hero.ts` does `import { heroui } from '@heroui/react'; export default heroui();`.

---

## 2. HeroUI v3 Quick Start (for migration)

- **Install:** `npm i @heroui/styles@beta @heroui/react@beta`
- **CSS:** In main CSS, **first** `@import "tailwindcss";` then `@import "@heroui/styles";`. Order matters. Remove v2 theme plugin/source and `hero.ts` plugin usage.
- **Usage:** Components stay `import { Button } from '@heroui/react';` etc. Check v3 docs for any renames (e.g. Modal → Dialog, or same name).
- **Provider:** Confirm in v3 docs whether `HeroUIProvider` still exists and if it’s from `@heroui/react`; update `main.tsx` accordingly.

---

## 3. File Tree and HeroUI Usage

Paths are under `apps/blissful-mvs/`. **HeroUI** = uses HeroUI components. **No HeroUI** = no imports from `@heroui/*`.

```
apps/blissful-mvs/
├── package.json                    # deps: @heroui/react ^2.8.7
├── vite.config.ts                  # no HeroUI
├── index.html                      # no HeroUI
├── src/
│   ├── main.tsx                    # HeroUI: HeroUIProvider
│   ├── App.tsx                     # no HeroUI
│   ├── index.css                  # HeroUI: @plugin hero.ts, @source heroui/theme
│   ├── hero.ts                     # HeroUI: heroui() from @heroui/react
│   ├── context/AppContext.tsx      # no HeroUI
│   ├── types/media.ts              # no HeroUI
│   ├── models/useMetaDetails.ts    # no HeroUI
│   │
│   ├── components/
│   │   ├── AppShell.tsx            # no HeroUI
│   │   ├── MediaCard.tsx           # HeroUI: Card, CardBody, Chip, Image
│   │   ├── MediaGrid.tsx           # no HeroUI
│   │   ├── MediaGridRow.tsx        # HeroUI: Button
│   │   ├── MediaRail.tsx           # HeroUI: Button, ScrollShadow
│   │   ├── MediaRailMobile.tsx      # no HeroUI
│   │   ├── LoadingRow.tsx          # HeroUI: Spinner
│   │   ├── LibraryActionButton.tsx # no HeroUI
│   │   ├── SimplePlayer.tsx        # no HeroUI
│   │   ├── WhatToDoDrawer.tsx      # HeroUI: Drawer from @heroui/drawer
│   │   ├── StremioIcon.tsx         # no HeroUI
│   │   └── SideNav/
│   │       ├── index.tsx           # no HeroUI
│   │       ├── DesktopNav.tsx      # HeroUI: Accordion, AccordionItem, Badge, Tooltip
│   │       ├── MobileNav.tsx       # no HeroUI
│   │       ├── NavItem.tsx         # HeroUI: Tooltip
│   │       ├── ContinueWatchingItem.tsx   # no HeroUI
│   │       ├── ContinueWatchingDrawer.tsx # no HeroUI
│   │       ├── types.ts            # no HeroUI
│   │       └── utils.ts            # no HeroUI
│   │
│   ├── layout/
│   │   ├── top-nav/TopNav.tsx      # HeroUI: Button, Input
│   │   ├── netflix/NetflixTopBar.tsx      # no HeroUI
│   │   └── app-shell/
│   │       ├── components/
│   │       │   ├── AccountModal.tsx       # HeroUI: Button, Modal, ModalBody, ModalContent, ModalHeader, Skeleton
│   │       │   ├── AddAddonModal.tsx      # HeroUI: Button, Input, Modal, ModalBody, ModalContent, ModalHeader
│   │       │   ├── HomeSettingsDialog.tsx # HeroUI: Modal, ModalBody, ModalContent, ModalHeader
│   │       │   ├── HomeSettingsModal.tsx  # HeroUI: Button
│   │       │   └── LoginModal.tsx         # HeroUI: Button, Input, Modal, ModalBody, ModalContent, ModalHeader
│   │       ├── hooks/                     # no HeroUI
│   │       ├── constants.ts               # no HeroUI
│   │       ├── types.ts                   # no HeroUI
│   │       └── utils.ts                   # no HeroUI
│   │
│   ├── pages/
│   │   ├── HomePage.tsx            # HeroUI: Button, Modal, ModalBody, ModalContent, ModalHeader
│   │   ├── DiscoverPage.tsx       # HeroUI: Drawer, DrawerBody, DrawerContent, DrawerHeader, Modal, ModalBody, ModalContent, ModalHeader, Select, SelectItem, Spinner, Tooltip
│   │   ├── DetailPage.tsx         # HeroUI: Button
│   │   ├── LibraryPage.tsx        # HeroUI: Button, Select, SelectItem, Spinner
│   │   ├── AddonsPage.tsx         # HeroUI: Button, Input
│   │   ├── SettingsPage.tsx       # HeroUI: Select, SelectItem
│   │   ├── SearchPage.tsx         # no HeroUI
│   │   └── PlayerPage.tsx          # no HeroUI
│   │
│   ├── features/
│   │   ├── home/
│   │   │   ├── components/
│   │   │   │   ├── NetflixHero.tsx        # no HeroUI
│   │   │   │   ├── NetflixRow.tsx        # HeroUI: Modal, ModalBody, ModalContent, ModalHeader
│   │   │   │   └── NowPopular.tsx        # no HeroUI
│   │   │   ├── hooks/                     # no HeroUI
│   │   │   └── utils.ts                  # no HeroUI
│   │   ├── detail/
│   │   │   ├── components/
│   │   │   │   ├── ActionButtons.tsx     # no HeroUI
│   │   │   │   ├── DetailModals.tsx      # HeroUI: Button, Modal, ModalBody, ModalContent, ModalHeader
│   │   │   │   ├── DetailStreamsPanel.tsx # HeroUI: Spinner
│   │   │   │   ├── EpisodePanel.tsx      # HeroUI: Input
│   │   │   │   ├── GenreChips.tsx        # no HeroUI
│   │   │   │   ├── MetaPanel.tsx         # no HeroUI
│   │   │   │   ├── MobileHero.tsx        # no HeroUI
│   │   │   │   ├── SeasonHeader.tsx      # HeroUI: Button, Select, SelectItem
│   │   │   │   ├── StreamFilters.tsx     # HeroUI: Button, Select, SelectItem
│   │   │   │   ├── StreamList.tsx        # no HeroUI
│   │   │   │   └── WatchBadge.tsx        # no HeroUI
│   │   │   ├── hooks/                    # no HeroUI
│   │   │   ├── streams.ts                # no HeroUI
│   │   │   └── utils.ts                  # no HeroUI
│   │   └── discover/
│   │       ├── hooks/                    # no HeroUI
│   │       └── utils.ts                  # no HeroUI
│   │
│   ├── lib/                        # no HeroUI (all .ts)
│   └── icons/                      # no HeroUI (all .tsx)
```

---

## 4. Exact Imports Map (file → HeroUI components)

Use this to update imports and replace any renamed/deprecated components in v3.

| File | Import source | Components |
|------|----------------|------------|
| `src/main.tsx` | `@heroui/react` | HeroUIProvider |
| `src/hero.ts` | `@heroui/react` | heroui |
| `src/index.css` | — | @plugin "./hero.ts", @source "../node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}" |
| `src/components/MediaCard.tsx` | `@heroui/react` | Card, CardBody, Chip, Image |
| `src/components/MediaGridRow.tsx` | `@heroui/react` | Button |
| `src/components/MediaRail.tsx` | `@heroui/react` | Button, ScrollShadow |
| `src/components/LoadingRow.tsx` | `@heroui/react` | Spinner |
| `src/components/WhatToDoDrawer.tsx` | `@heroui/drawer` | Drawer, DrawerBody, DrawerContent, DrawerHeader |
| `src/components/SideNav/DesktopNav.tsx` | `@heroui/react` | Accordion, AccordionItem, Badge, Tooltip |
| `src/components/SideNav/NavItem.tsx` | `@heroui/react` | Tooltip |
| `src/layout/top-nav/TopNav.tsx` | `@heroui/react` | Button, Input |
| `src/layout/app-shell/components/AccountModal.tsx` | `@heroui/react` | Button, Modal, ModalBody, ModalContent, ModalHeader, Skeleton |
| `src/layout/app-shell/components/AddAddonModal.tsx` | `@heroui/react` | Button, Input, Modal, ModalBody, ModalContent, ModalHeader |
| `src/layout/app-shell/components/HomeSettingsDialog.tsx` | `@heroui/react` | Modal, ModalBody, ModalContent, ModalHeader |
| `src/layout/app-shell/components/HomeSettingsModal.tsx` | `@heroui/react` | Button |
| `src/layout/app-shell/components/LoginModal.tsx` | `@heroui/react` | Button, Input, Modal, ModalBody, ModalContent, ModalHeader |
| `src/pages/HomePage.tsx` | `@heroui/react` | Button, Modal, ModalBody, ModalContent, ModalHeader |
| `src/pages/DiscoverPage.tsx` | `@heroui/react` | Drawer, DrawerBody, DrawerContent, DrawerHeader, Modal, ModalBody, ModalContent, ModalHeader, Select, SelectItem, Spinner, Tooltip |
| `src/pages/DetailPage.tsx` | `@heroui/react` | Button |
| `src/pages/LibraryPage.tsx` | `@heroui/react` | Button, Select, SelectItem, Spinner |
| `src/pages/AddonsPage.tsx` | `@heroui/react` | Button, Input |
| `src/pages/SettingsPage.tsx` | `@heroui/react` | Select, SelectItem |
| `src/features/home/components/NetflixRow.tsx` | `@heroui/react` | Modal, ModalBody, ModalContent, ModalHeader |
| `src/features/detail/components/DetailModals.tsx` | `@heroui/react` | Button, Modal, ModalBody, ModalContent, ModalHeader |
| `src/features/detail/components/DetailStreamsPanel.tsx` | `@heroui/react` | Spinner |
| `src/features/detail/components/EpisodePanel.tsx` | `@heroui/react` | Input |
| `src/features/detail/components/SeasonHeader.tsx` | `@heroui/react` | Button, Select, SelectItem |
| `src/features/detail/components/StreamFilters.tsx` | `@heroui/react` | Button, Select, SelectItem |

---

## 5. Config / Global Changes (do these first)

1. **package.json**
   - Replace `"@heroui/react": "^2.8.7"` with `"@heroui/styles": "beta"` and `"@heroui/react": "beta"`.
   - Remove `@heroui/drawer`; v3 exposes Drawer from `@heroui/react`. Update `WhatToDoDrawer.tsx` to import Drawer from `@heroui/react`.

2. **src/index.css**
   - Remove `@plugin "./hero.ts";` and the line `@source "../node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}";`.
   - After `@import "tailwindcss";` add `@import "@heroui/styles";`. Keep all other `@layer` and custom rules.

3. **src/hero.ts**
   - Remove or rewrite per v3: v3 uses `@heroui/styles` and may not use a Tailwind plugin. Delete the file and remove its reference from `index.css` if v3 docs say so.

4. **src/main.tsx**
   - Confirm in v3 docs whether a root provider is required. If v3 still uses `HeroUIProvider` from `@heroui/react`, keep it; otherwise remove or replace with the v3 equivalent.

---

## 6. Component-by-Component Notes (v2 → v3)

- **Modal:** In v3 the API is **compound**: `Modal`, `Modal.Backdrop`, `Modal.Container`, `Modal.Dialog`, `Modal.Header`, `Modal.Body`, `Modal.Footer`. No `ModalContent`; content goes inside `Modal.Dialog`. Controlled via `isOpen` / `onOpenChange` on `Modal.Backdrop`. **Placement** is on `Modal.Container`: `placement="auto" | "center" | "top" | "bottom"`. Use `Modal.Container` `className` for alignment (e.g. `justify-end` for top-right).
- **AccountModal (top-right):** Must **stay top-right** (dropdown under avatar). Current v2: `placement="top"`, `classNames={{ wrapper: 'items-start justify-end pt-10 pr-4' }}`. In v3: use `Modal.Container placement="top"` and add `className="items-start justify-end pt-10 pr-4"` (or equivalent) so the dialog stays under the top-right trigger. Keep the inner card styling: `solid-surface ml-auto w-[320px] rounded-[24px] bg-white/20 p-5`.
- **Drawer:** v3 has **Drawer** in `@heroui/react` (see v3 docs). Unify: `WhatToDoDrawer.tsx` currently uses `@heroui/drawer`; DiscoverPage uses Drawer from `@heroui/react`. Both should use v3 Drawer from `@heroui/react` with placement and classNames to preserve bottom-sheet look (e.g. `bliss-bottom-drawer`, `rounded-t-[28px]`).
- **Select / SelectItem:** Confirm API (value/label props, children) in v3 and update LibraryPage, SettingsPage, SeasonHeader, StreamFilters, DiscoverPage.
- **Button, Input, Spinner, Card, Chip, Image, Tooltip, Accordion, Badge, ScrollShadow, Skeleton:** Verify names and props in v3; adjust classNames/variants if API changed.

---

## 7. Suggested Migration Order (for minimal tokens)

1. Update **package.json** and run `npm install`.
2. Update **src/index.css** and **src/hero.ts** (or delete hero.ts).
3. Update **src/main.tsx** (provider).
4. Update **src/components/WhatToDoDrawer.tsx** (drawer package or move to @heroui/react).
5. Update layout modals: **AccountModal**, **AddAddonModal**, **HomeSettingsDialog**, **LoginModal**, **HomeSettingsModal**. Use v3 compound structure (Modal.Backdrop, Modal.Container, Modal.Dialog, Modal.Header, Modal.Body) and for AccountModal preserve top-right via Container `className` (see §9).
6. Update **HomePage**, **NetflixRow**, **DetailModals** (modals/buttons).
7. Update **DiscoverPage** (Drawer, Modal, Select, Spinner, Tooltip).
8. Update **LibraryPage**, **SettingsPage**, **SeasonHeader**, **StreamFilters** (Select/Spinner/Button).
9. Update **MediaCard**, **MediaRail**, **MediaGridRow**, **LoadingRow**, **DetailStreamsPanel**, **EpisodePanel**.
10. Update **TopNav**, **AddonsPage**, **DetailPage**, **DesktopNav**, **NavItem**.

After each step, run `npm run build` (or `npx tsc --noEmit` and `npm run build`) to catch type and runtime errors.

---

## 8. Files Not Using HeroUI (no import changes)

These only need changes if you touch shared styles or parent components:  
App.tsx, AppShell.tsx, MediaGrid.tsx, MediaRailMobile.tsx, LibraryActionButton.tsx, SimplePlayer.tsx, StremioIcon.tsx, SideNav/index.tsx, MobileNav.tsx, ContinueWatchingItem.tsx, ContinueWatchingDrawer.tsx, NetflixTopBar.tsx, SearchPage.tsx, PlayerPage.tsx, NetflixHero.tsx, NowPopular.tsx, ActionButtons.tsx, GenreChips.tsx, MetaPanel.tsx, MobileHero.tsx, StreamList.tsx, WatchBadge.tsx, all `lib/*`, all `icons/*`, all `context/*`, all `models/*`, all `types/*`, all `hooks` and `utils` under features/layout.

---

## 9. Critical styling & placement constraints

When replacing v2 components with v3, **preserve** the following so behavior and layout stay the same:

| Component / usage | Constraint | How in v3 |
|-------------------|------------|------------|
| **AccountModal** (top-right under avatar) | Must stay **top-right**; not centered. | Use `Modal.Container` with `placement="top"` and `className` that aligns right: e.g. `items-start justify-end pt-10 pr-4`. Keep inner card: `solid-surface w-[320px] rounded-[24px] bg-white/20 p-5`. |
| **WhatToDoDrawer** | Bottom sheet: liquid glass, rounded top, `bliss-bottom-drawer` class. | Use v3 `Drawer` from `@heroui/react` with `placement="bottom"` and apply same classes to content (`bliss-bottom-drawer solid-surface rounded-t-[28px]` etc.). |
| **DiscoverPage mobile drawer** | Same bottom-sheet look for type/catalog/genre filters. | Same as above: v3 Drawer, placement bottom, preserve existing classNames. |
| **ContinueWatchingDrawer** | Custom portal + `bliss-continue-drawer` / `bliss-bottom-drawer`; no HeroUI today. | If migrated to HeroUI: use v3 `Drawer` placement bottom with same CSS classes so existing `index.css` rules still apply. |
| **All center modals** (Login, AddAddon, HomeSettings, Trailers, Share, etc.) | Centered overlay. | v3 `Modal.Container` with `placement="center"` (default). Keep `Modal.Backdrop` variant (e.g. blur/transparent) and inner styling as needed. |

Do **not** change the account dropdown into a centered modal; it must remain anchored top-right.

---

## 10. Elements without HeroUI that can use HeroUI 3 (optional)

These currently use plain HTML + CSS (no `@heroui/*`). They **can** be migrated to HeroUI 3 for consistency and accessibility; document any that should stay as-is.

| Location | Current implementation | HeroUI 3 option | Notes |
|----------|------------------------|------------------|--------|
| **SimplePlayer.tsx** | Color picker: `fixed` positioned div with `ChromePicker`. | **Modal** (centered) or **Popover** (anchored to trigger). | Popover fits “pick color next to button”; Modal is also fine. |
| **SimplePlayer.tsx** | Options menu (VLC / Download): `absolute` div near controls. | **Popover** with placement (e.g. top/left). | Keeps “dropdown near button” behavior. |
| **SettingsPage.tsx** | Color picker: `fixed inset-0` overlay + centered card with `ChromePicker`. | **Modal** with `placement="center"`. | Straight swap for overlay + content. |
| **TopNav.tsx** | Search results: `absolute left-0 top-full` dropdown under input. | **Popover** with placement `bottom` (anchor to search input). | Optional; preserves “dropdown under input” and allows consistent styling. |
| **ContinueWatchingDrawer.tsx** | Custom `createPortal` + div with `bliss-continue-drawer` / `bliss-bottom-drawer`. | **Drawer** with `placement="bottom"` + same classNames. | Optional; keeps existing look if you reapply `bliss-continue-drawer` / `bliss-bottom-drawer` to Drawer content. |
| **MobileNav.tsx** | Full-screen overlay (`fixed inset-0 z-40`) for mobile menu. | Can stay as-is (custom overlay) or use **Modal** full-screen. | Low priority; only migrate if you want one overlay system. |

If the agent does **not** implement these optional migrations, leave the current markup in place; they are not required for the v2 → v3 migration.

---

*End of heroui3.md*
