import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

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
            // Network-first for API calls with 10s timeout fallback
            urlPattern: /\/(addon-proxy|storage|stremio)\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 200, maxAgeSeconds: 24 * 60 * 60 },
            },
          },
          {
            // Stale-while-revalidate for poster images (Stremio CDN)
            urlPattern: /^https:\/\/(images\.metahub\.space|www\.strem\.io\/images)\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'poster-cache',
              expiration: { maxEntries: 300, maxAgeSeconds: 7 * 24 * 60 * 60 },
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
    port: 5173,
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
      clientPort: 5173,
    },
    proxy: {
      // Stremio website helpers for Facebook login polling
      '/stremio': {
        target: 'https://www.strem.io',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/stremio/, ''),
      },
    },
  },
})
