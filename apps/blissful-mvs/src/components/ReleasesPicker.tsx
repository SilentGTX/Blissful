// Shared Real-Debrid release picker — "Top picks" + per-quality accordions,
// score-sorted, dedup'd. Used both inside the player (Releases tab) and by the
// unreleased-episode "Play with RealDebrid" selector, so both surfaces look and
// sort identically.

import { useMemo, useState } from 'react';

export type ReleaseOption = {
  name: string;
  torrentName: string | null;
  quality: string | null;
  size: string | null;
  seeders: string | null;
  url: string;
};

function releaseSizeBytes(value: string | null): number | null {
  if (!value) return null;
  const m = value.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(GB|MB|GiB|MiB)$/i);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toUpperCase();
  const base = unit.endsWith('IB') ? 1024 : 1000;
  return unit.startsWith('G') ? Math.round(n * base * base * base) : Math.round(n * base * base);
}
// seeders / sqrt(sizeGB + 1) — favors high-seeder streams while nudging toward
// smaller files. Same global score the detail page + player picker use.
function releaseScore(r: ReleaseOption): number {
  const seeds = r.seeders ? Number.parseInt(r.seeders, 10) || 0 : 0;
  const sizeGb = (releaseSizeBytes(r.size) ?? 0) / 1_073_741_824;
  return seeds / Math.sqrt(sizeGb + 1);
}
type ReleaseBucket = '4K' | '1080p' | '720p' | 'SD' | 'Other';
const RELEASE_BUCKET_ORDER: ReleaseBucket[] = ['4K', '1080p', '720p', 'SD', 'Other'];
function releaseBucket(r: ReleaseOption): ReleaseBucket {
  const hay = `${r.name} ${r.torrentName ?? ''} ${r.quality ?? ''}`.toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(hay)) return '4K';
  if (/\b(1440p|2k|1080p|fhd|full ?hd)\b/.test(hay)) return '1080p';
  if (/\b(720p|hd)\b/.test(hay)) return '720p';
  if (/\b(480p|360p|sd)\b/.test(hay)) return 'SD';
  return 'Other';
}
// Torrentio marks not-yet-cached RD torrents "[RD download]" — selecting one
// plays the "being downloaded to debrid…" placeholder, so drop them.
function isUncachedRelease(r: ReleaseOption): boolean {
  return /\[?\s*RD\s*download\s*\]?/i.test(r.name);
}

// The 40-hex BitTorrent infohash uniquely identifies a torrent regardless of
// the URL shape it arrives in — addon stream URL, RD resolve URL, magnet link,
// or the resolved streaming-server URL (http://127.0.0.1:11470/<infohash>/…).
// Used both to dedup the same torrent coming back from several trackers and to
// line the "now playing" URL up with its release row even when the two differ
// in query params / encoding.
function releaseInfohash(url: string): string | null {
  // magnet (xt=urn:btih:<hash>), else a delimited path segment — the same
  // proven shape the dedup has always used, just also covering magnet links.
  const m = url.match(/btih:([a-f0-9]{40})/i) ?? url.match(/[/:]([a-f0-9]{40})(?:[/:]|$)/i);
  return m ? m[1].toLowerCase() : null;
}
function sameRelease(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ha = releaseInfohash(a);
  return ha != null && ha === releaseInfohash(b);
}

export function ReleasesPicker({
  releases,
  selectedReleaseUrl,
  onSelectRelease,
  onClose,
  className,
}: {
  releases: ReleaseOption[];
  selectedReleaseUrl?: string | null;
  onSelectRelease?: (url: string) => void;
  onClose?: () => void;
  className?: string;
}) {
  // Keep BOTH cached ("[RD+]") and not-yet-cached ("[RD download]") releases so
  // the list matches the desktop app — cached play instantly, uncached are shown
  // (marked + sorted last) and start caching on RD when picked. Sort by score,
  // bucket by resolution, dedup.
  const releaseBuckets = useMemo(() => {
    if (!releases || releases.length === 0) return null;
    const sorted = releases.slice().sort((a, b) => {
      const ua = isUncachedRelease(a) ? 1 : 0;
      const ub = isUncachedRelease(b) ? 1 : 0;
      if (ua !== ub) return ua - ub; // cached first
      return releaseScore(b) - releaseScore(a);
    });
    // Dedup by the torrent's TRUE identity — the 40-hex infohash in the RD
    // resolve URL — when available. That merges the same torrent coming back
    // from several trackers/addons WITHOUT collapsing genuinely different
    // encodes that happen to share a normalized name (which over-shrank the
    // list vs the desktop app). Falls back to normalized-name + size.
    const seen = new Set<string>();
    const list = sorted.filter((r) => {
      const ih = releaseInfohash(r.url);
      let key: string;
      if (ih) {
        key = 'ih:' + ih;
      } else {
        const base = (r.torrentName || r.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        key = (base || r.url) + '|' + (r.size || '');
      }
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const buckets: Record<ReleaseBucket, ReleaseOption[]> = { '4K': [], '1080p': [], '720p': [], SD: [], Other: [] };
    for (const r of list) buckets[releaseBucket(r)].push(r);
    return buckets;
  }, [releases]);

  // "Top picks": best 4K + best 1080p (first of each score-sorted bucket).
  const releaseTopPicks = useMemo(() => {
    if (!releaseBuckets) return [] as ReleaseOption[];
    return [releaseBuckets['4K'][0], releaseBuckets['1080p'][0]].filter(Boolean) as ReleaseOption[];
  }, [releaseBuckets]);

  const [openReleaseBuckets, setOpenReleaseBuckets] = useState<Set<ReleaseBucket>>(new Set());
  const toggleReleaseBucket = (b: ReleaseBucket) =>
    setOpenReleaseBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  if (!releaseBuckets) return null;

  const renderReleaseRow = (r: ReleaseOption, key: string) => {
    const isSelected = sameRelease(r.url, selectedReleaseUrl);
    const uncached = isUncachedRelease(r);
    const leftLabel = r.name.replace(/\s*\n\s*/g, ' ').trim();
    const title = r.torrentName || leftLabel;
    const isRdStream = /\[RD\+?\]|realdebrid|real-?debrid/i.test(`${r.name} ${r.url}`);
    const meta = [
      r.size ? `💾 ${r.size}` : null,
      r.seeders ? `👤 ${r.seeders}` : null,
    ].filter(Boolean).join('   ');
    return (
      <button
        key={key}
        type="button"
        title={uncached ? 'Not cached on Real-Debrid yet — picking it asks RD to prepare it (may take a bit)' : undefined}
        className={
          'flex items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition ' +
          (isSelected
            ? 'cursor-pointer bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)]'
            : 'cursor-pointer bg-white/[0.04] text-white/85 hover:bg-white/10') +
          (uncached ? ' opacity-60' : '')
        }
        onClick={() => {
          if (!isSelected) onSelectRelease?.(r.url);
          onClose?.();
        }}
      >
        <div className="min-w-0">
          {leftLabel && leftLabel.toLowerCase() !== title.toLowerCase() ? (
            <div className="mb-0.5 truncate text-[11px] font-semibold text-[var(--bliss-accent)]/90" title={leftLabel}>{leftLabel}</div>
          ) : null}
          <div className="line-clamp-2 break-words text-sm font-medium leading-snug" title={title}>{title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/55">
            {isRdStream ? (
              <span className="rounded bg-[var(--bliss-accent)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--bliss-accent)]">RD</span>
            ) : null}
            {uncached ? (
              <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300/90">Not cached</span>
            ) : null}
            {meta ? <span className="truncate">{meta}</span> : null}
          </div>
        </div>
        {isSelected ? (
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-[var(--bliss-accent)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        ) : null}
      </button>
    );
  };

  // The currently-playing release gets its own "Continue watching" section at
  // the top; pull it out of Top picks + the accordions so it never appears (or
  // ticks) twice — mirrors the desktop app.
  const allRows = RELEASE_BUCKET_ORDER.flatMap((b) => releaseBuckets[b]);
  const nowPlaying = selectedReleaseUrl ? allRows.find((r) => sameRelease(r.url, selectedReleaseUrl)) ?? null : null;
  const visibleTopPicks = nowPlaying ? releaseTopPicks.filter((r) => r.url !== nowPlaying.url) : releaseTopPicks;
  const hideUrls = new Set<string>(visibleTopPicks.map((r) => r.url));
  if (nowPlaying) hideUrls.add(nowPlaying.url);
  return (
    <div className={'flex flex-col gap-3 ' + (className ?? '')}>
      {nowPlaying ? (
        <div className="flex flex-col gap-1">
          <div className="px-1 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--bliss-accent)]/80">
            Continue watching
          </div>
          {renderReleaseRow(nowPlaying, `cw-${nowPlaying.url}`)}
        </div>
      ) : null}
      {visibleTopPicks.length ? (
        <div className="flex flex-col gap-1">
          <div className="px-1 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            Top picks
          </div>
          {visibleTopPicks.map((r, i) => renderReleaseRow(r, `pick-${i}-${r.url}`))}
        </div>
      ) : null}
      {RELEASE_BUCKET_ORDER.map((bucket) => {
        const items = releaseBuckets[bucket].filter((r) => !hideUrls.has(r.url));
        if (items.length === 0) return null;
        const isOpen = openReleaseBuckets.has(bucket);
        return (
          <div key={bucket} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggleReleaseBucket(bucket)}
              className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-left transition hover:bg-white/5"
            >
              <span className="text-sm font-semibold text-white/90">{bucket}</span>
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/60">{items.length}</span>
              <svg
                className={'ml-auto h-4 w-4 shrink-0 text-white/50 transition-transform ' + (isOpen ? 'rotate-180' : '')}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {isOpen ? (
              <div className="flex flex-col gap-1 pt-1">
                {items.map((r, i) => renderReleaseRow(r, `${bucket}-${i}-${r.url}`))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
