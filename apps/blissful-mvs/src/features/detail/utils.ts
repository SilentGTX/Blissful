export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  const platform = (navigator as any).platform as string | undefined;
  const maxTouchPoints = (navigator as any).maxTouchPoints as number | undefined;
  return platform === 'MacIntel' && typeof maxTouchPoints === 'number' && maxTouchPoints > 1;
}

export function openInVlc(url: string): void {
  const encoded = encodeURIComponent(url);
  try {
    window.location.href = `vlc-x-callback://x-callback-url/stream?url=${encoded}`;
    return;
  } catch {
    // ignore
  }
  try {
    window.location.href = `vlc://${url}`;
  } catch {
    // ignore
  }
}

export function formatChannelName(id: string): string {
  if (!id) return '';
  const withoutPrefix = id.replace(/^[^:]+:/, '');
  const withSpaces = withoutPrefix.replace(/[-_]/g, ' ');
  return withSpaces
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export function getDisplayName(meta: any, id: string, type: string): string {
  if (meta?.name) return meta.name;
  if (type === 'tv' || type === 'channel') return formatChannelName(id);
  return id;
}

export function formatDate(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function parseStreamDescription(desc?: string | null): {
  torrentName: string | null;
  seeders: string | null;
  size: string | null;
  site: string | null;
  rawMeta: string | null;
} {
  if (!desc) {
    return { torrentName: null, seeders: null, size: null, site: null, rawMeta: null };
  }

  let lines = desc
    .split(/\r\n|\n|\u2028|\u2029/g)
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length === 1) {
    const one = lines[0];
    const emojiIdxs: number[] = [];
    for (const m of one.matchAll(/(?:👤\uFE0F?|👥\uFE0F?|💾\uFE0F?|⚙\uFE0F?)/gu)) {
      if (typeof m.index === 'number') emojiIdxs.push(m.index);
    }
    const tokenIdx = one.search(/\b(seed(?:er|ers)?|size|site)\b\s*[:=]?\s*/i);
    const metaStart = [...emojiIdxs, tokenIdx].filter((i) => i > 0).sort((a, b) => a - b)[0];
    if (typeof metaStart === 'number' && metaStart > 0) {
      const namePart = one.slice(0, metaStart).trim();
      const metaPart = one.slice(metaStart).trim();
      if (namePart && metaPart) lines = [namePart, metaPart];
    }
  }

  const torrentName = lines[0] ?? null;
  const rawMeta = lines.length >= 2 ? lines.slice(1).join(' ').trim() : null;
  const hay = rawMeta ?? desc;

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

  const site = (() => {
    const m1 = hay.match(/(?:⚙\uFE0F?)\s*([^\n]+)$/u);
    if (m1) return m1[1].trim();
    const m2 = hay.match(/\bsite\b\s*[:=]?\s*([^\n]+)/i);
    return m2 ? m2[1].trim() : null;
  })();

  return { torrentName, seeders, size, site, rawMeta };
}

export function buildStreamMetaLine(meta: {
  seeders: string | null;
  size: string | null;
  site: string | null;
  rawMeta: string | null;
}): string {
  if (meta.seeders || meta.size || meta.site) {
    return [
      meta.seeders ? `👤 ${meta.seeders}` : null,
      meta.size ? `💾 ${meta.size}` : null,
      meta.site ? `⚙️ ${meta.site}` : null,
    ]
      .filter(Boolean)
      .join(' ');
  }
  return meta.rawMeta ?? '';
}

export function parseNumber(value?: string | number) {
  if (value === undefined) return null;
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

export function getEpisodeTitle(video: { title?: string; name?: string; id: string }): string {
  const raw = (video.title ?? video.name ?? '').trim();
  return raw.length > 0 ? raw : video.id;
}
