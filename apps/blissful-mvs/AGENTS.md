# Blissful - AGENTS.md

## Project Overview

Custom Stremio web client with liquid glass UI, mobile-optimized, Continue Watching, and library sync.

## Tech Stack

- React 19 + TypeScript
- Vite (build tool)
- HeroUI (component library)
- React Router (navigation)
- Tailwind CSS (styling)

## Quick Commands

```bash
# Development
cd apps/blissful-mvs
npm run dev          # Start dev server on port 5173

# Build
npm run build        # Build for production (outputs to dist/)
npx tsc --noEmit     # Type check only

# Deploy
docker compose restart blissful
```

## Key Architecture Patterns

### Stream Routing

Stream clicks now go directly to the player URL from addon/Stremio results.

1. User clicks a stream in `StreamList.tsx`
2. `handleStreamClick` in `DetailPage.tsx` navigates to `deepLinks.player` (or `stream.url` fallback)
3. Local Stremio service URLs (`127.0.0.1:11470`, `localhost`) are normalized to `/stremio-server/*` so public clients can access them through Traefik
4. Addon and Stremio auth requests go through `blissful-proxy` (`/addon-proxy` and `/stremio`)

The WEB Ready toggle has been removed. All streams are shown.

### Continue Watching System

1. **Storage**: Stream selections saved to localStorage via `streamHistory.ts`
   - Key format: `bliss:lastStream:{type}:{id}:{videoId}`
   - Stores: URL, title, timestamp
2. **Library Sync**: Fetches from Stremio API via `stremioApi.ts`
   - Endpoint: `datastoreGetLibraryItems`
   - Filters: Items with `timeOffset > 0`
3. **Resume Flow**:
   - Desktop: Direct player navigation if stored stream exists
   - iOS: Shows "What to do" drawer with VLC option
   - No stored stream: Goes to detail page (NO auto-fetch to avoid 5min delays)

### Mobile Bottom Navigation

- Location: `SideNav.tsx` (renders when `isMobile=true`)
- Styling: Floating liquid glass (`solid-surface`, `rounded-[28px]`)
- Continue button: Opens paged drawer (3 items per page, snap scrolling)

### iOS Integration

- Component: `WhatToDoDrawer.tsx`
- Triggered: When clicking any stream on iOS devices
- Options:
  - Play in VLC (via `vlc://` URL scheme)
  - Play in Browser
- Deep links generated via `buildStreamDeepLinks()` in `deepLinks.ts`

### Important Implementation Details

**Stream History Key Format:**

```typescript
// Movies
`bliss:lastStream:movie:${id}:`
// Series episodes
`bliss:lastStream:series:${id}:${videoId}`;
```

**Continue Watching Handler Logic:**

```typescript
// 1. Check for stored stream (instant - localStorage)
const stored = getLastStreamSelection({ type, id, videoId });

// 2. If iOS + stored stream → show WhatToDo drawer
if (isIos() && stored?.url) {
  setIosPlayPrompt({ url: stored.url, ... });
  return;
}

// 3. If stored stream (non-iOS) → go to player
if (stored?.url) {
  navigate(`/player?url=${stored.url}`);
  return;
}

// 4. No stored stream → go to detail page
// DO NOT auto-fetch - takes too long with many addons
navigate(`/detail/${type}/${id}`);
```

**Mobile Continue Drawer:**

- Height: 250px
- Items per page: 3
- Scroll: Snap points (`snap-y snap-mandatory`)
- Padding: pb-4 to prevent clipping

## File Structure

```
src/
├── components/
│   ├── AppShell.tsx       # Main layout, Continue Watching logic
│   ├── SideNav.tsx        # Desktop sidebar + mobile bottom nav
│   ├── WhatToDoDrawer.tsx # iOS play options drawer
│   └── ...
├── pages/
│   ├── HomePage.tsx       # Hero, addon rows, Continue Watching
│   ├── DiscoverPage.tsx   # Catalog browsing
│   ├── DetailPage.tsx     # Meta details, stream selection
│   └── PlayerPage.tsx     # Video player
├── lib/
│   ├── stremioApi.ts      # Stremio API client
│   ├── stremioAddon.ts    # Addon fetching
│   ├── streamHistory.ts   # localStorage for stream selections
│   ├── storageApi.ts      # Storage server client
│   └── deepLinks.ts       # URL scheme builders (VLC, etc.)
└── types/
    └── media.ts           # TypeScript interfaces
```

## Common Development Tasks

### Adding a new nav item (mobile)

1. Add icon to ICONS object in SideNav.tsx
2. Add MobileNavItem to mobile nav section
3. Update active state handling

### Modifying Continue Watching

- Drawer UI: SideNav.tsx (mobile section, ~line 189)
- Handler logic: AppShell.tsx (onOpenContinueItem, ~line 939)
- Storage: lib/streamHistory.ts

### Adding iOS-specific behavior

- Check `isIos()` from lib/device.ts
- Show drawer via `setIosPlayPrompt()` in AppShell.tsx
- Update WhatToDoDrawer.tsx for new options

## Styling Guidelines

- Glass effect: `solid-surface bg-white/6` + `backdrop-blur`
- Rounded corners: `rounded-[28px]` for large elements, `rounded-2xl` for cards
- Mobile spacing: `pb-safe` for bottom safe area, `px-4` for horizontal padding
- Liquid glass: White background with low opacity + blur

## API Integration Points

### Stremio Core API

- Login: `loginWithEmail()`, `loginWithFacebookPopup()`
- Library: `datastoreGetLibraryItems()`, `rewindLibraryItem()`
- Addons: `addonCollectionGet()`, `addonCollectionSet()`

### Addon Endpoints (via addon-proxy)

- Manifest: `GET /addon-proxy?url={addonUrl}/manifest.json`
- Catalog: `GET /addon-proxy?url={addonUrl}/catalog/{type}/{id}.json`
- Streams: `GET /addon-proxy?url={addonUrl}/stream/{type}/{id}.json`

### Stremio Auth Endpoints (via blissful-proxy)

- Base path: `/stremio/*`
- Upstream: `https://www.strem.io/*`
- Purpose: browser-safe auth flow relay

### Storage Server (blissful-storage)

- Base: `https://blissful.budinoff.com/storage`
- Endpoints: `GET /health`, `GET/POST /state`, `GET/POST /settings`, `GET/POST /home`
- Purpose: Per-account state sync (player settings, home row prefs, addon order, theme/ui)
- Backend: MongoDB (`account_state` collection), keyed by Stremio `userId`

## Environment Variables

- `VITE_STORAGE_URL`: Storage server URL (set in docker-compose.yml)

## Docker Integration

- Container: `blissful` (node:20-alpine)
- Port: 8080 (inside container)
- Volume: `./apps/blissful-mvs/dist:/app/dist:ro`
- Command: `serve -s dist -l 8080`
- Traefik routing: `Host(blissful.budinoff.com)` with path exclusions
- Mac stack companions: `stremio-service` (11470/12470) + `blissful-proxy` (13000)

## Testing on iOS

1. Build: `npm run build`
2. Restart: `docker compose restart blissful`
3. Access: `https://blissful.budinoff.com` or local host on iPhone
4. Force refresh: Settings → Safari → Clear History and Website Data
5. Test flow: Play stream → Check Continue Watching → Click item → What to do drawer
