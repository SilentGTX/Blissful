import type { StremioStream } from '../../lib/stremioAddon';
import type { StreamDeepLinks } from '../../lib/deepLinks';
import { buildStreamMetaLine, isIos, parseStreamDescription } from './utils';

/** A stream enriched with deep links and progress data by useMetaDetails. */
export type EnrichedStream = StremioStream & { deepLinks: StreamDeepLinks; progress: number };

export type StreamsByAddon = Record<string, { addonName: string; streams: EnrichedStream[]; error?: string }>;

export type StreamRow = {
  transportUrl: string;
  addonName: string;
  stream: EnrichedStream;
  leftLabel: string;
  rightTitle: string;
  metaLine: string;
  metaSeeders: string | null;
  metaSize: string | null;
  metaProvider: string | null;
  seedersNum: number | null;
  sizeBytes: number | null;
  isLastPlayed: boolean;
  browserRank: number;
  effectiveUrl: string | null;
  playerLink: string | null;
  externalWeb: string | null;
  externalStreaming: string | null;
  lastPlayedMatchScore: number;
  likelyPlayableInBrowser: boolean;
  unplayableReason: string | null;
};

type StreamBuildResult = {
  rows: StreamRow[];
  totalCount: number;
  rdCount: number;
};

export type StreamBuildOptions = {
  selectedAddon: string;
  onlyTorrentioRdResolve: boolean;
  streamSortKey: string;
  lastStreamUrl: string | null;
};

const parseSizeBytes = (value: string | null): number | null => {
  if (!value) return null;
  const m = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(GB|MB|GiB|MiB)$/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toUpperCase();
  const base = unit.endsWith('IB') ? 1024 : 1000;
  if (unit.startsWith('G')) return Math.round(n * base * base * base);
  return Math.round(n * base * base);
};

const isHttpUrl = (value: string | null): boolean => {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

const normalizeLocalStremioUrl = (value: string | null): string | null => {
  if (!value || !isHttpUrl(value)) return value;

  try {
    const parsed = new URL(value);
    const isLocalHost =
      parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '::1';

    if (isLocalHost && (parsed.port === '11470' || parsed.port === '12470')) {
      if (typeof window !== 'undefined') {
        return `${window.location.origin}/stremio-server${parsed.pathname}${parsed.search}`;
      }
      return `/stremio-server${parsed.pathname}${parsed.search}`;
    }
  } catch {
    return value;
  }

  return value;
};

const extractUrlParamFromPlayerLink = (playerLink?: string | null): string | null => {
  if (!playerLink) return null;
  const idxQ = playerLink.indexOf('?');
  if (idxQ === -1) return null;
  try {
    return new URLSearchParams(playerLink.slice(idxQ + 1)).get('url');
  } catch {
    return null;
  }
};

const isTorrentioRdResolveUrl = (value: string | null): boolean => {
  if (!value) return false;
  const re = /torrentio\.strem\.fun\/resolve\/realdebrid\//i;
  if (re.test(value)) return true;
  try {
    const decoded = decodeURIComponent(value);
    return re.test(decoded);
  } catch {
    // ignore
  }
  try {
    const decoded2 = decodeURIComponent(decodeURIComponent(value));
    return re.test(decoded2);
  } catch {
    // ignore
  }
  return false;
};

const matchesRdResolve = (
  row: Pick<StreamRow, 'effectiveUrl' | 'playerLink' | 'externalWeb' | 'externalStreaming'>
) => {
  return (
    isTorrentioRdResolveUrl(row.effectiveUrl) ||
    isTorrentioRdResolveUrl(row.externalWeb) ||
    isTorrentioRdResolveUrl(row.externalStreaming) ||
    isTorrentioRdResolveUrl(row.playerLink)
  );
};

const hasLikelyUnsupportedBrowserAudio = (row: Pick<StreamRow, 'leftLabel' | 'rightTitle' | 'metaLine' | 'effectiveUrl'>): boolean => {
  const hay = `${row.leftLabel} ${row.rightTitle} ${row.metaLine} ${row.effectiveUrl ?? ''}`;
  if (/\b(eac3|e-ac-3|ec-3|truehd|atmos|dtshd|dts-hd|dts)\b|\bddp(?=\d|\b|[ ._-])|\bdd\+(?=\d|\b|[ ._-])/i.test(hay)) {
    return true;
  }

  const isMkv = /\.mkv(\b|$)/i.test(hay);
  const is4k = /\b(2160p|4k)\b/i.test(hay);
  const isHdr = /\b(hdr10\+|hdr10plus|hdr10|hdr)\b/i.test(hay);
  const isDv = /\b(dolby\s*vision|\bdv\b)\b/i.test(hay);
  const is10Bit = /\b10bit\b/i.test(hay);
  const isHevc = /\b(x265|h265|hevc)\b/i.test(hay);

  if (isMkv && (is4k || isHdr || isDv) && (isHevc || is10Bit || is4k) && (isHdr || isDv)) {
    return true;
  }

  return false;
};

const getLastPlayedMatchScore = (
  lastStreamUrl: string | null,
  row: Pick<StreamRow, 'effectiveUrl' | 'playerLink' | 'externalWeb' | 'externalStreaming'>
): number => {
  const target = lastStreamUrl;
  if (!target) return 0;

  const candidates = [row.effectiveUrl, row.externalWeb, row.externalStreaming, row.playerLink].filter(
    (v): v is string => typeof v === 'string' && v.length > 0
  );

  if (candidates.some((c) => c === target)) return 3;

  try {
    const decoded = decodeURIComponent(target);
    if (candidates.some((c) => c === decoded)) return 2;
  } catch {
    // ignore
  }
  try {
    const decoded2 = decodeURIComponent(decodeURIComponent(target));
    if (candidates.some((c) => c === decoded2)) return 2;
  } catch {
    // ignore
  }

  return 0;
};

export function buildStreamsView(
  streamsByAddon: StreamsByAddon,
  options: StreamBuildOptions
): StreamBuildResult {
  const { selectedAddon, onlyTorrentioRdResolve, streamSortKey, lastStreamUrl } = options;
  const groups = Object.entries(streamsByAddon);
  const filtered = selectedAddon === 'ALL' ? groups : groups.filter(([k]) => k === selectedAddon);

  const rows: StreamRow[] = filtered
    .flatMap(([transportUrl, group]) =>
      group.streams.map((stream) => {
        const parsed = parseStreamDescription(stream.description ?? stream.title ?? null);
        const rightTitle = parsed.torrentName ?? (stream.title ?? stream.name ?? 'Stream');
        const metaLine = buildStreamMetaLine(parsed);
        const metaSeeders = parsed.seeders ? `👤 ${parsed.seeders}` : null;
        const metaSize = parsed.size ? `💾 ${parsed.size}` : null;
        const metaProvider = parsed.site ? `⚙️ ${parsed.site}` : null;
        const leftLabel = stream.name ?? group.addonName;
        const seedersNum = parsed.seeders ? Number.parseInt(parsed.seeders, 10) : null;
        const sizeBytes = parseSizeBytes(parsed.size);

        const text = `${leftLabel} ${rightTitle} ${stream.title ?? ''} ${stream.description ?? ''} ${stream.url ?? ''}`;
        const isHevc = /\b(x265|h265|hevc)\b/i.test(text);
        const isMkv = /\.mkv(\b|$)/i.test(text);
        const isH264 = /\b(x264|h264|avc)\b/i.test(text);
        const isHls = /\.m3u8(\b|$)/i.test(text);
        const isMp4 = /\.mp4(\b|$)/i.test(text);

        const browserRank =
          (isHls ? 50 : 0) +
          (isMp4 ? 30 : 0) +
          (isH264 ? 20 : 0) +
          (isMkv ? -40 : 0) +
          (isHevc ? -60 : 0);

        const { deepLinks } = stream;
        const playerUrl = normalizeLocalStremioUrl(extractUrlParamFromPlayerLink(deepLinks?.player ?? null));
        const playerLink = deepLinks?.player ?? null;
        const externalWeb = normalizeLocalStremioUrl(deepLinks?.externalPlayer?.web ?? null);
        const externalStreaming = normalizeLocalStremioUrl(deepLinks?.externalPlayer?.streaming ?? null);
        const streamUrl = normalizeLocalStremioUrl(
          typeof stream.url === 'string' && stream.url.length > 0 ? stream.url : null
        );
        const effectiveUrl =
          streamUrl ??
          playerUrl ??
          externalStreaming ??
          externalWeb ??
          null;

        const badAudio = hasLikelyUnsupportedBrowserAudio({
          leftLabel,
          rightTitle,
          metaLine,
          effectiveUrl,
        });
        const likelyPlayableInBrowser = isHttpUrl(effectiveUrl) && (isHls || isMp4) && !isMkv && !badAudio;
        const unplayableReason = !likelyPlayableInBrowser
          ? !isHttpUrl(effectiveUrl)
            ? 'No direct HTTP stream URL'
            : badAudio
              ? isIos()
                ? 'May require an external player (VLC)'
                : 'No audio in web player (EAC3/DDP/DTS/TrueHD/Atmos)'
              : isMkv
                ? isIos()
                  ? 'May require an external player (VLC)'
                  : 'No video/audio in web player (MKV)'
                : isHevc
                  ? isIos()
                    ? 'May require an external player (VLC)'
                    : 'May fail in the web player (HEVC/x265)'
                  : isIos()
                    ? 'May require an external player (VLC)'
                    : 'May fail in the web player'
          : null;

        const lastPlayedMatchScore = getLastPlayedMatchScore(lastStreamUrl, {
          effectiveUrl,
          playerLink,
          externalWeb,
          externalStreaming,
        });

        return {
          transportUrl,
          addonName: group.addonName,
          stream,
          leftLabel,
          rightTitle,
          metaLine,
          metaSeeders,
          metaSize,
          metaProvider,
          seedersNum: Number.isFinite(seedersNum as number) ? (seedersNum as number) : null,
          sizeBytes,
          isLastPlayed: false,
          browserRank,
          effectiveUrl,
          playerLink,
          externalWeb,
          externalStreaming,
          lastPlayedMatchScore,
          likelyPlayableInBrowser,
          unplayableReason,
        };
      })
    )
    .filter((row) => row.stream.url || row.stream.infoHash);

  let lastPlayedRow: typeof rows[number] | null = null;
  if (lastStreamUrl) {
    let bestScore = 0;
    for (const r of rows) {
      const score = r.lastPlayedMatchScore;
      if (score > bestScore) {
        bestScore = score;
        lastPlayedRow = r;
      } else if (score === bestScore && score > 0 && lastPlayedRow) {
        if (r.browserRank > lastPlayedRow.browserRank) lastPlayedRow = r;
      }
    }
  }

  const rdResolveFiltered = onlyTorrentioRdResolve
    ? rows.filter((row) => matchesRdResolve(row) && !hasLikelyUnsupportedBrowserAudio(row))
    : rows;

  const withLastPlayed = (() => {
    if (!lastPlayedRow) return rdResolveFiltered;

    const isAlreadyIncluded = rdResolveFiltered.some(
      (r) => r.stream.url === lastPlayedRow?.stream.url && r.stream.infoHash === lastPlayedRow?.stream.infoHash
    );

    if (isAlreadyIncluded) {
      return rdResolveFiltered.map((r) =>
        r.stream.url === lastPlayedRow?.stream.url && r.stream.infoHash === lastPlayedRow?.stream.infoHash
          ? { ...r, isLastPlayed: true }
          : r
      );
    }

    return [{ ...lastPlayedRow, isLastPlayed: true }, ...rdResolveFiltered];
  })();

  // Single global score: seeders/sqrt(sizeGB + 1) — favors high-seeder
  // streams while still rewarding smaller files (~sqrt penalty so 4K
  // streams aren't fully crushed, just nudged). Streams with no
  // seeders/size metadata fall back to 0. The `streamSortKey` param is
  // retained for API compatibility but ignored — the UI no longer offers
  // a sort dropdown.
  const score = (r: typeof withLastPlayed[number]): number => {
    const seeds = r.seedersNum ?? 0;
    const sizeGb = r.sizeBytes != null ? r.sizeBytes / 1_073_741_824 : 0;
    return seeds / Math.sqrt(sizeGb + 1);
  };
  void streamSortKey;
  const sorted = withLastPlayed.slice().sort((a, b) => {
    if (a.isLastPlayed !== b.isLastPlayed) return a.isLastPlayed ? -1 : 1;
    const sb = score(b);
    const sa = score(a);
    if (sb !== sa) return sb - sa;
    if (b.browserRank !== a.browserRank) return b.browserRank - a.browserRank;
    return a.rightTitle.localeCompare(b.rightTitle);
  });

  return {
    rows: sorted,
    totalCount: sorted.length,
    rdCount: sorted.length,
  };
}
