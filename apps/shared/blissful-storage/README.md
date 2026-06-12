# Blissful Storage

Small JSON storage service keyed by Stremio authKey.

## Run locally

```bash
npm --prefix apps/shared/blissful-storage install
npm --prefix apps/shared/blissful-storage run start
```

The service listens on `http://localhost:8787` by default.

## Environment

- `PORT` (default `8787`)
- `STORAGE_DIR` (default `apps/shared/blissful-storage/data`)
- `CORS_ORIGIN` (default `*`)
- `STREMIO_API_ENDPOINT` (default `https://api.strem.io/api`)
- `AUTH_CACHE_TTL_MS` (default `300000`)

## API

- `GET /health`
- `GET /state` (requires `x-stremio-auth` header)
- `POST /state` (requires `x-stremio-auth` header, body: `{ "state": { ... } }`)
