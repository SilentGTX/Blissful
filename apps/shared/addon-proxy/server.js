const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { decryptVideasyResponse } = require('./videasy-decrypt');

// ── JSON disk cache (NAS-backed) ───────────────────────────────────────
// Small, immutable-ish JSON — TMDB id maps, season info, skip-times, ratings
// — persisted to disk so it survives proxy restarts/redeploys and rides out
// upstream latency / rate limits (TMDB, AniSkip, TheIntroDB, Cinemeta).
// Namespaced subdirs; each entry is { exp, v } where exp === 0 means
// permanent. Atomic write (tmp+rename); async IO so the NAS mount can never
// stall the event loop. Evicted by blissful-cache-cleanup.sh (cache/json).
const JSON_CACHE_DIR = process.env.JSON_CACHE_DIR || '/json-cache';
try { fs.mkdirSync(JSON_CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
function jsonCachePath(ns, key) {
  const h = crypto.createHash('sha1').update(String(key)).digest('hex');
  return path.join(JSON_CACHE_DIR, ns, `${h}.json`);
}
// Resolves to the cached value, or undefined on miss / expiry / read error.
function jsonCacheGet(ns, key) {
  return new Promise((resolve) => {
    fs.readFile(jsonCachePath(ns, key), 'utf8', (err, raw) => {
      if (err) return resolve(undefined);
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && (!obj.exp || obj.exp >= Date.now())) {
          return resolve(obj.v);
        }
      } catch { /* corrupt entry — treat as a miss */ }
      resolve(undefined);
    });
  });
}
// Best-effort write. ttlMs <= 0 / omitted means permanent (exp === 0).
function jsonCacheSet(ns, key, v, ttlMs) {
  return new Promise((resolve) => {
    const p = jsonCachePath(ns, key);
    const exp = ttlMs && ttlMs > 0 ? Date.now() + ttlMs : 0;
    const tmp = `${p}.tmp${process.pid}`;
    fs.mkdir(path.dirname(p), { recursive: true }, (mkErr) => {
      if (mkErr) return resolve(false);
      fs.writeFile(tmp, JSON.stringify({ exp, v }), (wErr) => {
        if (wErr) { fs.unlink(tmp, () => {}); return resolve(false); }
        fs.rename(tmp, p, (rErr) => resolve(!rErr));
      });
    });
  });
}

// Caching image proxy store — posters/backdrops from metahub/TMDB are cached
// here (NAS, evicted by blissful-cache-cleanup.sh) so the client doesn't ride
// metahub's wildly variable edge latency on every load. See the /img route.
const IMG_CACHE_DIR = process.env.IMG_CACHE_DIR || '/poster-cache';
try { fs.mkdirSync(IMG_CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
// metahub's background/* endpoint can take 30-40s; give the fetch room to
// finish so it CACHES (then every later view is instant) instead of aborting
// at 15s and never loading at all.
const IMG_FETCH_TIMEOUT = +(process.env.IMG_FETCH_TIMEOUT || 45000);
// How long a client waits before we give up on IT (504) — the fetch keeps
// running in the background to warm the cache, so the next view is instant.
// Keeps the page usable when metahub's backgrounds crawl (>60s) instead of
// hanging the backdrop area.
const IMG_CLIENT_DEADLINE = +(process.env.IMG_CLIENT_DEADLINE || 12000);
// Coalesce concurrent requests for the same uncached image into ONE upstream
// fetch (key -> [waiter]); the fetch caches even if every waiter leaves.
const imgInflight = new Map();
// metahub 307-redirects many posters (e.g. poster/small/*) to its CDN, so the
// image fetch MUST follow redirects. Calls onResp(finalResponse) or onErr(kind).
function imgFetchFollow(target, hops, onResp, onErr) {
  let u;
  try { u = new URL(target); } catch { onErr('badurl'); return; }
  const lib = u.protocol === 'http:' ? http : https;
  const req = lib.get(target, { timeout: IMG_FETCH_TIMEOUT }, (resp) => {
    const sc = resp.statusCode || 0;
    if (sc >= 300 && sc < 400 && resp.headers.location && hops > 0) {
      resp.resume();
      let next;
      try { next = new URL(resp.headers.location, target).toString(); } catch { onErr('badredirect'); return; }
      imgFetchFollow(next, hops - 1, onResp, onErr);
      return;
    }
    onResp(resp);
  });
  req.on('timeout', () => { req.destroy(); onErr('timeout'); });
  req.on('error', () => onErr('err'));
}

// Client-side player diagnostics get POSTed here from the browser
// and appended to a file on the host. Lets us debug iOS issues
// where we don't have Web Inspector handy.
const PLAYER_LOG_DIR = '/app/logs';
const PLAYER_LOG_FILE = path.join(PLAYER_LOG_DIR, 'player.log');
try { fs.mkdirSync(PLAYER_LOG_DIR, { recursive: true }); } catch { /* ignore */ }
function appendPlayerLog(line) {
  const ts = new Date().toISOString();
  fs.appendFile(PLAYER_LOG_FILE, `${ts} ${line}\n`, () => {});
}

const PORT = process.env.PORT || 3000;

// ── Videasy sources API ────────────────────────────────────────────────
// The sources API moved from api.videasy.net (dead — routes 404) to
// api.videasy.to, and — as of 2026-07-02 — that host does NO bot-gating:
// no Cloudflare Turnstile, no x-session-token wall. A plain https.get with a
// `Referer: https://www.vidking.net/` returns the encrypted payload, which we
// open with our own WASM decryptor (videasy-decrypt.js). So the whole
// browser/minter apparatus that existed only to clear Turnstile is obsolete;
// the on-Mac browser-resolver is now a break-glass fallback for cipher
// rotation only (see /videasy-sources). The old session-token machinery below
// (videasySessionToken/videasyAuthHeaders, /videasy-token push) is retained
// but inert — if the wall ever comes back, a pushed token flows through again.
const VIDEASY_API_BASE = process.env.VIDEASY_API_BASE || 'https://api.videasy.to';
const VIDEASY_APP_ID = process.env.VIDEASY_APP_ID || 'vidking';
const VIDEASY_TOKEN_FILE = process.env.VIDEASY_TOKEN_FILE || '/nas/state/videasy/session-token.txt';
const VIDEASY_TOKEN_SECRET = process.env.VIDEASY_TOKEN_SECRET || '';
// A pushed token older than this is treated as dead (real lifetime is ~hours);
// past it we fall back to file/env so a wedged minter doesn't pin a stale token.
const VIDEASY_HTTP_TOK_TTL = 6 * 60 * 60 * 1000;
let _vdHttpTok = { val: '', at: 0 };
let _vdFileTok = { val: process.env.VIDEASY_SESSION_TOKEN || '', at: 0 };
function videasySessionToken() {
  const now = Date.now();
  if (_vdHttpTok.val && now - _vdHttpTok.at < VIDEASY_HTTP_TOK_TTL) return _vdHttpTok.val;
  if (now - _vdFileTok.at > 10000) {
    _vdFileTok.at = now;
    try {
      const t = fs.readFileSync(VIDEASY_TOKEN_FILE, 'utf8').trim();
      if (t) _vdFileTok.val = t;
    } catch { /* keep last-known / env value */ }
  }
  return _vdFileTok.val;
}
// Headers for an authed api.videasy.net/<provider>/sources-with-title call.
function videasyAuthHeaders() {
  const h = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    Referer: 'https://www.vidking.net/',
    Origin: 'https://www.vidking.net',
    'x-app-id': VIDEASY_APP_ID,
  };
  const t = videasySessionToken();
  if (t) h['x-session-token'] = t;
  return h;
}
// Per-(provider,tmdb,season,episode) cache of the final decrypted+proxified
// payload — collapses the player's ~12-server + reload fan-out (each was a
// separate upstream call burning the token's ~60-call quota) down to ~1 per
// distinct provider per episode. In-memory; a restart just re-resolves.
const videasySourcesCache = new Map(); // key -> { at, payload }
const VIDEASY_SOURCES_TTL = 30 * 60 * 1000; // 30 min

// ── Videasy browser-resolver ───────────────────────────────────────────
// Videasy moved /sources-with-title to a `v2:` CryptoJS-Salted response we
// can no longer decrypt server-side (the passphrase lives in their player JS
// and rotates — a perpetual arms race). Instead a warm undetected-Chrome on
// the Mac (infra/scripts/videasy-resolver.py) loads vidking's OWN player,
// which decrypts client-side, and harvests the resulting {sources,subtitles}
// via a JSON.parse hook. The proxy asks it per title. This is immune to their
// cipher changes because we never decrypt anything ourselves.
const VIDEASY_RESOLVER_URL = process.env.VIDEASY_RESOLVER_URL || 'http://host.docker.internal:13099';
function fetchFromResolver(mediaType, tmdbId, seasonId, episodeId, cb) {
  if (!VIDEASY_TOKEN_SECRET) return cb(null);
  const qs = new URLSearchParams({
    type: mediaType === 'movie' ? 'movie' : 'tv',
    tmdbId: String(tmdbId),
    season: String(seasonId || '1'),
    episode: String(episodeId || '1'),
    secret: VIDEASY_TOKEN_SECRET,
  });
  let done = false;
  const finish = (v) => { if (!done) { done = true; cb(v); } };
  const req = http.get(`${VIDEASY_RESOLVER_URL}/resolve?${qs}`, { timeout: 28000 }, (r) => {
    if ((r.statusCode || 0) !== 200) { r.resume(); return finish(null); }
    let b = '';
    r.setEncoding('utf8');
    r.on('data', (c) => { b += c; });
    r.on('end', () => {
      try { const j = JSON.parse(b); finish(j && Array.isArray(j.sources) && j.sources.length ? j : null); }
      catch { finish(null); }
    });
    r.on('error', () => finish(null));
  });
  req.on('timeout', () => { req.destroy(); finish(null); });
  req.on('error', () => finish(null));
}
// Proxify + cache + send a resolved Videasy payload — shared finalize step
// (mirrors the legacy decrypt path so the player sees an identical shape).
function respondVideasyPayload(payload, vsCacheKey, res) {
  const proxify = (u) => {
    try { new URL(u); return '/addon-proxy?url=' + encodeURIComponent(u) + '&vd=1'; } catch { return u; }
  };
  if (Array.isArray(payload?.sources)) {
    for (const s of payload.sources) if (s && typeof s.url === 'string') s.url = proxify(s.url);
  }
  if (Array.isArray(payload?.subtitles)) {
    for (const t of payload.subtitles) {
      if (!t) continue;
      if (typeof t.url === 'string') t.url = proxify(t.url);
      t.lang = videasyLangToCode(t.lang || t.language);
    }
  }
  if (Array.isArray(payload?.sources) && payload.sources.length > 0) {
    videasySourcesCache.set(vsCacheKey, { at: Date.now(), payload });
  } else {
    // Cache an empty result briefly (5 min) — a repeated play of a title Vidking
    // doesn't have would otherwise re-run the slow (~60s) resolver on every
    // attempt and pile up a multi-minute backlog (the "stuck loading" jam).
    videasySourcesCache.set(vsCacheKey, { at: Date.now(), payload, ttl: 5 * 60 * 1000 });
  }
  if (res.writableEnded || res.headersSent) return;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

// Cap concurrent /transcode jobs so a burst can't saturate the Mac. Copy
// mode (H.264) is ~free (audio-only re-encode), but HEVC→H.264 re-encode
// uses all cores; this bounds the worst case. Override with TRANSCODE_MAX.
let activeTranscodes = 0;
const TRANSCODE_MAX = parseInt(process.env.TRANSCODE_MAX, 10) || 6;

// Video re-encode args. Apple Silicon's hardware encoder (h264_videotoolbox)
// would be ~6× lighter, BUT this proxy runs inside Docker's Linux VM where
// VideoToolbox isn't reachable (macOS-host-only) — so HW is OFF by default and
// only works if ffmpeg is run on the macOS host (a future host-side transcode
// service). In-container we use software libx264, THREAD-CAPPED so one stream
// can't pin every core (the cause of the 85°C-on-2-streams thermals). Enable HW
// only where VideoToolbox exists via TRANSCODE_HWENC=1.
const TRANSCODE_HWENC = process.env.TRANSCODE_HWENC === '1';
// Host-side hardware transcoder (native macOS ffmpeg + VideoToolbox). When set,
// /transcode-seg offloads the per-segment encode to it instead of running
// software libx264 in this Linux container. e.g. http://host.docker.internal:13098
const TRANSCODE_HOST_URL = process.env.TRANSCODE_HOST_URL || '';
const TRANSCODE_HOST_SECRET = process.env.TRANSCODE_HOST_SECRET || process.env.VIDEASY_TOKEN_SECRET || '';
// Per-encode bitrate target (1080p-tuned; the common RD-fallback case). VBR with
// a maxrate cap so simple scenes stay small and complex ones don't blow up.
const TRANSCODE_VBITRATE = process.env.TRANSCODE_VBITRATE || '6000k';
const TRANSCODE_VMAXRATE = process.env.TRANSCODE_VMAXRATE || '9000k';
// Cap software-libx264 threads so a single fallback encode can't saturate all
// cores (P-core count is a sane bound).
const TRANSCODE_X264_THREADS = process.env.TRANSCODE_X264_THREADS || '3';
function videoEncodeArgs() {
  if (TRANSCODE_HWENC) {
    return [
      '-c:v', 'h264_videotoolbox',
      '-b:v', TRANSCODE_VBITRATE, '-maxrate', TRANSCODE_VMAXRATE,
      '-bufsize', '12000k', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    ];
  }
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-threads', TRANSCODE_X264_THREADS];
}

// Resolve a torrentio `/resolve/realdebrid/…` URL to its final real-debrid.com
// direct URL ONCE and cache it. Feeding ffprobe/ffmpeg the torrentio URL means
// EVERY probe + EVERY segment re-runs the redirect (torrentio → RD mints a fresh
// link), which is slow (~10-25s vs ~0.4s direct) and gets RD-throttled — the
// difference between the web player buffering forever and starting promptly.
// RD direct links are short-lived, so cache only ~25 min then re-resolve.
const transcodeSrcCache = new Map(); // torrentio url -> { direct, exp }
const TRANSCODE_SRC_TTL = 25 * 60 * 1000;
function resolveTranscodeSrc(src) {
  return new Promise((resolve) => {
    if (!/\/resolve\//.test(src)) return resolve(src); // already a direct URL
    const c = transcodeSrcCache.get(src);
    if (c && c.exp > Date.now()) return resolve(c.direct);
    let u;
    try { u = new URL(src); } catch { return resolve(src); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(src, { timeout: 20000 }, (r) => {
      const sc = r.statusCode || 0;
      const loc = r.headers.location;
      const direct = sc >= 300 && sc < 400 && loc ? new URL(loc, src).toString() : src;
      r.destroy(); // headers only — don't download the body
      transcodeSrcCache.set(src, { direct, exp: Date.now() + TRANSCODE_SRC_TTL });
      resolve(direct);
    });
    req.on('timeout', () => { req.destroy(); resolve(src); });
    req.on('error', () => resolve(src));
  });
}

// ffprobe a remote video's first video stream → { codec, pixfmt }. Used to
// decide copy vs re-encode (10-bit H.264 / HEVC must be re-encoded).
function probeVideo(src) {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,pix_fmt', '-of', 'default=nw=1', src,
    ]);
    let out = '';
    p.stdout.on('data', (c) => { out += c.toString(); });
    const done = () => resolve({
      codec: ((out.match(/codec_name=(\S+)/) || [])[1] || '').toLowerCase(),
      pixfmt: ((out.match(/pix_fmt=(\S+)/) || [])[1] || '').toLowerCase(),
    });
    p.on('close', done);
    p.on('error', () => resolve({ codec: '', pixfmt: '' }));
    setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* noop */ } done(); }, 12000);
  });
}

// ──────────────────────────────────────────────────────────────────
// AniSkip (Skip Intro / Recap / Credits) for the web player.
//
// Anime streamed without embedded chapters carry no skip markers, so
// the player can't surface a Skip button from ffprobe alone. AniSkip
// (api.aniskip.com) has crowd-sourced op/ed/recap timestamps keyed by
// MyAnimeList id + episode. The hard part is mapping Stremio's
// (imdb + season + episode) to the right MAL *cour*: a multi-season
// show shares one imdb id across cours that each have a distinct MAL
// id. We resolve it season-accurately by walking the AniList relation
// graph (PREQUEL/SEQUEL, TV formats only) into a chronological list of
// cours and indexing by the Stremio season number.
// ──────────────────────────────────────────────────────────────────

/** Minimal promisified JSON request (GET/POST) over https. */
function requestJson(urlStr, { method = 'GET', headers = {}, body = null, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    try {
      const u = new url.URL(urlStr);
      const req = https.request(
        {
          method,
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: { 'User-Agent': 'blissful-proxy', Accept: 'application/json', ...headers },
        },
        (r) => {
          let buf = '';
          r.setEncoding('utf8');
          r.on('data', (c) => { buf += c; });
          r.on('end', () => {
            try { resolve({ status: r.statusCode, json: buf ? JSON.parse(buf) : null }); }
            catch (e) { reject(new Error('json parse: ' + e.message)); }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
      if (body) req.write(body);
      req.end();
    } catch (e) { reject(e); }
  });
}

// IMDb rating for a title, resolved server-side. Cinemeta's `imdbRating` IS
// the IMDb number (no fragile www.imdb.com scraping needed); TMDB's
// `vote_average` is the fallback for brand-new titles Cinemeta hasn't synced.
// Uses the proxy's OWN TMDB key, so even keyless clients get the TMDB
// fallback. Returns { rating: number|null }. Cached by the /imdb-rating route.
async function resolveImdbRating(imdbId) {
  for (const type of ['movie', 'series']) {
    try {
      const r = await requestJson(`https://v3-cinemeta.strem.io/meta/${type}/${imdbId}.json`);
      const raw = r && r.json && r.json.meta ? r.json.meta.imdbRating : null;
      const v = raw == null || raw === '' ? NaN : (typeof raw === 'number' ? raw : parseFloat(String(raw)));
      if (Number.isFinite(v) && v > 0 && v <= 10) return { rating: Number(v.toFixed(1)) };
    } catch { /* try next type / fall through to TMDB */ }
  }
  const apiKey = process.env.TMDB_API_KEY || '';
  if (apiKey) {
    try {
      const r = await requestJson(
        `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}` +
          `?api_key=${encodeURIComponent(apiKey)}&external_source=imdb_id`,
      );
      const d = (r && r.json) || {};
      for (const arr of [d.movie_results, d.tv_results]) {
        const va = Array.isArray(arr) && arr[0] ? arr[0].vote_average : null;
        if (typeof va === 'number' && Number.isFinite(va) && va > 0 && va <= 10) {
          return { rating: Number(va.toFixed(1)) };
        }
      }
    } catch { /* fall through to miss */ }
  }
  return { rating: null };
}

// ──────────────────────────────────────────────────────────────────
// /rd-by-hash — resolve a torrent (infoHash + fileIdx) to a key-free
// Real-Debrid direct link, using the HOUSE RD token (RD_FALLBACK_KEY,
// the same one /rd-fallback uses). Used by Watch Party v2: a desktop
// host announces the EXACT torrent it's playing as the room's `source`,
// and a web guest calls this to land on the same file (then feeds the
// direct link to /transcode for its <video> element).
//
// RD deprecated /torrents/instantAvailability (now returns empty), so
// "is this cached?" is detected the modern way: addMagnet ->
// selectFiles(the one file) -> poll status. A cached torrent flips to
// `downloaded` within a second or two; a NON-cached one goes
// `downloading` (RD would start a fresh download) — we refuse that,
// delete the torrent so it doesn't actually download, and 404 so the
// guest falls back to its own pick. Note: we select ONLY the requested
// file, so a cache MISS never triggers a multi-GB RD download.
const RD_API = 'https://api.real-debrid.com/rest/1.0';
const rdByHashCache = new Map(); // `${infoHash}:${fileIdx}` -> { direct, exp }
const RD_BY_HASH_TTL = 20 * 60 * 1000; // RD direct links live hours; re-resolve well within that
const rdDelay = (ms) => new Promise((r) => setTimeout(r, ms));

function rdApi(path, { method = 'GET', form = null } = {}) {
  const rdKey = process.env.RD_FALLBACK_KEY || '';
  const headers = { Authorization: `Bearer ${rdKey}` };
  let body = null;
  if (form) {
    body = new URLSearchParams(form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  return requestJson(`${RD_API}${path}`, { method, headers, body, timeoutMs: 15000 });
}

async function rdDeleteTorrent(id) {
  if (!id) return;
  try { await rdApi(`/torrents/delete/${id}`, { method: 'DELETE' }); } catch { /* best effort */ }
}

// Returns a direct https RD link for the file, or null (not cached / error).
async function resolveRdByHash(infoHash, fileIdx) {
  const key = `${infoHash}:${fileIdx == null ? '*' : fileIdx}`;
  const cached = rdByHashCache.get(key);
  if (cached && cached.exp > Date.now()) return cached.direct;
  if (!process.env.RD_FALLBACK_KEY) return null;

  let torrentId = null;
  try {
    const add = await rdApi('/torrents/addMagnet', {
      method: 'POST',
      form: { magnet: `magnet:?xt=urn:btih:${infoHash}` },
    });
    torrentId = add && add.json && add.json.id;
    if (!torrentId) return null;

    // Wait for the file list (magnet_conversion -> waiting_files_selection).
    let info = null;
    for (let i = 0; i < 6; i++) {
      const r = await rdApi(`/torrents/info/${torrentId}`);
      info = r && r.json;
      if (!info) break;
      if (['magnet_error', 'error', 'virus', 'dead'].includes(info.status)) { await rdDeleteTorrent(torrentId); return null; }
      if (Array.isArray(info.files) && info.files.length) break;
      await rdDelay(700);
    }
    if (!info || !Array.isArray(info.files) || !info.files.length) { await rdDeleteTorrent(torrentId); return null; }

    // Map the Stremio fileIdx (0-based into the torrent's file list) to RD's
    // file id; if no idx given, take the largest file.
    let rdFileId = null;
    if (fileIdx != null && info.files[fileIdx]) rdFileId = info.files[fileIdx].id;
    if (rdFileId == null) {
      const biggest = info.files.slice().sort((a, b) => (b.bytes || 0) - (a.bytes || 0))[0];
      rdFileId = biggest && biggest.id;
    }
    if (rdFileId == null) { await rdDeleteTorrent(torrentId); return null; }

    await rdApi(`/torrents/selectFiles/${torrentId}`, { method: 'POST', form: { files: String(rdFileId) } });

    // Poll for `downloaded` (cached => near-instant). If RD starts a fresh
    // download instead, bail: the guest shouldn't wait minutes/hours.
    let ready = null;
    for (let i = 0; i < 6; i++) {
      const r = await rdApi(`/torrents/info/${torrentId}`);
      const inf = r && r.json;
      if (inf && inf.status === 'downloaded' && Array.isArray(inf.links) && inf.links.length) { ready = inf; break; }
      if (inf && ['downloading', 'queued', 'compressing', 'uploading'].includes(inf.status)) { await rdDeleteTorrent(torrentId); return null; }
      await rdDelay(700);
    }
    if (!ready) { await rdDeleteTorrent(torrentId); return null; }

    const unr = await rdApi('/unrestrict/link', { method: 'POST', form: { link: ready.links[0] } });
    const direct = unr && unr.json && unr.json.download;
    if (!direct || !/^https?:\/\//i.test(direct)) { await rdDeleteTorrent(torrentId); return null; }

    // Keep the torrent (RD dedupes by hash, so re-adds are free) and cache the
    // resolved direct link.
    rdByHashCache.set(key, { direct, exp: Date.now() + RD_BY_HASH_TTL });
    return direct;
  } catch {
    await rdDeleteTorrent(torrentId);
    return null;
  }
}

const ANI_TV_FORMATS = new Set(['TV', 'TV_SHORT', 'ONA']);
const aniChainCache = new Map(); // anilistId -> { chain, exp }
const aniSkipCache = new Map();  // `${mal}:${ep}:${len}` -> { intervals, exp }
const ANI_CHAIN_TTL = 24 * 60 * 60 * 1000;
const ANI_SKIP_TTL = 6 * 60 * 60 * 1000;

const aniStartKey = (d) =>
  d ? (d.year || 9999) * 10000 + (d.month || 99) * 100 + (d.day || 99) : 99999999;

async function aniListNode(anilistId) {
  const query =
    'query($id:Int){Media(id:$id,type:ANIME){id idMal format startDate{year month day}' +
    ' relations{edges{relationType node{id idMal format type startDate{year month day}}}}}}';
  const resp = await requestJson('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: anilistId } }),
  });
  return resp.json && resp.json.data ? resp.json.data.Media : null;
}

/** Chronological list of TV cours reachable from `startAnilistId` via
 *  PREQUEL/SEQUEL edges. Stremio season N maps to chain[N-1]. */
async function buildAniTvChain(startAnilistId) {
  const cached = aniChainCache.get(startAnilistId);
  if (cached && cached.exp > Date.now()) return cached.chain;
  const diskChain = await jsonCacheGet('anichain', startAnilistId);
  if (diskChain !== undefined) {
    aniChainCache.set(startAnilistId, { chain: diskChain, exp: Date.now() + ANI_CHAIN_TTL });
    return diskChain;
  }
  const visited = new Map();
  const queue = [startAnilistId];
  let guard = 0;
  while (queue.length && guard < 14) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    guard += 1;
    let node = null;
    try { node = await aniListNode(id); } catch { node = null; }
    if (!node) continue;
    visited.set(node.id, { idMal: node.idMal, format: node.format, start: aniStartKey(node.startDate) });
    const edges = node.relations && node.relations.edges ? node.relations.edges : [];
    for (const e of edges) {
      if (e.relationType !== 'PREQUEL' && e.relationType !== 'SEQUEL') continue;
      const n = e.node;
      if (n && n.type === 'ANIME' && ANI_TV_FORMATS.has(n.format) && !visited.has(n.id)) queue.push(n.id);
    }
  }
  const chain = [...visited.values()]
    .filter((v) => ANI_TV_FORMATS.has(v.format))
    .sort((a, b) => a.start - b.start);
  aniChainCache.set(startAnilistId, { chain, exp: Date.now() + ANI_CHAIN_TTL });
  // Persist non-empty chains long (relations rarely change); skip empties so a
  // transient AniList failure doesn't pin a blank chain.
  if (chain.length) jsonCacheSet('anichain', startAnilistId, chain, 7 * 24 * 60 * 60 * 1000);
  return chain;
}

/** AniSkip op/ed/recap intervals (seconds) for a MAL id + episode. Cached. */
async function aniskipIntervals(mal, episode, episodeLength) {
  const ckey = `${mal}:${episode}:${Math.round(episodeLength)}`;
  const cc = aniSkipCache.get(ckey);
  if (cc && cc.exp > Date.now()) return cc.intervals;
  const disk = await jsonCacheGet('aniskip', ckey);
  if (disk !== undefined) {
    aniSkipCache.set(ckey, { intervals: disk, exp: Date.now() + ANI_SKIP_TTL });
    return disk;
  }
  const types = ['op', 'ed', 'recap', 'mixed-op', 'mixed-ed'].map((t) => `types=${t}`).join('&');
  const askUrl = `https://api.aniskip.com/v2/skip-times/${mal}/${episode}?${types}&episodeLength=${episodeLength}`;
  const ask = await requestJson(askUrl).catch(() => null);
  const results = ask && ask.json && Array.isArray(ask.json.results) ? ask.json.results : [];
  const intervals = [];
  for (const r of results) {
    const iv = r && r.interval;
    if (!iv) continue;
    const start = Number(iv.startTime);
    const end = Number(iv.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start < 0) continue;
    // Reject gross episode-length mismatches (wrong cut / cour).
    if (episodeLength > 0 && Number.isFinite(r.episodeLength) && Math.abs(r.episodeLength - episodeLength) > 90) continue;
    const kind = r.skipType === 'ed' || r.skipType === 'mixed-ed' ? 'outro' : r.skipType === 'recap' ? 'recap' : 'intro';
    intervals.push({ type: kind, start, end });
  }
  aniSkipCache.set(ckey, { intervals, exp: Date.now() + ANI_SKIP_TTL });
  // Skip markers are immutable per episode → persist non-empty results long;
  // recheck empties on the short TTL in case AniSkip gains data later.
  jsonCacheSet('aniskip', ckey, intervals, intervals.length ? 30 * 24 * 60 * 60 * 1000 : ANI_SKIP_TTL);
  return intervals;
}

const tidbCache = new Map(); // `${idParam}:${season}:${episode}:${len}` -> { intervals, exp }
const TIDB_TTL = 6 * 60 * 60 * 1000;

/** TheIntroDB (theintrodb.org) intro/recap/credits intervals (seconds) for a
 *  TV episode. Keyed by tmdb_id when available (canonical), else imdb_id.
 *  Covers live-action series + movies; complements AniSkip for anime. Cached. */
async function tidbIntervals({ tmdbId, imdbId, season, episode, episodeLength }) {
  const idParam = tmdbId
    ? `tmdb_id=${encodeURIComponent(tmdbId)}`
    : imdbId
      ? `imdb_id=${encodeURIComponent(imdbId)}`
      : null;
  if (!idParam) return [];
  const durMs = episodeLength > 0 ? Math.round(episodeLength * 1000) : 0;
  const key = `${idParam}:${season}:${episode}:${Math.round(episodeLength)}`;
  const c = tidbCache.get(key);
  if (c && c.exp > Date.now()) return c.intervals;
  const diskTidb = await jsonCacheGet('tidb', key);
  if (diskTidb !== undefined) {
    tidbCache.set(key, { intervals: diskTidb, exp: Date.now() + TIDB_TTL });
    return diskTidb;
  }
  let qs = `${idParam}&season=${season}&episode=${episode}`;
  if (durMs) qs += `&duration_ms=${durMs}`;
  const resp = await requestJson(`https://api.theintrodb.org/v3/media?${qs}`).catch(() => null);
  const data = resp && resp.json ? resp.json : null;
  const intervals = [];
  const add = (arr, type) => {
    if (!Array.isArray(arr)) return;
    for (const seg of arr) {
      // start_ms null => from the very start (0); end_ms null => to end of
      // media (use the known duration, else we can't bound it → skip).
      const start = seg && seg.start_ms == null ? 0 : Number(seg && seg.start_ms);
      const end = seg && seg.end_ms == null ? durMs : Number(seg && seg.end_ms);
      if (!Number.isFinite(start) || start < 0) continue;
      if (!Number.isFinite(end) || end <= start) continue;
      intervals.push({ type, start: start / 1000, end: end / 1000 });
    }
  };
  if (data) {
    add(data.intro, 'intro');
    add(data.recap, 'recap');
    add(data.credits, 'outro');
  }
  tidbCache.set(key, { intervals, exp: Date.now() + TIDB_TTL });
  jsonCacheSet('tidb', key, intervals, intervals.length ? 30 * 24 * 60 * 60 * 1000 : TIDB_TTL);
  return intervals;
}

const TEXT_SUBTITLE_CODECS = new Set([
  'subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text',
]);

function probeStreams(targetUrl, done) {
  targetUrl = rewriteLoopback(targetUrl);
  const ff = spawn('ffprobe', [
    '-loglevel', 'error',
    '-print_format', 'json',
    '-show_streams',
    '-show_chapters',
    '-analyzeduration', '10000000',
    '-probesize', '10000000',
    targetUrl,
  ]);
  let stdout = '';
  let stderr = '';
  ff.stdout.on('data', (b) => { stdout += b.toString(); });
  ff.stderr.on('data', (b) => { stderr += b.toString(); });
  const killer = setTimeout(() => ff.kill('SIGKILL'), 30000);
  ff.on('close', (code) => {
    clearTimeout(killer);
    if (code !== 0) {
      done({ error: stderr.trim().slice(0, 500) || `ffprobe exit ${code}`, subtitles: [], chapters: [], video: null });
      return;
    }
    let parsed;
    try { parsed = JSON.parse(stdout); }
    catch (err) { done({ error: 'parse error: ' + err.message, subtitles: [], chapters: [], video: null }); return; }
    const streams = parsed.streams || [];
    const subs = streams
      .filter((s) => s.codec_type === 'subtitle')
      .map((s) => ({
        index: s.index,
        codec: s.codec_name,
        language: (s.tags && (s.tags.language || s.tags.LANGUAGE)) || 'und',
        title: (s.tags && (s.tags.title || s.tags.TITLE)) || null,
        forced: s.disposition && (s.disposition.forced === 1),
        default: s.disposition && (s.disposition.default === 1),
        textBased: TEXT_SUBTITLE_CODECS.has((s.codec_name || '').toLowerCase()),
      }));
    const video = (() => {
      const v = streams.find((s) => s.codec_type === 'video');
      if (!v) return null;
      const transfer = (v.color_transfer || '').toLowerCase();
      const primaries = (v.color_primaries || '').toLowerCase();
      // smpte2084 = PQ (HDR10/DV), arib-std-b67 = HLG, bt2020 = wide gamut
      const isHdr =
        transfer === 'smpte2084' ||
        transfer === 'arib-std-b67' ||
        primaries === 'bt2020';
      return {
        width: v.width || null,
        height: v.height || null,
        codec: v.codec_name || null,
        bitDepth: v.bits_per_raw_sample ? Number.parseInt(v.bits_per_raw_sample, 10) : null,
        colorTransfer: v.color_transfer || null,
        colorPrimaries: v.color_primaries || null,
        isHdr,
        is4k: (v.width || 0) >= 3840,
      };
    })();
    const chapters = (parsed.chapters || []).map((c) => ({
      id: c.id,
      time: c.start_time != null ? Number.parseFloat(c.start_time) : 0,
      end: c.end_time != null ? Number.parseFloat(c.end_time) : 0,
      title: (c.tags && (c.tags.title || c.tags.TITLE)) || null,
    }));
    done({ subtitles: subs, chapters, video });
  });
  ff.on('error', (err) => {
    clearTimeout(killer);
    done({ error: 'spawn error: ' + err.message, subtitles: [], chapters: [], video: null });
  });
}

function extractSubtitleVtt(targetUrl, trackIndex, res) {
  targetUrl = rewriteLoopback(targetUrl);
  const ff = spawn('ffmpeg', [
    '-loglevel', 'error',
    '-i', targetUrl,
    '-map', `0:${trackIndex}`,
    '-c:s', 'webvtt',
    '-f', 'webvtt',
    '-',
  ]);
  let stderr = '';
  ff.stderr.on('data', (b) => { stderr += b.toString(); });
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  ff.stdout.pipe(res);
  const killer = setTimeout(() => ff.kill('SIGKILL'), 120000);
  ff.on('close', (code) => {
    clearTimeout(killer);
    if (code !== 0 && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('ffmpeg extract failed: ' + stderr.trim().slice(0, 300));
    } else if (code !== 0) {
      res.end();
    }
  });
  ff.on('error', () => {
    clearTimeout(killer);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('ffmpeg spawn error');
    } else {
      res.end();
    }
  });
}
const STREMIO_AUTH_BASE = process.env.STREMIO_AUTH_BASE || 'https://www.strem.io';

function headProbe(targetUrl, redirectCount, done) {
  if (redirectCount > 5) {
    done({ status: 502, contentLength: 0, error: 'too many redirects' });
    return;
  }
  targetUrl = rewriteLoopback(targetUrl);
  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    done({ status: 400, contentLength: 0, error: 'invalid url' });
    return;
  }
  if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
    done({ status: 400, contentLength: 0, error: 'invalid protocol' });
    return;
  }
  const client = parsedTarget.protocol === 'https:' ? https : http;
  const probeReq = client.request(
    targetUrl,
    { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Blissful/1.0)' }, timeout: 6000 },
    (probeRes) => {
      const status = probeRes.statusCode || 502;
      if ([301, 302, 303, 307, 308].includes(status) && probeRes.headers.location) {
        probeRes.resume();
        const redirectUrl = new URL(probeRes.headers.location, targetUrl).toString();
        headProbe(redirectUrl, redirectCount + 1, done);
        return;
      }
      const contentLength = Number.parseInt(probeRes.headers['content-length'] || '0', 10) || 0;
      probeRes.resume();
      done({ status, contentLength, finalUrl: targetUrl });
    }
  );
  probeReq.on('error', (err) => done({ status: 502, contentLength: 0, error: err.message }));
  probeReq.on('timeout', () => { probeReq.destroy(); done({ status: 504, contentLength: 0, error: 'timeout' }); });
  probeReq.end();
}

function rewriteLoopback(targetUrl) {
  try {
    const u = new URL(targetUrl);
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1') {
      u.hostname = 'host.docker.internal';
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return targetUrl;
}

// Videasy CDN hosts require `Origin: https://cineby.sc` (and matching
// Referer) — they 403 anything else. Browser JS can't set Origin
// directly, so all playback (playlist + each TS segment) has to flow
// through this proxy, which injects the spoofed headers server-side.
const VIDEASY_CDN_HOST_SUFFIXES = [
  'midwesteagle.com',   // yoru.midwesteagle.com (cdn provider)
  'speedsterwave.app',  // mb-flix provider HLS host
  'shegu.net',          // e3b0c442 provider (legacy)
  'nightspeedster.app', // easy.nightspeedster.app — 'cdn' provider (rotated from speedsterwave); 403s without Origin: cineby.sc
];
function isVideasyCdn(hostname) {
  const h = String(hostname || '').toLowerCase();
  return VIDEASY_CDN_HOST_SUFFIXES.some((s) => h === s || h.endsWith('.' + s));
}

// Videasy returns subtitle language as a display name (English,
// Arabic, etc.). The web player wants ISO 639 codes for matching
// against user preference settings. Map the common cases.
const LANG_NAME_TO_CODE = {
  english: 'eng',
  spanish: 'spa',
  french: 'fra',
  italian: 'ita',
  portuguese: 'por',
  'portuguese (brazil)': 'por',
  german: 'deu',
  dutch: 'nld',
  russian: 'rus',
  polish: 'pol',
  turkish: 'tur',
  arabic: 'ara',
  hindi: 'hin',
  japanese: 'jpn',
  korean: 'kor',
  chinese: 'zho',
  'chinese (simplified)': 'zho',
  'chinese (traditional)': 'zho',
  ukrainian: 'ukr',
  bulgarian: 'bul',
  czech: 'ces',
  danish: 'dan',
  finnish: 'fin',
  greek: 'ell',
  hebrew: 'heb',
  hungarian: 'hun',
  indonesian: 'ind',
  norwegian: 'nor',
  romanian: 'ron',
  swedish: 'swe',
  thai: 'tha',
  vietnamese: 'vie',
};
function videasyLangToCode(name) {
  if (!name) return 'und';
  const key = String(name).trim().toLowerCase();
  return LANG_NAME_TO_CODE[key] || key;
}

// Rewrite absolute URLs inside an m3u8 playlist to route back through
// /addon-proxy. HLS.js can't add custom request headers in the browser,
// so each segment fetch has to be proxied (which spoofs Origin/Referer
// upstream). EXT-X-KEY URI="..." lines get the same treatment.
//
// `publicOrigin` (e.g. "https://blissful.budinoff.com"), when provided,
// emits ABSOLUTE segment URLs instead of path-absolute ones. iOS
// Safari's native HLS (AVPlayer) is fussy about relative segment URLs
// that contain query strings and sometimes refuses to fetch them;
// absolute URLs sidestep the problem entirely.
function rewriteHlsPlaylist(body, baseUrl, publicOrigin, vd) {
  const base = new URL(baseUrl);
  const prefix = publicOrigin ? publicOrigin.replace(/\/+$/, '') : '';
  // Carry the vd=1 flag onto each segment/key URL so they keep getting the
  // cineby.sc spoof when fetched back (the segments live on the same CDN).
  const suffix = vd ? '&vd=1' : '';
  const proxify = (u) => {
    try {
      const abs = new URL(u, base).toString();
      return prefix + '/addon-proxy?url=' + encodeURIComponent(abs) + suffix;
    } catch {
      return u;
    }
  };
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (line.startsWith('#')) {
      // Rewrite URI="..." attributes (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA).
      lines[i] = line.replace(/URI="([^"]+)"/g, (_m, u) => `URI="${proxify(u)}"`);
      continue;
    }
    // Bare segment URL line — rewrite to a proxied path.
    lines[i] = proxify(line.trim());
  }
  return lines.join('\n');
}

function proxyRequest(req, res, targetUrl, headers = {}, redirectCount = 0) {
  if (redirectCount > 5) {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end('Too many redirects');
    return;
  }

  targetUrl = rewriteLoopback(targetUrl);

  let parsedTarget;
  try {
    parsedTarget = new URL(targetUrl);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid URL');
    return;
  }

  if (!['http:', 'https:'].includes(parsedTarget.protocol)) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Invalid protocol');
    return;
  }

  const client = parsedTarget.protocol === 'https:' ? https : http;
  // `vd=1` marks a Videasy source (set by /videasy-sources + the playlist
  // rewriter) — force the cineby.sc spoof for ANY host, not just an allowlist.
  const vd = /[?&]vd=1(?:&|$)/.test(req.url || '');
  const isVideasy = isVideasyCdn(parsedTarget.hostname) || vd;
  const requestHeaders = {
    'User-Agent': isVideasy
      ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
      : 'Mozilla/5.0 (compatible; Blissful/1.0)',
    Accept: req.headers.accept || 'application/json, */*',
    'Content-Type': req.headers['content-type'],
    'Content-Length': req.headers['content-length'],
    Cookie: req.headers.cookie,
    Authorization: req.headers.authorization,
    // Videasy CDN hosts validate Origin/Referer — must be the Vidking player
    // origin, NOT the browser's actual origin. (Was cineby.sc; Vidking moved to
    // vidking.net and the CDN now 403s cineby.sc — verified the CDN returns 200
    // for vidking.net, 403 for cineby.sc/none.) For everything else, pass through.
    Origin: isVideasy ? 'https://www.vidking.net' : req.headers.origin,
    Referer: isVideasy ? 'https://www.vidking.net/' : req.headers.referer,
    Range: req.headers.range,
    ...headers,
  };

  for (const [key, value] of Object.entries(requestHeaders)) {
    if (value === undefined || value === null || value === '' || value === 'undefined') {
      delete requestHeaders[key];
    }
  }

  const proxyReq = client.request(
    targetUrl,
    {
      method: req.method || 'GET',
      headers: requestHeaders,
      timeout: 15000,
    },
    (proxyRes) => {
      // Follow redirects server-side (torrentio resolve → RD CDN)
      const status = proxyRes.statusCode || 502;
      if ([301, 302, 303, 307, 308].includes(status) && proxyRes.headers.location) {
        proxyRes.resume(); // drain the response body
        const redirectUrl = new URL(proxyRes.headers.location, targetUrl).toString();
        console.log(`Redirect ${status}: ${redirectUrl}`);
        proxyRequest(req, res, redirectUrl, {}, redirectCount + 1);
        return;
      }

      const responseHeaders = {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
      };

      if (proxyRes.headers['content-length']) {
        responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
      }
      if (proxyRes.headers['content-range']) {
        responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
      }
      if (proxyRes.headers['accept-ranges']) {
        responseHeaders['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
      }

      // HLS playlist from a Videasy CDN — buffer, rewrite each
      // segment/key URL to /addon-proxy, then send. Browsers can't
      // forge Origin per segment so the whole stream has to be
      // proxied. Other content (TS segments, JSON, etc.) is piped
      // through unchanged.
      const ct = String(proxyRes.headers['content-type'] || '').toLowerCase();
      const looksLikePlaylist =
        isVideasy &&
        (ct.includes('mpegurl') ||
          ct.includes('x-mpegurl') ||
          /\.m3u8(\?|$)/i.test(parsedTarget.pathname + parsedTarget.search));
      if (looksLikePlaylist) {
        let buf = '';
        proxyRes.setEncoding('utf8');
        proxyRes.on('data', (c) => { buf += c; });
        proxyRes.on('end', () => {
          // Build absolute origin from the request headers so the
          // rewritten segment URLs work with iOS AVPlayer (it does
          // not always resolve relative segment URLs that contain
          // query strings). Falls back to "" → path-absolute when
          // headers are missing (e.g. unit tests).
          //
          // CF Tunnel + Traefik terminate TLS at the edge so the
          // request reaches us over plain HTTP — X-Forwarded-Proto
          // arrives as "http" even though the user is on HTTPS.
          // Force https for our known public host so the emitted
          // segment URLs don't trigger mixed-content blocking
          // (segments would be HTTP, page is HTTPS → browser drops
          // the video track and you get audio-only).
          const host = req.headers['x-forwarded-host'] || req.headers.host || '';
          const isPublicHost = String(host).endsWith('blissful.budinoff.com');
          const xfp = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
          const proto = isPublicHost
            ? 'https'
            : (xfp || (req.socket && req.socket.encrypted ? 'https' : 'http'));
          const publicOrigin = host ? `${proto}://${host}` : '';
          const rewritten = rewriteHlsPlaylist(buf, targetUrl, publicOrigin, vd);
          delete responseHeaders['Content-Length'];
          res.writeHead(status, responseHeaders);
          res.end(rewritten);
        });
        proxyRes.on('error', () => {
          if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end();
        });
        return;
      }

      res.writeHead(status, responseHeaders);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end('Proxy error: ' + err.message);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'text/plain' });
    }
    res.end('Gateway timeout');
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    proxyReq.end();
    return;
  }

  req.pipe(proxyReq);
}

// ── Watch Party v2 Layer B — host relay ──────────────────────────────────
// A desktop host isn't reachable from a guest's browser (NAT / mixed-content),
// so the host dials an OUTBOUND WebSocket tunnel into us and we PULL its locally
// transcoded HLS on demand, caching segments so N guests cost the host ~one
// fetch each. The host registers (room, relayKey) on the tunnel; guests fetch
// `/party-relay/{room}/<path>?k=<relayKey>`. See docs/WATCH-PARTY-V2.md (B).
// `ws` is installed ad-hoc by the container command (like crypto-js); guard the
// require so the proxy still boots if it's missing (relay just stays off).
let PartyRelayWSS = null;
try {
  PartyRelayWSS = require('ws').WebSocketServer;
} catch {
  console.warn('[party-relay] ws module unavailable — host relay disabled');
}
// room -> { ws, key, pending: Map<id,{resolve,reject,timer}>, nextId }
const partyRelayHosts = new Map();
// `${room}\n${path}` -> { exp, contentType, body:Buffer }  (cached responses)
const partyRelaySegCache = new Map();
// `${room}\n${path}` -> Promise  (coalesce concurrent identical pulls → 1 fetch)
const partyRelayInflight = new Map();
const PARTY_RELAY_PULL_TIMEOUT = 25000;
const PARTY_RELAY_SEG_TTL = 120 * 1000; // segments live long enough to fan out
const PARTY_RELAY_PLAYLIST_TTL = 4 * 1000; // playlists refresh fast (live-ish)
const PARTY_RELAY_MAX_CACHE = 400;

function partyRelayPull(room, reqPath) {
  const entry = partyRelayHosts.get(room);
  if (!entry || !entry.ws || entry.ws.readyState !== 1) return Promise.reject(new Error('no-host'));
  const id = entry.nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      entry.pending.delete(id);
      reject(new Error('pull-timeout'));
    }, PARTY_RELAY_PULL_TIMEOUT);
    entry.pending.set(id, { resolve, reject, timer });
    try {
      entry.ws.send(JSON.stringify({ t: 'pull', id, path: reqPath }));
    } catch (e) {
      clearTimeout(timer);
      entry.pending.delete(id);
      reject(e);
    }
  });
}

function partyRelayPullCoalesced(room, reqPath) {
  const key = room + '\n' + reqPath;
  const hit = partyRelayInflight.get(key);
  if (hit) return hit;
  const p = partyRelayPull(room, reqPath).finally(() => partyRelayInflight.delete(key));
  partyRelayInflight.set(key, p);
  return p;
}

// Append the relay key to a playlist URI so the guest's player carries it on the
// follow-up segment/sub-playlist fetch (relative URIs otherwise drop the query).
// Absolute loopback URLs (the host's 127.0.0.1:11470) collapse to their path so
// they route back through the tunnel.
function rewritePartyRelayUri(uri, key) {
  let u = uri.trim();
  const abs = u.match(/^https?:\/\/[^/]+\/(.*)$/i);
  if (abs) u = abs[1];
  const sep = u.includes('?') ? '&' : '?';
  return `${u}${sep}k=${encodeURIComponent(key)}`;
}
function rewritePartyRelayPlaylist(text, key) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        // EXT-X-KEY / EXT-X-MAP carry URI="..." attributes that also need it.
        return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${rewritePartyRelayUri(uri, key)}"`);
      }
      return rewritePartyRelayUri(trimmed, key);
    })
    .join('\n');
}

function partyRelayCachePut(cacheKey, contentType, body, ttl) {
  if (partyRelaySegCache.size >= PARTY_RELAY_MAX_CACHE) {
    let n = Math.ceil(PARTY_RELAY_MAX_CACHE * 0.1);
    for (const k of partyRelaySegCache.keys()) {
      partyRelaySegCache.delete(k);
      if (--n <= 0) break;
    }
  }
  partyRelaySegCache.set(cacheKey, { exp: Date.now() + ttl, contentType, body });
}

// Drop a room's cached segments/playlists immediately when its tunnel closes or
// re-registers (a new HLS session) — otherwise stale bytes linger up to the TTL
// and a re-used path could serve old-session content.
function purgePartyRelayCache(room) {
  const prefix = room + '\n';
  for (const k of partyRelaySegCache.keys()) {
    if (k.startsWith(prefix)) partyRelaySegCache.delete(k);
  }
}

// /rd-by-hash abuse guard: each resolve burns several house-RD API calls
// (addMagnet + poll + selectFiles + delete), so cap per-IP rate AND global
// concurrency. Returns a reason string to 429 with, or null when allowed.
const RDBH_RATE = 20; // tokens per window
const RDBH_WINDOW_MS = 60 * 1000; // per minute
const RDBH_MAX_CONCURRENT = 4;
let rdbhInflight = 0;
const rdbhBuckets = new Map(); // ip -> { tokens, ts }
function rdbhReject(ip) {
  if (rdbhBuckets.size > 5000) rdbhBuckets.clear(); // bound memory
  const now = Date.now();
  let b = rdbhBuckets.get(ip);
  if (!b) { b = { tokens: RDBH_RATE, ts: now }; rdbhBuckets.set(ip, b); }
  b.tokens = Math.min(RDBH_RATE, b.tokens + ((now - b.ts) / RDBH_WINDOW_MS) * RDBH_RATE);
  b.ts = now;
  if (b.tokens < 1) return 'rate limited';
  if (rdbhInflight >= RDBH_MAX_CONCURRENT) return 'busy';
  b.tokens -= 1;
  return null;
}

async function handlePartyRelay(req, res) {
  const q = url.parse(req.url, true);
  const after = q.pathname.slice('/party-relay/'.length);
  const slash = after.indexOf('/');
  if (slash < 0) { res.writeHead(404); res.end('bad relay path'); return; }
  const room = decodeURIComponent(after.slice(0, slash));
  const pathOnly = after.slice(slash + 1);
  const key = (q.query.k || '').toString();
  // Forward every query param EXCEPT our relay key to the host — stremio's
  // /hlsv2 master playlist needs `?mediaURL=…`; segment requests carry none.
  const fwd = new URLSearchParams();
  for (const [pk, pv] of Object.entries(q.query)) {
    if (pk === 'k') continue;
    if (Array.isArray(pv)) pv.forEach((v) => fwd.append(pk, v));
    else if (pv != null) fwd.append(pk, String(pv));
  }
  const fwdQs = fwd.toString();
  const reqPath = fwdQs ? `${pathOnly}?${fwdQs}` : pathOnly;
  const entry = partyRelayHosts.get(room);
  if (!entry) { console.log('[party-relay] GET room=%s path=%s -> 404 no host', room, reqPath); res.writeHead(404); res.end('no host for room'); return; }
  if (!key || key !== entry.key) { console.log('[party-relay] GET room=%s path=%s -> 403 bad key', room, reqPath); res.writeHead(403); res.end('bad relay key'); return; }
  console.log('[party-relay] GET room=%s path=%s', room, reqPath);

  const isPlaylist = /\.m3u8$/i.test(reqPath.split('?')[0]);
  const cacheKey = room + '\n' + reqPath;
  if (!isPlaylist) {
    const c = partyRelaySegCache.get(cacheKey);
    if (c && c.exp > Date.now()) {
      res.writeHead(200, { 'Content-Type': c.contentType, 'Cache-Control': 'public, max-age=60' });
      res.end(c.body);
      return;
    }
  }
  try {
    const r = await partyRelayPullCoalesced(room, reqPath);
    if (!r || !r.ok) {
      console.log('[party-relay] pull room=%s path=%s -> host returned not-ok', room, reqPath);
      res.writeHead(502); res.end('host fetch failed'); return;
    }
    console.log('[party-relay] pull room=%s path=%s -> ok status=%s type=%s bytes=%s', room, reqPath, r.status, r.contentType, r.body ? r.body.length : 0);
    let body = r.body;
    const contentType = r.contentType || (isPlaylist ? 'application/vnd.apple.mpegurl' : 'application/octet-stream');
    if (isPlaylist) {
      body = Buffer.from(rewritePartyRelayPlaylist(body.toString('utf8'), key), 'utf8');
      partyRelayCachePut(cacheKey, contentType, body, PARTY_RELAY_PLAYLIST_TTL);
    } else {
      partyRelayCachePut(cacheKey, contentType, body, PARTY_RELAY_SEG_TTL);
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=60' });
    res.end(body);
  } catch {
    res.writeHead(504); res.end('relay timeout');
  }
}

// Attach the host-tunnel WebSocket endpoint (`/party-relay-tunnel?room&key`) to
// the HTTP server's upgrade event. The host replies to our `{t:'pull',id,path}`
// with `{t:'pulled',id,ok,status,contentType,bodyB64}`.
function setupPartyRelayTunnel(httpServer) {
  if (!PartyRelayWSS) return;
  const wss = new PartyRelayWSS({ noServer: true });
  wss.on('connection', (ws, info) => {
    const { room, key } = info;
    const prev = partyRelayHosts.get(room);
    if (prev && prev.ws !== ws) { try { prev.ws.close(); } catch {} }
    purgePartyRelayCache(room); // new session/key → drop the prior session's cache
    const entry = { ws, key, pending: new Map(), nextId: 1 };
    partyRelayHosts.set(room, entry);
    console.log(`[party-relay] host tunnel up room=${room}`);
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.t !== 'pulled' || typeof msg.id !== 'number') return;
      const p = entry.pending.get(msg.id);
      if (!p) return;
      entry.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) {
        p.resolve({
          ok: true,
          status: msg.status || 200,
          contentType: msg.contentType || null,
          body: Buffer.from(msg.bodyB64 || '', 'base64'),
        });
      } else {
        p.resolve({ ok: false });
      }
    });
    const cleanup = () => {
      if (partyRelayHosts.get(room) === entry) partyRelayHosts.delete(room);
      for (const p of entry.pending.values()) { clearTimeout(p.timer); p.reject(new Error('host-gone')); }
      entry.pending.clear();
      purgePartyRelayCache(room); // host gone → its cached segments are dead weight
      console.log(`[party-relay] host tunnel down room=${room}`);
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  });
  httpServer.on('upgrade', (req, socket, head) => {
    const u = url.parse(req.url, true);
    if (u.pathname !== '/party-relay-tunnel') { socket.destroy(); return; }
    const room = (u.query.room || '').toString();
    const key = (u.query.key || '').toString();
    if (!room || !key) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, { room, key }));
  });
}

const server = http.createServer((req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Range');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Watch Party v2 Layer B — pull-through relay of a desktop host's HLS.
  if (req.method === 'GET' && req.url.startsWith('/party-relay/')) {
    handlePartyRelay(req, res);
    return;
  }

  // Player diagnostics sink — POST text/plain log lines from
  // SimplePlayer's `playerLog`. Appended to /app/logs/player.log
  // (mounted to /Volumes/2TB/NAS/blissful/logs/addon-proxy on
  // host). One POST per line; tiny bodies, fire-and-forget.
  if (req.method === 'POST' && (req.url === '/player-log' || req.url.startsWith('/player-log?'))) {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 8192) {
        // Hard cap so a runaway client can't flood the disk.
        req.destroy();
      }
    });
    req.on('end', () => {
      const trimmed = body.trim();
      if (trimmed) appendPlayerLog(trimmed);
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
      res.end();
    });
    req.on('error', () => {
      if (!res.headersSent) res.writeHead(400).end();
    });
    return;
  }

  // Videasy session-token push — the on-Mac undetected-chromedriver minter
  // POSTs a freshly-minted token here every ~40 min (guarded by a shared
  // secret; the port is 127.0.0.1-bound so this is localhost-only anyway).
  // Stored in memory and used for all upstream api.videasy.net calls.
  if (req.method === 'POST' && (req.url === '/videasy-token' || req.url.startsWith('/videasy-token?'))) {
    if (!VIDEASY_TOKEN_SECRET || req.headers['x-token-secret'] !== VIDEASY_TOKEN_SECRET) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
      return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      let tok = '';
      try { tok = String((JSON.parse(body || '{}').token) || '').trim(); } catch { tok = ''; }
      if (!/^[a-f0-9]{32,128}$/i.test(tok)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'bad_token' }));
        return;
      }
      _vdHttpTok = { val: tok, at: Date.now() };
      // Only the last 4 chars — never log the full secret/token.
      console.log(`[videasy] session token refreshed via push (…${tok.slice(-4)})`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    req.on('error', () => { if (!res.headersSent) res.writeHead(400).end(); });
    return;
  }

  if (req.url === '/health' || req.url === '/health/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // ── /img — caching image proxy ─────────────────────────────────────────
  // Posters/backdrops (metahub, TMDB) are cached on the Mac (NAS, 30d) and
  // served with a long Cache-Control so Cloudflare edge-caches too. A cached
  // file is ALWAYS served if present (artwork is immutable) — so once seen, an
  // image loads instantly and survives metahub's latency swings/outages. SSRF-
  // guarded to known artwork hosts since this writes to disk.
  if (req.url.startsWith('/img?')) {
    const target = url.parse(req.url, true).query.url;
    if (!target || typeof target !== 'string') { res.writeHead(400).end('bad url'); return; }
    let host;
    try { host = new URL(target).hostname; } catch { res.writeHead(400).end('bad url'); return; }
    if (!/(^|\.)metahub\.space$/i.test(host) && host !== 'image.tmdb.org' && !/(^|\.)fanart\.tv$/i.test(host)) {
      res.writeHead(400).end('host not allowed');
      return;
    }
    const key = crypto.createHash('sha1').update(target).digest('hex');
    const cachePath = path.join(IMG_CACHE_DIR, key);
    const ctypePath = `${cachePath}.t`;
    const longCache = {
      'Cache-Control': 'public, max-age=2592000, immutable',
      'Access-Control-Allow-Origin': '*',
    };
    fs.stat(cachePath, (statErr, st) => {
      if (!statErr && st.size > 0) {
        let ctype = 'image/jpeg';
        try { ctype = (fs.readFileSync(ctypePath, 'utf8').trim()) || ctype; } catch { /* default */ }
        res.writeHead(200, { 'Content-Type': ctype, ...longCache });
        fs.createReadStream(cachePath)
          .on('error', () => { if (!res.writableEnded) res.end(); })
          .pipe(res);
        return;
      }
      // One client = one waiter with its own deadline. If the fetch doesn't
      // finish in time we 504 THIS client (page stays usable) but never abort
      // the fetch — it keeps going and caches, so the next view is instant.
      let settled = false;
      const settle = (code, headers, buf) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadlineTimer);
        try {
          if (!res.headersSent && !res.writableEnded) { res.writeHead(code, headers); res.end(buf); }
        } catch { /* client gone */ }
      };
      const deadlineTimer = setTimeout(() => settle(504, { 'Content-Type': 'text/plain' }), IMG_CLIENT_DEADLINE);
      const waiter = { settle };

      // Already fetching this image? Attach to the in-flight fetch.
      if (imgInflight.has(key)) { imgInflight.get(key).push(waiter); return; }
      const waiters = [waiter];
      imgInflight.set(key, waiters);
      const flushAll = (code, headers, buf) => {
        imgInflight.delete(key);
        for (const w of waiters) w.settle(code, headers, buf);
      };
      imgFetchFollow(target, 5, (up) => {
        if ((up.statusCode || 0) !== 200) { up.resume(); flushAll(502, { 'Content-Type': 'text/plain' }); return; }
        const ctype = (up.headers['content-type'] || 'image/jpeg').split(';')[0].trim();
        const chunks = [];
        up.on('data', (c) => chunks.push(c));
        up.on('end', () => {
          const buf = Buffer.concat(chunks);
          // Atomic cache write — happens on completion regardless of whether any
          // waiter is still connected, so a slow first load still warms the cache.
          const tmp = `${cachePath}.tmp${process.pid}`;
          fs.writeFile(tmp, buf, (werr) => {
            if (werr) { fs.unlink(tmp, () => {}); return; }
            fs.rename(tmp, cachePath, () => {});
            fs.writeFile(ctypePath, ctype, () => {});
          });
          flushAll(200, { 'Content-Type': ctype, ...longCache }, buf);
        });
        up.on('error', () => flushAll(502, { 'Content-Type': 'text/plain' }));
      }, (kind) => flushAll(kind === 'timeout' ? 504 : 502, { 'Content-Type': 'text/plain' }));
    });
    return;
  }

  if (req.url === '/probe-streams' || req.url.startsWith('/probe-streams?')) {
    const parsed = url.parse(req.url, true);
    const targetUrl = parsed.query.url;
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }
    console.log(`Probing streams: ${targetUrl.slice(0, 120)}`);
    const probeStart = Date.now();
    probeStreams(targetUrl, (probeRes) => {
      console.log(`Probe done in ${Date.now() - probeStart}ms — ${(probeRes.subtitles || []).length} subs (${(probeRes.subtitles || []).filter((s) => s.textBased).length} text)${probeRes.error ? ` err=${probeRes.error}` : ''}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(probeRes));
    });
    return;
  }

  if (req.url.startsWith('/extract-subtitle.vtt?')) {
    const parsed = url.parse(req.url, true);
    const targetUrl = parsed.query.url;
    const trackIndex = Number.parseInt(parsed.query.track, 10);
    if (!targetUrl || !Number.isFinite(trackIndex)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url or track');
      return;
    }
    extractSubtitleVtt(targetUrl, trackIndex, res);
    return;
  }

  // Server-side IMDb → TMDB lookup. Falls back to the TMDB_API_KEY
  // env var when the client doesn't have its own key in player
  // settings (notably fresh iOS sessions, which have empty
  // localStorage and can't otherwise reach Videasy).
  if (req.url === '/tmdb-find' || req.url.startsWith('/tmdb-find?')) {
    const parsed = url.parse(req.url, true);
    const imdbId = String(parsed.query.imdbId || '').trim();
    if (!/^tt\d{5,}$/.test(imdbId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid imdbId' }));
      return;
    }
    const apiKey = process.env.TMDB_API_KEY || '';
    if (!apiKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'TMDB_API_KEY not configured' }));
      return;
    }
    const upstream =
      `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}` +
      `?api_key=${encodeURIComponent(apiKey)}&external_source=imdb_id`;
    // An IMDb→TMDB mapping is immutable, so cache a positive hit permanently;
    // cache a miss only briefly (a brand-new title may get a TMDB entry later).
    jsonCacheGet('tmdb-find', imdbId).then((cached) => {
      if (cached !== undefined) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cached));
        return;
      }
      https
        .get(upstream, (upRes) => {
          let buf = '';
          upRes.setEncoding('utf8');
          upRes.on('data', (c) => { buf += c; });
          upRes.on('end', () => {
            try {
              const data = JSON.parse(buf);
              const movieId = data?.movie_results?.[0]?.id;
              const tvId = data?.tv_results?.[0]?.id;
              let result = null;
              if (typeof movieId === 'number') result = { tmdbId: movieId, mediaType: 'movie' };
              else if (typeof tvId === 'number') result = { tmdbId: tvId, mediaType: 'tv' };
              jsonCacheSet('tmdb-find', imdbId, result, result ? 0 : 6 * 60 * 60 * 1000);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (e) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'tmdb parse: ' + e.message }));
            }
          });
        })
        .on('error', (err) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'tmdb fetch: ' + err.message }));
        });
    });
    return;
  }

  // IMDb rating for a title, resolved (Cinemeta → TMDB) and cached on the Mac
  // (~24h) so a scrolled grid of 50 cards doesn't fire 50 upstream lookup
  // chains. The frontend `useImdbRating` hook calls this once per title and
  // layers its own in-memory + sessionStorage cache on top.
  if (req.url === '/imdb-rating' || req.url.startsWith('/imdb-rating?')) {
    const imdbId = String(url.parse(req.url, true).query.imdbId || '').trim();
    if (!/^tt\d{5,}$/.test(imdbId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid imdbId' }));
      return;
    }
    jsonCacheGet('imdb-rating', imdbId).then((cached) => {
      if (cached !== undefined) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cached));
        return;
      }
      resolveImdbRating(imdbId)
        .then((result) => {
          // Hit caches a day (ratings drift slowly); a miss is rechecked
          // sooner so a freshly-rated title gets picked up.
          jsonCacheSet('imdb-rating', imdbId, result,
            result.rating != null ? 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        })
        .catch(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ rating: null }));
        });
    });
    return;
  }

  // OpenSubtitles v3 with a PERSISTENT server-side cache. The community
  // opensubtitles-v3.strem.io instance 504s often (overloaded), so a fresh
  // browser session frequently gets nothing while a desktop app shows stale
  // in-memory cache. We cache successful results to NAS JSON (subs for a
  // released episode are immutable) + retry with a generous timeout the browser
  // can't afford, so once any client fetches them they're served instantly
  // forever — riding out the addon's outages. videoHash/videoSize (computed by
  // the player) hit the addon's fast hash-matched path.
  if (req.url === '/opensubs' || req.url.startsWith('/opensubs?')) {
    const q = url.parse(req.url, true).query;
    const stype = String(q.type || '').trim();
    const sid = String(q.id || '').trim();
    const vh = String(q.videoHash || '').trim();
    const vs = String(q.videoSize || '').trim();
    const cacheOnly = String(q.cacheOnly || '') === '1';
    if (!stype || !sid) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ subtitles: [] }));
      return;
    }
    // Episode-level key (type:id) — shared across EVERY torrent of the episode
    // so the cached subs show on all releases, not just the one file we first
    // hashed. Per-file key (incl the hash) only throttles repeat MISSES so a
    // dead-addon fetch for one release doesn't re-hammer on every reopen.
    const keyEp = `${stype}:${sid}::`;
    const keyHash = `${stype}:${sid}:${vh}:${vs}`;
    const send = (obj) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(obj));
    };
    void (async () => {
      // 1. Episode-level subs cached from ANY release → serve to all.
      const ep = await jsonCacheGet('opensubs', keyEp);
      if (ep && Array.isArray(ep.subtitles) && ep.subtitles.length) return send(ep);
      // 2. A recent result for THIS exact file (a pre-migration per-file hit, or
      //    a miss we cached to throttle) → serve it. Promote a hit to
      //    episode-level so other releases of this episode get it too.
      const h = await jsonCacheGet('opensubs', keyHash);
      if (h !== undefined) {
        if (keyHash !== keyEp && Array.isArray(h.subtitles) && h.subtitles.length) {
          await jsonCacheSet('opensubs', keyEp, h, 30 * 24 * 60 * 60 * 1000);
        }
        return send(h);
      }
      // Cache-only probe (the desktop player fires one BEFORE its slow hash
      // poll so warm titles show subs instantly): serve steps 1-2 from cache,
      // but never hit the flaky upstream and never cache the miss — the
      // caller's real (hash-matched, retried) fetch follows and fills the
      // cache with the better result.
      if (cacheOnly) return send({ subtitles: [] });
      // 3. Fetch with the hash (the addon's fast path; hashless 504s more).
      const extra = vh
        ? `videoHash=${encodeURIComponent(vh)}${vs ? `&videoSize=${encodeURIComponent(vs)}` : ''}`
        : '';
      const target = extra
        ? `https://opensubtitles-v3.strem.io/subtitles/${stype}/${encodeURIComponent(sid)}/${extra}.json`
        : `https://opensubtitles-v3.strem.io/subtitles/${stype}/${encodeURIComponent(sid)}.json`;
      let subs = null;
      for (let attempt = 0; attempt < 2 && subs === null; attempt++) {
        try {
          const r = await requestJson(target, { timeoutMs: 22000 });
          if (r.status === 200 && r.json && Array.isArray(r.json.subtitles)) subs = r.json.subtitles;
        } catch { /* 504 / timeout / parse — retry once, then give up */ }
      }
      const payload = { subtitles: subs || [] };
      if (subs && subs.length) {
        // Success → cache EPISODE-level (30d), so every release of this episode
        // gets the subs from now on.
        await jsonCacheSet('opensubs', keyEp, payload, 30 * 24 * 60 * 60 * 1000);
      } else {
        // Miss → throttle re-fetch for THIS file only (30 min); leave the
        // episode key open so another release can still populate it.
        await jsonCacheSet('opensubs', keyHash, payload, 30 * 60 * 1000);
      }
      send(payload);
    })();
    return;
  }

  // Per-episode rating fallback via TMDB. Cinemeta sometimes ships
  // "0" (its "no rating" placeholder) for whole series — falling
  // back to the show-level IMDb rating is misleading, so the client
  // hits this endpoint to pull the episode's `vote_average` from
  // TMDB. Uses the same TMDB_API_KEY as /tmdb-find.
  if (req.url === '/tmdb-episode-rating' || req.url.startsWith('/tmdb-episode-rating?')) {
    const parsed = url.parse(req.url, true);
    const tmdbId = String(parsed.query.tmdbId || '').trim();
    const season = String(parsed.query.season || '').trim();
    const episode = String(parsed.query.episode || '').trim();
    if (!/^\d+$/.test(tmdbId) || !/^\d+$/.test(season) || !/^\d+$/.test(episode)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid tmdbId/season/episode' }));
      return;
    }
    const apiKey = process.env.TMDB_API_KEY || '';
    if (!apiKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'TMDB_API_KEY not configured' }));
      return;
    }
    const epKey = `${tmdbId}:${season}:${episode}`;
    jsonCacheGet('tmdb-ep-rating', epKey).then((cached) => {
      if (cached !== undefined) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cached));
        return;
      }
      const upstream =
        `https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdbId)}` +
        `/season/${encodeURIComponent(season)}` +
        `/episode/${encodeURIComponent(episode)}` +
        `?api_key=${encodeURIComponent(apiKey)}`;
      https
        .get(upstream, (upRes) => {
          let buf = '';
          upRes.setEncoding('utf8');
          upRes.on('data', (c) => { buf += c; });
          upRes.on('end', () => {
            try {
              const data = JSON.parse(buf);
              const va = data?.vote_average;
              const rating =
                typeof va === 'number' && Number.isFinite(va) && va > 0
                  ? Number(va.toFixed(1))
                  : null;
              const payload = { rating };
              // Episode ratings barely move; a miss is rechecked sooner so a
              // freshly-rated episode gets picked up.
              jsonCacheSet('tmdb-ep-rating', epKey, payload,
                rating != null ? 7 * 24 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(payload));
            } catch (e) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'tmdb parse: ' + e.message }));
            }
          });
        })
        .on('error', (err) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'tmdb fetch: ' + err.message }));
        });
    });
    return;
  }

  // Season info: overview + per-episode runtime + per-episode
  // overview. Drives the episodes drawer in SimplePlayer so the
  // season header description is season-specific (not the
  // show-level description) and each card can display its own
  // runtime + description even when Cinemeta doesn't ship them.
  if (req.url === '/tmdb-season-info' || req.url.startsWith('/tmdb-season-info?')) {
    const parsed = url.parse(req.url, true);
    const tmdbId = String(parsed.query.tmdbId || '').trim();
    const season = String(parsed.query.season || '').trim();
    if (!/^\d+$/.test(tmdbId) || !/^\d+$/.test(season)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid tmdbId/season' }));
      return;
    }
    const apiKey = process.env.TMDB_API_KEY || '';
    if (!apiKey) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'TMDB_API_KEY not configured' }));
      return;
    }
    const cacheKey = `${tmdbId}:${season}`;
    const upstream =
      `https://api.themoviedb.org/3/tv/${encodeURIComponent(tmdbId)}` +
      `/season/${encodeURIComponent(season)}` +
      `?api_key=${encodeURIComponent(apiKey)}`;
    jsonCacheGet('tmdb-season', cacheKey).then((cached) => {
      if (cached !== undefined) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cached));
        return;
      }
      https
        .get(upstream, (upRes) => {
          let buf = '';
          upRes.setEncoding('utf8');
          upRes.on('data', (c) => { buf += c; });
          upRes.on('end', () => {
            try {
              const data = JSON.parse(buf);
              const overview = typeof data?.overview === 'string' && data.overview.trim()
                ? data.overview.trim()
                : null;
              const episodes = Array.isArray(data?.episodes)
                ? data.episodes.map((e) => ({
                    episode_number: typeof e?.episode_number === 'number' ? e.episode_number : null,
                    runtime: typeof e?.runtime === 'number' && e.runtime > 0 ? e.runtime : null,
                    overview: typeof e?.overview === 'string' && e.overview.trim() ? e.overview.trim() : null,
                    // Per-episode TMDB rating (vote_average is 0–10).
                    // EpisodePanel / Rating component show this when
                    // Cinemeta's per-episode rating field is "0" / missing.
                    vote_average:
                      typeof e?.vote_average === 'number' && e.vote_average > 0
                        ? e.vote_average
                        : null,
                    // Per-episode still (landscape). Used as the episode-card
                    // thumbnail fallback when metahub (episodes.metahub.space)
                    // 404s for a season it hasn't generated artwork for —
                    // common for newer seasons (Cinemeta still hands out a
                    // pattern-built thumbnail URL that doesn't actually exist).
                    still:
                      typeof e?.still_path === 'string' && e.still_path
                        ? 'https://image.tmdb.org/t/p/w780' + e.still_path
                        : null,
                  }))
                : [];
              const payload = { overview, episodes };
              // Cache only seasons that returned episodes (an empty result is
              // an unaired season or a transient TMDB error — don't pin it). A
              // season still airing — an episode aired within ~2 weeks, or with
              // a missing/future air date — gets a short TTL so new episodes
              // surface; a finished season is effectively immutable (30d).
              if (episodes.length) {
                const now = Date.now();
                let hot = false;
                for (const e of data.episodes) {
                  const ad = e && e.air_date ? Date.parse(e.air_date) : NaN;
                  if (!Number.isFinite(ad) || ad > now - 14 * 24 * 60 * 60 * 1000) { hot = true; break; }
                }
                jsonCacheSet('tmdb-season', cacheKey, payload,
                  hot ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000);
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(payload));
            } catch (e) {
              res.writeHead(502, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'tmdb parse: ' + e.message }));
            }
          });
        })
        .on('error', (err) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'tmdb fetch: ' + err.message }));
        });
    });
    return;
  }

  // Unified Skip Intro/Recap/Credits timestamps for the web player.
  //  - Anime: AniSkip (deep crowd-sourced OP/ED coverage), with the MAL id
  //    resolved season-accurately via the AniList cour chain.
  //  - Series / movies (and as an anime fallback): TheIntroDB, keyed by
  //    tmdb id. Best-effort and silent — a miss returns { found:false } so
  //    the player simply shows no skip button (same as a chapterless file).
  // Returns { found, source, intervals:[{type:'intro'|'recap'|'outro',start,end}] }.
  if (req.url === '/skip-times' || req.url.startsWith('/skip-times?')) {
    const parsed = url.parse(req.url, true);
    const imdbId = String(parsed.query.imdbId || '').trim();
    const tmdbId = String(parsed.query.tmdbId || '').trim();
    const season = Math.max(1, parseInt(String(parsed.query.season || '1'), 10) || 1);
    const episode = parseInt(String(parsed.query.episode || ''), 10);
    const episodeLength = Number(parsed.query.episodeLength) || 0;
    const hasId = /^tt\d+$/.test(imdbId) || /^\d+$/.test(tmdbId);
    if (!hasId || !Number.isFinite(episode) || episode < 1) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ found: false, error: 'invalid params' }));
      return;
    }
    void (async () => {
      const ok = (payload) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };
      try {
        let intervals = [];
        let source = null;
        // 1) Anime → AniSkip. nattadasu maps imdb -> AniList (only anime
        //    resolve); we then walk the cour chain for the season's MAL id.
        if (/^tt\d+$/.test(imdbId)) {
          let mapped = await jsonCacheGet('imdb-anilist', imdbId);
          if (mapped === undefined) {
            const map = await requestJson(`https://animeapi.my.id/imdb/${encodeURIComponent(imdbId)}`).catch(() => null);
            mapped = map && map.json ? map.json : null;
            // imdb -> anilist mapping is immutable; cache a hit permanently, a
            // null (non-anime / not yet mapped) for a day in case it's added.
            jsonCacheSet('imdb-anilist', imdbId, mapped, mapped ? 0 : 24 * 60 * 60 * 1000);
          }
          const anilistId = mapped && typeof mapped.anilist === 'number' ? mapped.anilist : null;
          if (anilistId) {
            const chain = await buildAniTvChain(anilistId);
            const target = chain.length ? chain[Math.min(season, chain.length) - 1] : null;
            const mal = (target && target.idMal) || (typeof mapped.myanimelist === 'number' ? mapped.myanimelist : null);
            if (mal) {
              intervals = await aniskipIntervals(mal, episode, episodeLength);
              if (intervals.length) source = 'aniskip';
            }
          }
        }
        // 2) Series / movies (or anime with no AniSkip data) → TheIntroDB.
        if (!intervals.length) {
          const tidb = await tidbIntervals({ tmdbId, imdbId, season, episode, episodeLength });
          if (tidb.length) { intervals = tidb; source = 'tidb'; }
        }
        ok({ found: intervals.length > 0, source, intervals });
      } catch (e) {
        ok({ found: false, error: String((e && e.message) || e) });
      }
    })();
    return;
  }

  // Master-playlist wrapper for iOS Safari (AVPlayer). The Videasy CDN
  // returns plain media playlists with no #EXT-X-STREAM-INF codec
  // hints, which iOS refuses to play even though desktop hls.js
  // handles them fine. This endpoint emits a tiny master playlist
  // with proper codec / resolution metadata pointing back at the
  // media playlist via /addon-proxy (origin spoof still in place).
  if (req.url.startsWith('/hls-master?')) {
    const parsed = url.parse(req.url, true);
    const mediaUrl = parsed.query.url;
    if (!mediaUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url parameter');
      return;
    }
    // Videasy ships a flat media playlist with no codec declarations and
    // no master. Earlier we wrapped it with a master that hard-coded
    // codec hints per quality bucket — but those hints lied for any
    // stream whose true codec didn't match (e.g. HEVC 4K), and MSE
    // dropped the video track silently → audio-only playback. Bypass
    // the wrapper entirely and just proxy the media playlist through
    // /addon-proxy (which already rewrites segment URLs and handles
    // CORS / Origin spoofing). HLS.js then probes the real codec from
    // the first segment instead of trusting our guess.
    proxyRequest(req, res, String(mediaUrl));
    return;
  }

  if (req.url === '/videasy-sources' || req.url.startsWith('/videasy-sources?')) {
    const parsed = url.parse(req.url, true);
    const {
      title,
      mediaType,
      tmdbId,
      year = '',
      episodeId = '1',
      seasonId = '1',
      imdbId = '',
      // 'cdn' returns HLS .m3u8 URLs with 1080p/720p/480p/4K variants
      // (chunked, instant first-frame). 'e3b0c442' returns raw .mp4
      // files from shegu.net that are throttled to ~1 Mbit/s for our
      // IP and won't play back in real time. 'mb-flix' is similar to
      // 'cdn' (HLS at speedsterwave.app) — kept as a fallback option.
      provider = 'cdn',
    } = parsed.query;
    if (!title || !mediaType || !tmdbId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing title, mediaType, or tmdbId' }));
      return;
    }
    // Cache hit? Serve the already-resolved payload — no upstream call, no token
    // quota burned. The player's server-picker + reloads all land here.
    const vsCacheKey = `${provider}:${tmdbId}:${seasonId}:${episodeId}`;
    const vsCached = videasySourcesCache.get(vsCacheKey);
    if (vsCached && Date.now() - vsCached.at < (vsCached.ttl || VIDEASY_SOURCES_TTL)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(vsCached.payload));
      return;
    }
    // Primary: fetch the encrypted payload straight from api.videasy.to and
    // decrypt it in-process (fast, ~1s, no browser). The on-Mac browser-resolver
    // is now a break-glass fallback (see browserResolverFallback) invoked only if
    // every provider fails to fetch+decrypt — e.g. Videasy rotates the cipher and
    // our WASM decryptor can't open it; the browser stays immune because it
    // harvests already-decrypted output from Videasy's own player.
    const runDirectVideasy = () => {
    const qs = new URLSearchParams({
      title: String(title),
      mediaType: String(mediaType),
      year: String(year),
      episodeId: String(episodeId),
      seasonId: String(seasonId),
      tmdbId: String(tmdbId),
      imdbId: String(imdbId),
    }).toString();
    // Videasy's own player auto-routes between providers when one
    // bucket goes down. We replicate that: start with the caller's
    // requested provider, then fall through to alternates known to
    // share the same payload format (HLS via decryptVideasyResponse).
    // `cdn` and `downloader2` return the 200 ciphertext; `mb-flix` /
    // `1movies` currently 404 on api.videasy.to, so they self-skip.
    const FALLBACK_CHAIN = ['cdn', 'mb-flix', 'downloader2', '1movies'];
    const requested = String(provider);
    const tryOrder = [requested, ...FALLBACK_CHAIN.filter((p) => p !== requested)];
    const fetchStart = Date.now();
    // Fetch JUST the subtitles from an alternate provider — used when the
    // provider that resolved the video has sources but NO subtitles (e.g.
    // 'cdn'/HLS). Subs are content-synced for the same episode, so borrowing
    // them keeps the player captioned. Resolves to [] on any failure.
    const fetchProviderSubs = (prov) => new Promise((resolve) => {
      const u = `${VIDEASY_API_BASE}/${encodeURIComponent(prov)}/sources-with-title?${qs}`;
      https
        .get(
          u,
          {
            headers: videasyAuthHeaders(),
          },
          (r) => {
            if ((r.statusCode || 0) >= 400) { r.resume(); resolve([]); return; }
            let b = '';
            r.setEncoding('utf8');
            r.on('data', (c) => { b += c; });
            r.on('end', () => {
              if (!b.trim()) { resolve([]); return; }
              decryptVideasyResponse(b.trim(), String(tmdbId))
                .then((pl) => resolve(Array.isArray(pl?.subtitles) ? pl.subtitles : []))
                .catch(() => resolve([]));
            });
            r.on('error', () => resolve([]));
          }
        )
        .on('error', () => resolve([]));
    });
    let providerIdx = 0;
    const tryProvider = () => {
      if (providerIdx >= tryOrder.length) {
        if (res.writableEnded || res.headersSent) return;
        console.log('Videasy direct fetch+decrypt exhausted all providers — trying browser resolver');
        browserResolverFallback();
        return;
      }
      const p = tryOrder[providerIdx++];
      const upstream = `${VIDEASY_API_BASE}/${encodeURIComponent(p)}/sources-with-title?${qs}`;
      console.log(`Videasy sources [try ${p}]: ${upstream.slice(0, 140)}`);
      https
        .get(
          upstream,
          {
            headers: videasyAuthHeaders(),
          },
          (upRes) => {
            if ((upRes.statusCode || 0) >= 400) {
              console.log(`Videasy provider ${p} → ${upRes.statusCode}, trying next`);
              upRes.resume();
              tryProvider();
              return;
            }
            let buf = '';
            upRes.setEncoding('utf8');
            upRes.on('data', (c) => {
              buf += c;
            });
            upRes.on('end', () => {
              const ct = buf.trim();
              if (!ct) {
                console.log(`Videasy provider ${p} → empty, trying next`);
                tryProvider();
                return;
              }
            decryptVideasyResponse(ct, String(tmdbId))
              .then(async (payload) => {
                console.log(
                  `Videasy sources OK ${Date.now() - fetchStart}ms — ` +
                    `${(payload?.sources || []).length} sources, ` +
                    `${(payload?.subtitles || []).length} subs`
                );
                // Borrow subtitles when the video provider returned none.
                const haveSubs = Array.isArray(payload?.subtitles) && payload.subtitles.length > 0;
                const haveSources = Array.isArray(payload?.sources) && payload.sources.length > 0;
                if (!haveSubs && haveSources) {
                  for (const sp of ['downloader2']) {
                    if (sp === p) continue;
                    const borrowed = await fetchProviderSubs(sp);
                    if (borrowed.length) {
                      payload.subtitles = borrowed;
                      console.log(`Videasy subs borrowed from ${sp}: ${borrowed.length}`);
                      break;
                    }
                  }
                }
                // Each Videasy CDN source becomes a /hls-master URL
                // that returns a tiny master playlist (with codec
                // hints) wrapping the actual media playlist under
                // /addon-proxy. iOS Safari's AVPlayer requires the
                // master to determine codecs; desktop hls.js
                // follows the master to the media playlist as
                // usual — no regression there.
                // Route EVERY Videasy source through /addon-proxy with the
                // vd=1 flag — it forces the cineby.sc Origin/Referer spoof
                // (and, for HLS, the per-segment rewrite) REGARDLESS of host.
                // Videasy rotates its CDN hostnames constantly (cineby ->
                // nightspeedster -> awesomehappiness -> itsdeskmate -> …); a
                // host allowlist was perpetual whack-a-mole. HLS playlists are
                // detected by content-type inside /addon-proxy and rewritten;
                // direct files (mp4) are piped through with Range support.
                const proxifySource = (u) => {
                  try { new URL(u); return '/addon-proxy?url=' + encodeURIComponent(u) + '&vd=1'; }
                  catch { return u; }
                };
                const proxifySubtitle = (u) => {
                  try { new URL(u); return '/addon-proxy?url=' + encodeURIComponent(u) + '&vd=1'; }
                  catch { return u; }
                };
                if (Array.isArray(payload?.sources)) {
                  for (const s of payload.sources) {
                    if (s && typeof s.url === 'string') {
                      s.url = proxifySource(s.url, s.quality);
                    }
                  }
                }
                // Same treatment for subtitle URLs, plus normalize the
                // language name ("English", "Arabic") to an ISO code
                // ("eng", "ara") so the player's existing language
                // matching logic works.
                if (Array.isArray(payload?.subtitles)) {
                  for (const t of payload.subtitles) {
                    if (!t) continue;
                    if (typeof t.url === 'string') t.url = proxifySubtitle(t.url);
                    t.lang = videasyLangToCode(t.lang || t.language);
                  }
                }
                // Cache the resolved payload (only when it actually has
                // sources — a failure shouldn't stick and block recovery).
                if (Array.isArray(payload?.sources) && payload.sources.length > 0) {
                  videasySourcesCache.set(vsCacheKey, { at: Date.now(), payload });
                }
                if (res.writableEnded || res.headersSent) return;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(payload));
              })
              .catch((err) => {
                console.log(`Videasy decrypt failed on ${p}: ${err.message}, trying next provider`);
                tryProvider();
              });
          });
            upRes.on('error', (err) => {
              console.log(`Videasy provider ${p} → upRes error ${err.message}, trying next`);
              tryProvider();
            });
          }
        )
        .on('error', (err) => {
          console.log(`Videasy provider ${p} → req error ${err.message}, trying next`);
          tryProvider();
        });
    };
      tryProvider();
    };
    // Break-glass fallback: the on-Mac browser-resolver. Only reached when the
    // in-process fetch+decrypt fails for every provider. Chrome stays cold until
    // this fires (its warm-loop is retired), so a rare fallback pays a ~60s
    // first-resolve cost; steady state never launches a browser. If it too
    // yields nothing, surface the 502 the direct path would have returned.
    const browserResolverFallback = () => {
      fetchFromResolver(String(mediaType), String(tmdbId), String(seasonId), String(episodeId), (resolved) => {
        if (resolved && !res.writableEnded && !res.headersSent) {
          console.log(`Videasy resolver fallback → ${resolved.sources.length} sources for tmdb ${tmdbId}`);
          return respondVideasyPayload(resolved, vsCacheKey, res);
        }
        if (res.writableEnded || res.headersSent) return;
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'all videasy providers failed' }));
      });
    };
    runDirectVideasy();
    return;
  }

  if (req.url === '/resolve-url' || req.url.startsWith('/resolve-url?')) {
    const parsed = url.parse(req.url, true);
    const targetUrl = parsed.query.url;
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url parameter' }));
      return;
    }
    headProbe(targetUrl, 0, (probeRes) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(probeRes));
    });
    return;
  }

  // House Real-Debrid fallback. When Videasy/Vidking has no playable
  // source, the web player calls this to get an RD-resolved stream using
  // a SERVER-SIDE key (process.env.RD_FALLBACK_KEY) — so a shared key is
  // never embedded in the client bundle (Torrentio puts the key right in
  // each stream URL). We fetch the Torrentio-RD list (key lives only in
  // this request), drop 4K/HEVC/AV1 (chrome MSE can't decode them), then
  // follow each /resolve/realdebrid/<key>/… redirect to its key-free RD
  // direct URL and return those. Returns Stremio-shape { streams }.
  if (req.url === '/rd-fallback' || req.url.startsWith('/rd-fallback?')) {
    const parsed = url.parse(req.url, true);
    const rdType = String(parsed.query.type || '');
    const rdId = String(parsed.query.id || '');
    const rdKey = process.env.RD_FALLBACK_KEY || '';
    if (!rdKey || (rdType !== 'movie' && rdType !== 'series') || !rdId) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ streams: [] }));
      return;
    }
    void (async () => {
      const finish = (streams) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ streams }));
      };
      try {
        const listUrl =
          `https://torrentio.strem.fun/realdebrid=${encodeURIComponent(rdKey)}` +
          `/stream/${rdType}/${encodeURIComponent(rdId)}.json`;
        const list = await requestJson(listUrl, { timeoutMs: 15000 }).catch(() => null);
        const raw = list && list.json && Array.isArray(list.json.streams) ? list.json.streams : [];
        const score = (t) => {
          let base = /1080p/i.test(t) ? 100 : /720p/i.test(t) ? 85 : /480p/i.test(t) ? 50 : 60;
          // .avi (XviD / ancient fansub): lowest quality + flakiest to transcode.
          // Sink below mkv/mp4 but keep as a last resort for old anime.
          if (/\.avi(\b|$)/i.test(t)) base -= 45;
          return base;
        };
        const candidates = raw
          .filter((s) => s && typeof s.url === 'string' && /^https?:\/\//i.test(s.url))
          .filter((s) => !(s.behaviorHints && s.behaviorHints.notWebReady === true))
          // Skip not-yet-cached torrents ("[RD download]") — resolving one
          // makes RD start a download and the HEAD probe hangs to its timeout.
          .filter((s) => !/\bRD\s*download\b/i.test(s.name || ''))
          .filter((s) => !/(2160p|\b4k\b|x265|h\.?265|hevc|av1)/i.test(`${s.name || ''} ${s.title || ''}`))
          .map((s) => ({ s, sc: score(`${s.name || ''} ${s.title || ''}`) }))
          .sort((a, b) => b.sc - a.sc)
          .slice(0, 6);
        // Probe candidates IN PARALLEL — sequential probing of 6 streams,
        // each with a 10s HEAD timeout, could stack to ~60s. Then keep the
        // first 4 that resolve, preserving score order.
        const probed = await Promise.all(
          candidates.map(
            (c) => new Promise((resolve) => headProbe(c.s.url, 0, (p) => resolve({ c, p })))
          )
        );
        const out = [];
        for (const { c, p } of probed) {
          if (!p || typeof p.status !== 'number' || p.status >= 400) continue;
          if (!p.finalUrl || !/^https?:\/\//i.test(p.finalUrl)) continue;
          if (/failed_infringement/i.test(p.finalUrl)) continue; // DMCA placeholder
          out.push({ name: c.s.name || 'Real-Debrid', title: c.s.title || '', url: p.finalUrl });
          if (out.length >= 4) break;
        }
        finish(out);
      } catch (e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ streams: [], error: String((e && e.message) || e) }));
      }
    })();
    return;
  }

  // ── /rd-by-hash ────────────────────────────────────────────────────
  // Resolve one torrent (infoHash + optional fileIdx) to a key-free RD
  // direct link via the house RD token. 200 {url,cached:true} on a cache
  // hit; 404 {cached:false} when RD doesn't already have it (the guest
  // then falls back to its own pick). Used by Watch Party v2 same-file
  // sync — see resolveRdByHash above.
  if (req.url === '/rd-by-hash' || req.url.startsWith('/rd-by-hash?')) {
    const parsed = url.parse(req.url, true);
    const infoHash = String(parsed.query.infoHash || '').toLowerCase();
    const fileIdxRaw = parsed.query.fileIdx;
    const fileIdx = fileIdxRaw == null || fileIdxRaw === '' ? null : Number.parseInt(String(fileIdxRaw), 10);
    if (!/^[a-f0-9]{40}$/.test(infoHash) || (fileIdx != null && (!Number.isInteger(fileIdx) || fileIdx < 0))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad infoHash/fileIdx' }));
      return;
    }
    if (!process.env.RD_FALLBACK_KEY) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cached: false, error: 'no rd key' }));
      return;
    }
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const limited = rdbhReject(clientIp);
    if (limited) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '5' });
      res.end(JSON.stringify({ error: limited }));
      return;
    }
    rdbhInflight++;
    void (async () => {
      try {
        const direct = await resolveRdByHash(infoHash, fileIdx);
        if (!direct) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ cached: false }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: direct, cached: true }));
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: String((e && e.message) || e) }));
      } finally {
        rdbhInflight--;
      }
    })();
    return;
  }

  // ── /transcode ─────────────────────────────────────────────────────
  // On-the-fly remux of a (Real-Debrid) .mkv into a browser-playable
  // fragmented MP4. The anime case is H.264 video + AC3/DTS/FLAC audio in
  // a matroska container: Chrome decodes the H.264 fine but not the audio
  // codec nor the .mkv wrapper. So we COPY H.264 video (cheap, near
  // realtime) and only transcode audio to stereo AAC, streaming straight
  // to the <video> element. HEVC sources (Chrome can't decode) are encoded
  // to H.264 (libx264 veryfast). Self-owned: no third-party CDN, no
  // rotating keys, nothing to get seized — unlike the pirate aggregators.
  //   /transcode?url=<direct .mkv url>[&start=<seconds>]
  // NOTE: progressive stream — start-to-finish playback works; native
  // seeking needs the &start= reload wiring on the client (follow-up).
  if (req.url === '/transcode' || req.url.startsWith('/transcode?')) {
    const tq = url.parse(req.url, true).query;
    const src = String(tq.url || '');
    const start = Math.max(0, parseInt(tq.start, 10) || 0);
    if (!/^https?:\/\//i.test(src)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad url');
      return;
    }
    let srcHost = '?';
    try { srcHost = new URL(src).host; } catch { /* keep ? */ }
    if (activeTranscodes >= TRANSCODE_MAX) {
      appendPlayerLog(`transcode rejected host=${srcHost} at-capacity=${activeTranscodes}/${TRANSCODE_MAX}`);
      res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '15' });
      res.end('transcode capacity reached');
      return;
    }
    activeTranscodes += 1;
    let released = false;
    const release = () => { if (!released) { released = true; activeTranscodes -= 1; } };
    let ff = null;
    const onClientGone = () => { try { if (ff) ff.kill('SIGKILL'); } catch { /* noop */ } release(); };
    req.on('close', onClientGone);
    res.on('close', onClientGone);
    void (async () => {
      // Probe the source video: only 8-bit H.264 can be copied. HEVC/AV1/VP9
      // OR 10-bit H.264 (Hi10P — Chrome's decoder is 8-bit only) must be
      // re-encoded to 8-bit H.264.
      const vinfo = await probeVideo(src);
      if (released) return; // client disconnected during probe
      const tenBit = /10le|10be|p010/i.test(vinfo.pixfmt);
      const copyVideo = (vinfo.codec === 'h264' || vinfo.codec === 'avc') && !tenBit;
      const vArgs = copyVideo
        ? ['-c:v', 'copy']
        : videoEncodeArgs();
      const args = [
        '-hide_banner', '-loglevel', 'error',
        '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
      ];
      if (start > 0) args.push('-ss', String(start));
      args.push(
        '-i', src,
        '-map', '0:v:0', '-map', '0:a:0',
        '-sn', '-dn',
        ...vArgs,
        '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4', 'pipe:1',
      );
      appendPlayerLog(`transcode host=${srcHost} v=${vinfo.codec || '?'}/${vinfo.pixfmt || '?'} mode=${copyVideo ? 'copy' : 'x264'} active=${activeTranscodes}/${TRANSCODE_MAX} start=${start}`);
      ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let errTail = '';
      ff.stderr.on('data', (c) => { errTail = (errTail + c.toString()).slice(-500); });
      if (!res.headersSent) {
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        });
      }
      ff.stdout.pipe(res);
      ff.on('error', (e) => {
        release();
        appendPlayerLog(`transcode spawn-error host=${srcHost} ${e.message}`);
        try { res.end(); } catch { /* noop */ }
      });
      ff.on('close', (code) => {
        release();
        if (code && code !== 0 && code !== 255) {
          appendPlayerLog(`transcode exit=${code} host=${srcHost} err=${errTail.replace(/\s+/g, ' ').slice(-180)}`);
        }
        try { res.end(); } catch { /* noop */ }
      });
    })();
    return;
  }

  // ── /transcode.m3u8 ────────────────────────────────────────────────
  // VOD HLS playlist for a (RD .mkv) source. Unlike the progressive
  // /transcode (no duration, no seeking), this gives the player the real
  // duration + native seeking: we ffprobe the duration, emit a VOD playlist
  // of fixed-length segments, and generate each segment on demand via
  // /transcode-seg. The browser's HLS.js path (already used for Videasy)
  // handles it — correct progress bar, scrubbing, the works.
  if (req.url.startsWith('/transcode.m3u8')) {
    const tq = url.parse(req.url, true).query;
    const src = String(tq.url || '');
    const aRaw = parseInt(tq.a, 10);
    const audioIdx = Number.isInteger(aRaw) && aRaw >= 0 ? aRaw : 0; // which audio track to mux
    if (!/^https?:\/\//i.test(src)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad url');
      return;
    }
    void (async () => {
    // Resolve the torrentio /resolve/ URL to its direct RD URL first (cached in
    // transcodeSrcCache, ~0.4s).
    const probeSrc = await resolveTranscodeSrc(src);
    // A torrentio /resolve/realdebrid/ that DIDN'T hand back a real-debrid.com
    // direct URL means the torrent isn't cached on RD yet — torrentio serves the
    // ElfHosted "not ready" slate. Surface a clear 409 instead of transcoding
    // that 2-minute slate; the player tells the user to pick another release.
    if (/\/resolve\/realdebrid\//i.test(src) && !/real-?debrid\.com/i.test(probeSrc)) {
      appendPlayerLog(`transcode.m3u8 not-cached host=${(() => { try { return new URL(probeSrc).host; } catch { return '?'; } })()}`);
      res.writeHead(409, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('MEDIA_NOT_CACHED_YET');
      return;
    }
    // Duration is immutable per file → cache permanently (keyed on the stable
    // torrentio url) so the playlist is instant on every later load.
    let dur = await jsonCacheGet('transcode-dur', src);
    if (dur === undefined) {
      // Probe the RESOLVED direct URL (torrentio re-resolve is ~10-25s; direct
      // is ~0.4s) so the manifest returns before HLS.js's load timeout.
      dur = await new Promise((resolve) => {
        const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', probeSrc]);
        let out = '';
        p.stdout.on('data', (c) => { out += c.toString(); });
        p.on('close', () => resolve(parseFloat(out.trim()) || 0));
        p.on('error', () => resolve(0));
        setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* noop */ } resolve(parseFloat(out.trim()) || 0); }, 25000);
      });
      if (dur && Number.isFinite(dur)) jsonCacheSet('transcode-dur', src, dur, 0);
    }
    if (!dur || !Number.isFinite(dur)) {
      appendPlayerLog(`transcode.m3u8 no-duration host=${(() => { try { return new URL(src).host; } catch { return '?'; } })()}`);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('could not probe duration');
      return;
    }
    const SEG = 6;
    const n = Math.ceil(dur / SEG);
    const enc = encodeURIComponent(src);
    let pl = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:' + SEG + '\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n';
    const aParam = audioIdx ? '&a=' + audioIdx : '';
    for (let i = 0; i < n; i++) {
      const d = Math.min(SEG, dur - i * SEG);
      pl += '#EXTINF:' + d.toFixed(3) + ',\n/transcode-seg?url=' + enc + '&n=' + i + aParam + '\n';
    }
    pl += '#EXT-X-ENDLIST\n';
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    res.end(pl);
    })();
    return;
  }

  // ── /transcode-seg ─────────────────────────────────────────────────
  // Generate one HLS segment on demand: seek to n*SEG and re-encode SEG
  // seconds to MPEG-TS (H.264 8-bit + AAC). Re-encode (not copy) keeps each
  // segment independent + keyframe-started, so seeking works cleanly.
  if (req.url.startsWith('/transcode-seg')) {
    const sq = url.parse(req.url, true).query;
    const src = String(sq.url || '');
    const n = parseInt(sq.n, 10);
    const aRawSeg = parseInt(sq.a, 10);
    const audioIdx = Number.isInteger(aRawSeg) && aRawSeg >= 0 ? aRawSeg : 0;
    if (!/^https?:\/\//i.test(src) || !Number.isInteger(n) || n < 0) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad request');
      return;
    }
    const SEG = 6;
    const start = n * SEG;
    // Feed ffmpeg the RESOLVED direct URL (cached) — using the torrentio
    // /resolve/ URL re-mints a fresh RD link on every segment, which is slow
    // and gets RD-throttled (the cause of the web player's endless buffering).
    void (async () => {
    const segSrc = await resolveTranscodeSrc(src);
    // Host-side hardware transcoder: if configured, offload the (CPU-heavy)
    // segment encode to the native macOS ffmpeg service, which uses Apple
    // Silicon's h264_videotoolbox media engine (~6× less CPU, no thermal
    // throttling). We only resolve the URL here; the host does the encode.
    if (TRANSCODE_HOST_URL && TRANSCODE_HOST_SECRET) {
      const hostUrl = `${TRANSCODE_HOST_URL.replace(/\/+$/, '')}/seg?url=${encodeURIComponent(segSrc)}`
        + `&n=${n}&a=${audioIdx}&secret=${encodeURIComponent(TRANSCODE_HOST_SECRET)}`;
      const lib = hostUrl.startsWith('https:') ? https : http;
      const hr = lib.get(hostUrl, (hres) => {
        if (hres.statusCode !== 200) {
          appendPlayerLog(`transcode-seg host status=${hres.statusCode} n=${n}`);
          hres.resume();
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('host transcoder error');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
        hres.pipe(res);
      });
      const killHost = () => { try { hr.destroy(); } catch { /* noop */ } };
      hr.on('error', (e) => {
        appendPlayerLog(`transcode-seg host err=${e.message} n=${n}`);
        if (!res.headersSent) { res.writeHead(502); }
        try { res.end(); } catch { /* noop */ }
      });
      req.on('close', killHost);
      res.on('close', killHost);
      return;
    }
    const args = [
      '-hide_banner', '-loglevel', 'error',
      // Reconnect + back off on transient RD throttling (429/5xx) instead of
      // failing the segment instantly. iOS native HLS retries a failed segment
      // in a tight loop, so one 429 turned into a storm that killed playback
      // (audio drops, video stalls). Letting ffmpeg ride out the 429 server-side
      // delivers the segment instead of bouncing the error back to the player.
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '8',
      '-reconnect_on_http_error', '429,500,502,503,504',
      '-ss', String(start), '-i', segSrc, '-t', String(SEG),
      // Pick the requested audio track (default first); `?` keeps a bad index
      // from failing the whole segment.
      '-map', '0:v:0', '-map', '0:a:' + audioIdx + '?', '-sn', '-dn',
      ...videoEncodeArgs(),
      '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
      // Place each independently-encoded segment at its TRUE position in the
      // timeline. Input -ss resets the segment's PTS to ~0; -output_ts_offset
      // shifts it to `start`, so segment N reports start_time = n*SEG and the
      // segments are contiguous. Without this every segment started at ~0, so
      // HLS.js could append only the first to the SourceBuffer (the rest
      // overlapped it) → the stream played ~one segment then buffered forever.
      // (Replaces -avoid_negative_ts make_zero, which forced the ~0 reset.)
      '-output_ts_offset', String(start),
      '-muxdelay', '0', '-muxpreload', '0',
      '-f', 'mpegts', 'pipe:1',
    ];
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let errTail = '';
    ff.stderr.on('data', (c) => { errTail = (errTail + c.toString()).slice(-300); });
    res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    ff.stdout.pipe(res);
    const kill = () => { try { ff.kill('SIGKILL'); } catch { /* noop */ } };
    req.on('close', kill);
    res.on('close', kill);
    ff.on('error', () => { try { res.end(); } catch { /* noop */ } });
    ff.on('close', (code) => {
      if (code && code !== 0 && code !== 255) {
        appendPlayerLog(`transcode-seg exit=${code} n=${n} ${errTail.replace(/\s+/g, ' ').slice(-120)}`);
      }
      try { res.end(); } catch { /* noop */ }
    });
    })();
    return;
  }

  // ── /transcode-audio ───────────────────────────────────────────────
  // List the source's audio tracks so the player can offer an audio picker
  // (the transcode muxes ONE track at a time via /transcode-seg &a=N). Cached
  // permanently per file (immutable). `i` is the audio-relative index that
  // maps to ffmpeg's `-map 0:a:i`.
  if (req.url.startsWith('/transcode-audio')) {
    const src = String(url.parse(req.url, true).query.url || '');
    if (!/^https?:\/\//i.test(src)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ tracks: [] }));
      return;
    }
    void (async () => {
      const cached = await jsonCacheGet('transcode-audio', src);
      if (cached !== undefined) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(cached));
        return;
      }
      const probeSrc = await resolveTranscodeSrc(src);
      const tracks = await new Promise((resolve) => {
        const p = spawn('ffprobe', [
          '-v', 'error', '-select_streams', 'a',
          '-show_entries', 'stream=channels,codec_name:stream_tags=language,title',
          '-of', 'json', probeSrc,
        ]);
        let out = '';
        p.stdout.on('data', (c) => { out += c.toString(); });
        p.on('close', () => {
          try {
            const streams = (JSON.parse(out).streams) || [];
            resolve(streams.map((s, i) => ({
              i,
              lang: (s.tags && (s.tags.language || s.tags.lang)) || null,
              title: (s.tags && s.tags.title) || null,
              codec: s.codec_name || null,
              channels: s.channels || null,
            })));
          } catch { resolve([]); }
        });
        p.on('error', () => resolve([]));
        setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* noop */ } resolve([]); }, 25000);
      });
      const payload = { tracks };
      // Permanent for a real result (immutable per file); short for empty (a cold
      // RD link can make the probe race and return nothing).
      await jsonCacheSet('transcode-audio', src, payload, tracks.length ? 0 : 10 * 60 * 1000);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(payload));
    })();
    return;
  }

  if (req.url === '/stremio' || req.url.startsWith('/stremio/')) {
    const stremioPath = req.url.replace(/^\/stremio/, '');
    const targetUrl = `${STREMIO_AUTH_BASE}${stremioPath}`;
    console.log(`Stremio proxy: ${targetUrl}`);
    proxyRequest(req, res, targetUrl, {
      Host: new URL(STREMIO_AUTH_BASE).host,
    });
    return;
  }

  if (!req.url.startsWith('/addon-proxy')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  // Parse URL and get target
  const parsed = url.parse(req.url, true);
  const targetUrl = parsed.query.url;

  if (!targetUrl) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Missing url parameter');
    return;
  }

  console.log(`Proxying: ${targetUrl}`);
  proxyRequest(req, res, targetUrl);
});

// Watch Party v2 Layer B — accept host relay tunnels on this same server.
setupPartyRelayTunnel(server);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Blissful proxy listening on port ${PORT}`);
});
