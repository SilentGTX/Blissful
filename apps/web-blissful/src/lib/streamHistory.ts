import { isNativeShell } from './desktop';

type StreamHistoryKeyParams = {
  authKey?: string | null;
  type: string;
  id: string;
  videoId?: string | null;
};

type StreamHistoryEntry = {
  url: string;
  title?: string | null;
  logo?: string | null;
  updatedAt: number;
};

const PREFIX = 'bliss:lastStream:';

function keyFor(params: StreamHistoryKeyParams): string {
  const scope = params.authKey && params.authKey.length > 0 ? params.authKey : 'global';
  const vid = params.videoId ? params.videoId : '';
  return `${PREFIX}${scope}:${params.type}:${params.id}:${vid}`;
}

function legacyKeyFor(params: StreamHistoryKeyParams): string {
  const vid = params.videoId ? params.videoId : '';
  return `${PREFIX}${params.type}:${params.id}:${vid}`;
}

function isEphemeralStreamingUrl(value: string): boolean {
  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(value, base);
    const isLocalHost =
      parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1';
    if (isLocalHost && (parsed.port === '11470' || parsed.port === '12470')) return true;
    // Proxied videasy manifests/segments (`/addon-proxy?url=…&vd=1`) are
    // token-bound and expire within hours — a saved one is always a dead
    // link by the time it's replayed. Entries like this were written before
    // the save-side guard existed; purge them on read so old profiles heal.
    if (parsed.pathname.startsWith('/addon-proxy')) return true;
    return parsed.pathname.startsWith('/stremio-server/');
  } catch {
    return false;
  }
}

export function getLastStreamSelection(params: StreamHistoryKeyParams): StreamHistoryEntry | null {
  try {
    const scopedRaw = localStorage.getItem(keyFor(params));
    const raw =
      scopedRaw ??
      (params.authKey && params.authKey.length > 0 ? null : localStorage.getItem(legacyKeyFor(params)));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StreamHistoryEntry>;
    if (!parsed || typeof parsed.url !== 'string' || parsed.url.length === 0) return null;
    if (isEphemeralStreamingUrl(parsed.url)) {
      localStorage.removeItem(keyFor(params));
      localStorage.removeItem(legacyKeyFor(params));
      return null;
    }
    // Purge entries pointing at codecs the browser can't decode
    // (HEVC/x265 in the filename) — they would just show a black
    // frame on play. Forces the fallback to re-resolve next time.
    // The desktop shell plays through mpv, which decodes HEVC fine, so
    // skip the purge there (otherwise every 4K/HEVC release loses its
    // Continue-watching pin and resume point on desktop).
    if (!isNativeShell() && /(^|[^a-z])(x265|h\.?265|hevc)([^a-z]|$)/i.test(decodeURIComponent(parsed.url))) {
      localStorage.removeItem(keyFor(params));
      localStorage.removeItem(legacyKeyFor(params));
      return null;
    }
    return {
      url: parsed.url,
      title: typeof parsed.title === 'string' ? parsed.title : null,
      logo: typeof parsed.logo === 'string' ? parsed.logo : null,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

export function setLastStreamSelection(
  params: StreamHistoryKeyParams & { url: string; title?: string | null; logo?: string | null }
): void {
  try {
    const entry: StreamHistoryEntry = {
      url: params.url,
      title: params.title ?? null,
      logo: params.logo ?? null,
      updatedAt: Date.now(),
    };
    localStorage.setItem(keyFor(params), JSON.stringify(entry));
  } catch {
    // ignore
  }
}
