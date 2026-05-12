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
npm ci --prefix apps/blissful-mvs
npm --prefix apps/blissful-mvs run dev
```

Vite prints the local URL (typically `http://localhost:5173`).

## Common Tasks

Run a production build:

```bash
npm --prefix apps/blissful-mvs run build
```

Preview the production build locally:

```bash
npm --prefix apps/blissful-mvs run preview
```

Lint:

```bash
npm --prefix apps/blissful-mvs run lint
```

## Data Source (Stremio Addon)

The dashboard calls the Cinemeta addon directly:

- Addon client: `apps/blissful-mvs/src/lib/stremioAddon.ts`
- Movies "Popular": `https://v3-cinemeta.strem.io/catalog/movie/top.json`
- Series "Popular": `https://v3-cinemeta.strem.io/catalog/series/top.json`

Types:
- `apps/blissful-mvs/src/types/media.ts`

## Troubleshooting

- `Your current version of Node is ...` / `Unsupported engine`: update Node to a version compatible with Vite (`^20.19.0 || >=22.12.0`).
- Port already in use: stop the conflicting process or run `npm --prefix apps/blissful-mvs run dev -- --port 5174`.

## Project Layout

- Entry: `apps/blissful-mvs/src/main.tsx`
- App shell + layout: `apps/blissful-mvs/src/App.tsx`
- UI components: `apps/blissful-mvs/src/components/`
- Styling: `apps/blissful-mvs/src/App.css`, `apps/blissful-mvs/src/index.css`

## Onboarding Notes / Suggested Additions

If this prototype is going to grow into a real app, consider adding:

- A short product/design goal section (what "blissful" should feel like).
- A basic architecture note (routing strategy, state management approach, where data will come from).
- A "real data" plan (TMDB/Stremio addon compatibility, caching, error/loading states).
- A contribution workflow section (Node version management, formatting/lint expectations, where to put new components).

## Notes

- UI styled with `Fraunces` + `IBM Plex Sans` via Google Fonts.
- This project is intentionally small to keep iteration fast.
