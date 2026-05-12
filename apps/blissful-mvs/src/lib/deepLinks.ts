import type { StremioStream } from './stremioAddon';

export type ExternalPlayerDeepLinks = {
  web: string | null;
  streaming: string | null;
  download: string | null;
  playlist: string | null;
  fileName: string | null;
  openPlayer: Record<string, string> | null;
};

export type StreamDeepLinks = {
  player: string | null;
  metaDetailsStreams: string | null;
  metaDetailsVideos: string | null;
  externalPlayer: ExternalPlayerDeepLinks;
};

export type VideoDeepLinks = {
  metaDetailsStreams: string | null;
  metaDetailsVideos: string | null;
  player: string | null;
  externalPlayer: ExternalPlayerDeepLinks | null;
};

function safeFilename(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function guessFilenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts.length > 0 ? parts[parts.length - 1] : null;
    if (!last) return null;
    const decoded = decodeURIComponent(last);
    return decoded.trim().length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

function parseStreamMeta(text: string): { seeders: string | null; size: string | null; provider: string | null } {
  const hay = text;
  const seeders = (() => {
    const m1 = hay.match(/(?:👤\uFE0F?|👥\uFE0F?)\s*(\d{1,7})/u);
    if (m1) return m1[1];
    const m2 = hay.match(/\bseed(?:er|ers)?\b\s*[:=]?\s*(\d{1,7})/i);
    return m2 ? m2[1] : null;
  })();

  const size = (() => {
    const norm = (raw: string): string => {
      const fixed = raw.trim().replace(',', '.');
      const m = fixed.match(/^(\d+(?:\.\d+)?)(?:\s*)?(TB|GB|MB|KB|TiB|GiB|MiB|KiB)$/i);
      if (!m) return fixed;
      return `${m[1]} ${m[2]}`;
    };
    const m1 = hay.match(/(?:💾\uFE0F?)\s*(\d+(?:[\.,]\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB))/iu);
    if (m1) return norm(m1[1]);
    const m2 = hay.match(/\bsize\b\s*[:=]?\s*(\d+(?:[\.,]\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB))/i);
    if (m2) return norm(m2[1]);
    const m3 = hay.match(/\b(\d+(?:[\.,]\d+)?\s*(?:TB|GB|MB|KB|TiB|GiB|MiB|KiB))\b/i);
    return m3 ? norm(m3[1]) : null;
  })();

  const provider = (() => {
    const m1 = hay.match(/(?:⚙\uFE0F?)\s*([^\n]+)$/u);
    if (m1) return m1[1].trim();
    const m2 = hay.match(/\bsite\b\s*[:=]?\s*([^\n]+)/i);
    return m2 ? m2[1].trim() : null;
  })();

  return { seeders, size, provider };
}

function buildStreamMetaLine(meta: { seeders: string | null; size: string | null; provider: string | null }): string {
  const parts = [
    meta.seeders ? `👤 ${meta.seeders}` : null,
    meta.size ? `💾 ${meta.size}` : null,
    meta.provider ? `⚙️ ${meta.provider}` : null,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  return parts.join(' ');
}

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizePlaybackUrl(url: string): string {
  if (!isHttpUrl(url)) return url;

  try {
    const parsed = new URL(url);
    const isLocalHost =
      parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1';

    if (isLocalHost && (parsed.port === '11470' || parsed.port === '12470')) {
      if (typeof window !== 'undefined') {
        return `${window.location.origin}/stremio-server${parsed.pathname}${parsed.search}`;
      }
      return `/stremio-server${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return url;
  }

  return url;
}

function buildMagnetUrl(stream: StremioStream, fallbackName: string): string | null {
  if (typeof stream.infoHash !== 'string' || stream.infoHash.length === 0) return null;

  const qs = new URLSearchParams();
  qs.set('xt', `urn:btih:${stream.infoHash}`);

  if (Number.isInteger(stream.fileIdx) && (stream.fileIdx as number) >= 0) {
    qs.set('fileIdx', String(stream.fileIdx));
  }

  const displayName = (stream.behaviorHints?.filename as string | undefined) ?? fallbackName;
  if (typeof displayName === 'string' && displayName.trim().length > 0) {
    qs.set('dn', displayName.trim());
  }

  if (Array.isArray(stream.sources)) {
    for (const source of stream.sources) {
      if (typeof source !== 'string') continue;
      const tracker = source.startsWith('tracker:') ? source.slice('tracker:'.length) : null;
      if (tracker) qs.append('tr', tracker);
    }
  }

  return `magnet:?${qs.toString()}`;
}

export function buildMetaDetailsLinks(params: {
  type: string;
  id: string;
  videoId?: string | null;
}): { metaDetailsVideos: string; metaDetailsStreams: string } {
  const base = `/detail/${encodeURIComponent(params.type)}/${encodeURIComponent(params.id)}`;
  const streams = params.videoId ? `${base}?videoId=${encodeURIComponent(params.videoId)}` : base;
  return {
    metaDetailsVideos: base,
    metaDetailsStreams: streams,
  };
}

export function buildStreamDeepLinks(params: {
  type: string;
  id: string;
  metaName?: string | null;
  metaPoster?: string | null;
  metaLogo?: string | null;
  videoId?: string | null;
  videoLabel?: string | null;
  stream: StremioStream;
  startTimeSeconds?: number | null;
}): StreamDeepLinks {
  const titleBase = params.metaName ?? 'Stream';
  const title = params.videoLabel ? `${titleBase} - ${params.videoLabel}` : titleBase;
  const streamTitle = params.stream.title ?? params.stream.name ?? 'Stream';
  const streamDesc = params.stream.description ?? '';

  const { metaDetailsStreams, metaDetailsVideos } = buildMetaDetailsLinks({
    type: params.type,
    id: params.id,
    videoId: params.videoId ?? null,
  });

  const url = (() => {
    if (typeof params.stream.url === 'string' && params.stream.url.length > 0) {
      return normalizePlaybackUrl(params.stream.url);
    }

    const magnetUrl = buildMagnetUrl(params.stream, streamTitle);
    if (magnetUrl) {
      return magnetUrl;
    }

    return null;
  })();

  const filename = (() => {
    if (url && isHttpUrl(url)) {
      return guessFilenameFromUrl(url) ?? streamTitle;
    }
    return streamTitle;
  })();
  const metaLine = buildStreamMetaLine(parseStreamMeta(`${streamTitle}\n${streamDesc}`));
  const titleForPlayer = [
    `${title} - ${streamTitle}`.trim(),
    filename.trim(),
    metaLine.trim(),
  ]
    .filter((v) => v.length > 0)
    .slice(0, 3)
    .join('\n');

  const player = url
    ? (() => {
        const qs = new URLSearchParams({
          url,
          title: titleForPlayer,
          type: params.type,
          id: params.id,
        });
        if (params.metaPoster) qs.set('poster', params.metaPoster);
        if (params.metaLogo) qs.set('logo', params.metaLogo);
        if (params.metaName) qs.set('metaTitle', params.metaName);
        if (params.videoId) qs.set('videoId', params.videoId);
        if (params.startTimeSeconds && Number.isFinite(params.startTimeSeconds) && params.startTimeSeconds > 0) {
          qs.set('t', String(params.startTimeSeconds));
        }
        return `/player?${qs.toString()}`;
      })()
    : null;

  const directWeb = typeof params.stream.url === 'string' && isHttpUrl(params.stream.url) ? params.stream.url : null;
  const web = directWeb;
  const playlist = directWeb && directWeb.toLowerCase().includes('.m3u8') ? directWeb : null;
  const fileName = safeFilename(`${titleBase}${params.videoLabel ? ` - ${params.videoLabel}` : ''}`) + '.mp4';

  return {
    player,
    metaDetailsStreams,
    metaDetailsVideos,
    externalPlayer: {
      web,
      streaming: url,
      download: url && isHttpUrl(url) ? url : null,
      playlist,
      fileName,
      openPlayer: null,
    },
  };
}

export function buildTrailerDeepLinks(ytId: string): StreamDeepLinks {
  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(ytId)}`;
  return {
    player: url,
    metaDetailsStreams: null,
    metaDetailsVideos: null,
    externalPlayer: {
      web: url,
      streaming: url,
      download: null,
      playlist: null,
      fileName: null,
      openPlayer: null,
    },
  };
}
