import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// The dev server proxies the Blissful backend routes to PRODUCTION by DEFAULT,
// so a fresh clone gets a working watch party / torrent resolution from just
// `npm run dev` — no env file, no local backend to run. (`server.proxy` only
// applies to `vite` dev, so this is inert in production builds.) Prod storage
// CORS-blocks localhost, hence the same-origin proxy; storageBaseUrl.ts routes
// `/storage` through it. To target a LOCAL backend instead, set VITE_STORAGE_URL
// / VITE_STORAGE_WS_URL. `/addon-proxy` has its own middleware below; `/stremio`
// stays on strem.io (the Facebook account-link helper).
const PROD_BACKEND = 'https://blissful.budinoff.com'
const PROD_ROUTES = [
  '/storage', '/rd-by-hash', '/rd-fallback', '/transcode', '/imdb-rating',
  '/tmdb-find', '/tmdb-episode-rating', '/tmdb-season-info', '/skip-times',
  '/opensubs', '/resolve-url', '/probe-streams', '/extract-subtitle.vtt',
  '/videasy-sources', '/hls-master', '/player-log', '/img',
]
const PROD_BACKEND_PROXY = Object.fromEntries(
  PROD_ROUTES.map((p) => [
    p,
    {
      target: PROD_BACKEND,
      changeOrigin: true,
      secure: true,
      // Storage carries the watch-party WebSockets (/ws/room, /ws/user).
      ...(p === '/storage' ? { ws: true } : {}),
      // Make the server-side request look same-origin so any Origin allowlist
      // on the backend passes (the browser already sees same-origin localhost).
      headers: { origin: PROD_BACKEND, referer: `${PROD_BACKEND}/` },
    },
  ]),
)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Blissful',
        short_name: 'Blissful',
        description: 'Custom Stremio web client',
        theme_color: '#19f7d2',
        background_color: '#0a0a0a',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: '/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
          },
          {
            src: '/icon-maskable-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        // Take over from the previous SW the moment the new one
        // installs, and start serving the new bundle to every open
        // tab immediately (no need to close them). Without these
        // flags, a `registerType: 'autoUpdate'` SW sits in "waiting"
        // until every client closes — which means hard-refreshing a
        // tab still loads the previous build's JS via the old SW.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Cache-first for static assets (hashed filenames)
            urlPattern: /\/assets\/.+\.(js|css|woff2?|png|svg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            // Network-first for API calls with 10s timeout fallback.
            // /addon-proxy is deliberately excluded: HLS playback funnels
            // every TS segment through it, and Workbox's clone-to-cache
            // pipeline mangles binary streams (showed up as black-screen
            // 4K HEVC — audio + subs OK, video frame never decoded).
            urlPattern: /\/(storage|stremio)\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
          {
            // Cache-first for poster images (metahub / Stremio CDN).
            // Posters are content-addressed by IMDb id and effectively
            // immutable, so revisits serve from cache instantly without
            // a revalidation round-trip — eliminates the "metahub
            // stalled on revisit" failure mode where the second
            // background fetch from StaleWhileRevalidate would
            // sometimes hang. Cold-cache stall handling lives in
            // MediaCard (PR 2).
            urlPattern: /^https:\/\/(images\.metahub\.space|www\.strem\.io\/images)\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'poster-cache',
              expiration: { maxEntries: 500, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
    {
      name: 'addon-proxy',
      configureServer(server) {
        server.middlewares.use('/addon-proxy', async (req, res) => {
          const urlParam = new URL(req.url ?? '', 'http://localhost').searchParams.get('url');
          if (!urlParam) {
            res.statusCode = 400;
            res.end('Missing url');
            return;
          }

          let target: URL;
          try {
            target = new URL(urlParam);
          } catch {
            res.statusCode = 400;
            res.end('Invalid url');
            return;
          }

          if (!['http:', 'https:'].includes(target.protocol)) {
            res.statusCode = 400;
            res.end('Unsupported protocol');
            return;
          }

          const localHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
          if (localHosts.has(target.hostname)) {
            const isAllowedLocalAddon =
              target.port === '11470' && target.pathname.startsWith('/local-addon/');
            if (!isAllowedLocalAddon) {
              res.statusCode = 403;
              res.end('Forbidden host');
              return;
            }
          }

          const isAddonReq = target.pathname.includes('/stream/') ||
            target.pathname.includes('/subtitles/') || target.pathname.includes('/meta/');
          const emptyAddonResponse = () => {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            if (target.pathname.includes('/subtitles/')) res.end(JSON.stringify({ subtitles: [] }));
            else if (target.pathname.includes('/stream/')) res.end(JSON.stringify({ streams: [] }));
            else res.end(JSON.stringify({ meta: {} }));
          };

          try {
            const fetchHeaders: Record<string, string> = {};
            const hasRange = !!req.headers.range;
            if (hasRange) fetchHeaders['Range'] = req.headers.range as string;

            const upstream = await fetch(target.toString(), { headers: fetchHeaders });
            if (!upstream.ok && upstream.status !== 206 && isAddonReq) {
              emptyAddonResponse();
              return;
            }
            res.statusCode = upstream.status;
            res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json');
            const cr = upstream.headers.get('content-range');
            if (cr) res.setHeader('content-range', cr);
            const ar = upstream.headers.get('accept-ranges');
            if (ar) res.setHeader('accept-ranges', ar);

            if (hasRange && upstream.body) {
              // Stream Range responses so the client can abort early
              // without the proxy buffering the entire file.
              const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();
              res.on('close', () => reader.cancel());
              try {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (!res.writableEnded) res.write(Buffer.from(value));
                }
              } catch { /* client disconnect */ }
              if (!res.writableEnded) res.end();
            } else {
              const body = await upstream.arrayBuffer();
              res.end(Buffer.from(body));
            }
          } catch {
            if (isAddonReq) { emptyAddonResponse(); return; }
            res.statusCode = 502;
            res.end('Upstream error');
          }
        });
      },
    },
  ],
  server: {
    host: true,
    // Override with VITE_DEV_PORT when 5173 is already taken (e.g. another
    // repo's Vite is running). Keep in sync with BLISSFUL_VITE_PORT on the
    // shell side so the shell proxies to the right port.
    port: Number(process.env.VITE_DEV_PORT) || 5173,
    strictPort: true,
    // The native shell serves the page on its own port (5175+) and proxies
    // asset requests to Vite. That works for HTTP, but the shell doesn't
    // tunnel WebSockets — so HMR's default ws://<page-host>:<page-port>/...
    // hits the shell, gets a 200 OK back instead of an Upgrade, and logs a
    // handshake error in the console. Telling Vite's client to dial
    // 127.0.0.1:5173 directly for the HMR socket skips the shell entirely
    // and uses Vite's own ws server. No effect on the production build —
    // HMR is dev-only.
    hmr: {
      host: '127.0.0.1',
      clientPort: Number(process.env.VITE_DEV_PORT) || 5173,
    },
    proxy: {
      // Stremio website helpers for Facebook login polling
      '/stremio': {
        target: 'https://www.strem.io',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/stremio/, ''),
      },
      // Backend routes → prod by default (see PROD_BACKEND_PROXY above).
      ...PROD_BACKEND_PROXY,
    },
  },
})
