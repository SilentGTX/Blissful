# blissful MVS

Stremio-inspired dashboard prototype focused on browsing Movies and Series.

## Scope
- Dashboard UI only: browse Movies + Series shelves.
- Fetches "Movies - Popular" and "Series - Popular" from Stremio's Cinemeta addon endpoints.
- Not implemented (by design): playback, auth, other addons, search, persistence.

## Prerequisites
- Node.js: required by Vite `^20.19.0 || >=22.12.0`.
- npm (ships with Node).

## Quick Start

From the repo root:

```bash
npm ci --prefix apps/web-blissful
npm --prefix apps/web-blissful run dev
```

Vite prints the local URL (typically `http://localhost:5173`).

## Common Tasks

Run a production build:

```bash
npm --prefix apps/web-blissful run build
```

Preview the production build locally:

```bash
npm --prefix apps/web-blissful run preview
```

Lint:

```bash
npm --prefix apps/web-blissful run lint
```

## Data Source (Stremio Addon)

The dashboard calls the Cinemeta addon directly:

- Addon client: `apps/web-blissful/src/lib/stremioAddon.ts`
- Movies "Popular": `https://v3-cinemeta.strem.io/catalog/movie/top.json`
- Series "Popular": `https://v3-cinemeta.strem.io/catalog/series/top.json`

Types:
- `apps/web-blissful/src/types/media.ts`

## Troubleshooting

- `Your current version of Node is ...` / `Unsupported engine`: update Node to a version compatible with Vite (`^20.19.0 || >=22.12.0`).
- Port already in use: stop the conflicting process or run `npm --prefix apps/web-blissful run dev -- --port 5174`.

## Project Layout

- Entry: `apps/web-blissful/src/main.tsx`
- App shell + layout: `apps/web-blissful/src/App.tsx`
- UI components: `apps/web-blissful/src/components/`
- Styling: `apps/web-blissful/src/App.css`, `apps/web-blissful/src/index.css`

## Onboarding Notes / Suggested Additions

If this prototype is going to grow into a real app, consider adding:

- A short product/design goal section (what "blissful" should feel like).
- A basic architecture note (routing strategy, state management approach, where data will come from).
- A "real data" plan (TMDB/Stremio addon compatibility, caching, error/loading states).
- A contribution workflow section (Node version management, formatting/lint expectations, where to put new components).

## Notes

- UI styled with `Fraunces` + `IBM Plex Sans` via Google Fonts.
- This project is intentionally small to keep iteration fast.
