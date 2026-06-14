// Shared Real-Debrid banana (release) picker — "Top picks" + per-quality
// accordions, score-sorted, dedup'd. Used both inside the player (Releases tab)
// and by the unreleased-episode "Play with RealDebrid" selector, so both
// surfaces look and sort identically.

import { useEffect, useMemo, useRef, useState } from 'react';
import { filterRelevantBananas } from '../lib/bananaRelevance';

export type BananaOption = {
  name: string;
  torrentName: string | null;
  quality: string | null;
  size: string | null;
  seeders: string | null;
  url: string;
};

function bananaSizeBytes(value: string | null): number | null {
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
function bananaScore(r: BananaOption): number {
  const seeds = r.seeders ? Number.parseInt(r.seeders, 10) || 0 : 0;
  const sizeGb = (bananaSizeBytes(r.size) ?? 0) / 1_073_741_824;
  return seeds / Math.sqrt(sizeGb + 1);
}
type BananaBucket = '4K' | '1080p' | '720p' | 'SD' | 'Other';
const BANANA_BUCKET_ORDER: BananaBucket[] = ['4K', '1080p', '720p', 'SD', 'Other'];
function bananaBucket(r: BananaOption): BananaBucket {
  const hay = `${r.name} ${r.torrentName ?? ''} ${r.quality ?? ''}`.toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(hay)) return '4K';
  if (/\b(1440p|2k|1080p|fhd|full ?hd)\b/.test(hay)) return '1080p';
  if (/\b(720p|hd)\b/.test(hay)) return '720p';
  if (/\b(480p|360p|sd)\b/.test(hay)) return 'SD';
  return 'Other';
}
// Real-Debrid cache markers in the addon's name. Torrentio "[RD+]" = cached
// and empirically streams instantly, so it's trusted. Comet "[RD⚡]" is Comet's
// *claimed* cached flag, but it's a stale public-cache guess (RD removed
// /instantAvailability in 2024), so it is NOT trusted as instant — it gets
// verified live against RD (see the verify effect). "[RD download]" / "[RD↓]" /
// "[RD⬇]" = explicitly not cached.
function isCachedBanana(r: BananaOption): boolean {
  return /\[\s*RD\s*\+/iu.test(r.name);
}
function isUncachedBanana(r: BananaOption): boolean {
  return /\[\s*RD\s*(?:download|↓|⬇)/iu.test(r.name);
}
// Live RD cache verification by infohash, module-level so it survives renders +
// component instances within a session. present+true = RD confirms cached now;
// present+false = RD confirms not cached; absent = unchecked.
const rdCacheVerified = new Map<string, boolean>();
const rdCacheInflight = new Set<string>();
// Hard cap on live /rd-by-hash checks per picker mount, so a huge bucket of
// uncached releases can't churn the RD account. ~4 per Top-pick slot.
const MAX_LIVE_CHECKS = 8;
// Sort weight: cached first (0), unknown (1), uncached last (2). "Cached" =
// trusted "[RD+]" OR an RD-verified hash; "uncached" = a not-cached marker OR
// RD-verified-false; everything else (e.g. unverified Comet "[RD⚡]") is unknown
// until its live check lands.
function bananaCacheRank(r: BananaOption): number {
  if (isCachedBanana(r)) return 0;
  const ih = bananaInfohash(r.url);
  if (ih && rdCacheVerified.get(ih) === true) return 0;
  if (ih && rdCacheVerified.get(ih) === false) return 2;
  if (isUncachedBanana(r)) return 2;
  return 1;
}

// The 40-hex BitTorrent infohash uniquely identifies a torrent regardless of
// the URL shape it arrives in — addon stream URL, RD resolve URL, magnet link,
// or the resolved streaming-server URL (http://127.0.0.1:11470/<infohash>/…).
// Used both to dedup the same torrent coming back from several trackers and to
// line the "now playing" URL up with its banana row even when the two differ
// in query params / encoding.
function bananaInfohash(url: string): string | null {
  // magnet (xt=urn:btih:<hash>), else a delimited path segment — the same
  // proven shape the dedup has always used, just also covering magnet links.
  const m = url.match(/btih:([a-f0-9]{40})/i) ?? url.match(/[/:]([a-f0-9]{40})(?:[/:]|$)/i);
  return m ? m[1].toLowerCase() : null;
}
function sameBanana(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ha = bananaInfohash(a);
  return ha != null && ha === bananaInfohash(b);
}

export function BananasPicker({
  releases,
  selectedReleaseUrl,
  onSelectRelease,
  onClose,
  className,
  reselectable = false,
  verifyCache = false,
  relevanceTitle = null,
  hideUncached = true,
}: {
  releases: BananaOption[];
  selectedReleaseUrl?: string | null;
  onSelectRelease?: (url: string) => void;
  onClose?: () => void;
  className?: string;
  /** Expected meta title (e.g. "From"). When set, releases whose name doesn't
   *  plausibly belong to it are dropped — Comet loose-matches short/common
   *  titles and leaks unrelated torrents. Falls back to the full list if the
   *  filter would empty it. See lib/bananaRelevance. */
  relevanceTitle?: string | null;
  /** Player: the selected row is the now-playing stream, so re-clicking it is a
   *  no-op. Detail page: the selected row is the last-played ("Continue
   *  watching") release — set this so clicking it still fires onSelectRelease
   *  (navigates to play it). */
  reselectable?: boolean;
  /** Detail page: live-verify the Top-pick candidates against Real-Debrid
   *  (/rd-by-hash) and pin only RD-confirmed-cached releases — Comet's "[RD⚡]"
   *  marker is an unreliable cache hint. Off in the player (its releases are
   *  already RD-resolved). */
  verifyCache?: boolean;
  /** Hide known-not-cached releases ("[RD download]" / RD-verified-false) so the
   *  list only offers instantly-playable torrents. Per resolution bucket: if a
   *  bucket has nothing cached/unknown, its uncached releases are shown anyway
   *  (so it's never empty). The now-playing release is always kept. Default on. */
  hideUncached?: boolean;
}) {
  // Bumped when a live RD cache check lands, so the buckets re-rank and Top
  // picks recompute with the confirmed cache status.
  const [verifyVersion, setVerifyVersion] = useState(0);
  const checksKickedRef = useRef(0);
  // Real-Debrid mode: do ANY releases carry an RD marker ("[RD+]", "[RD⚡]",
  // "[RD download]") or an RD URL? A profile WITHOUT an RD key gets only raw
  // torrents — there's no "cached" concept, so the cache rank / verification /
  // confirmed-only Top picks all switch off and we just rank by quality.
  const rdMode = useMemo(
    () => (releases ?? []).some((r) => /\[\s*RD/iu.test(r.name) || /real-?debrid/i.test(r.url)),
    [releases],
  );
  // Keep BOTH cached ("[RD+]") and not-yet-cached ("[RD download]") releases so
  // the list matches the desktop app — cached play instantly, uncached are shown
  // (marked + sorted last) and start caching on RD when picked. Sort by score,
  // bucket by resolution, dedup.
  const bananaBuckets = useMemo(() => {
    if (!releases || releases.length === 0) return null;
    // Drop torrents that don't belong to the requested title (Comet leaks
    // unrelated results for short/common titles). Safe: empties → full list.
    let relevant = filterRelevantBananas(releases, relevanceTitle);
    // Never let the relevance filter hide the release that's actually playing —
    // it must still appear as the "Continue watching" pin even if its name
    // doesn't match the title (e.g. a multi-title pack).
    if (selectedReleaseUrl && !relevant.some((r) => sameBanana(r.url, selectedReleaseUrl))) {
      const sel = releases.find((r) => sameBanana(r.url, selectedReleaseUrl));
      if (sel) relevant = [sel, ...relevant];
    }
    const sorted = relevant.slice().sort((a, b) => {
      const ra = bananaCacheRank(a);
      const rb = bananaCacheRank(b);
      if (ra !== rb) return ra - rb; // cached → unknown → uncached
      return bananaScore(b) - bananaScore(a);
    });
    // Dedup by the torrent's TRUE identity — the 40-hex infohash in the RD
    // resolve URL — when available. That merges the same torrent coming back
    // from several trackers/addons WITHOUT collapsing genuinely different
    // encodes that happen to share a normalized name (which over-shrank the
    // list vs the desktop app). Falls back to normalized-name + size.
    const seen = new Set<string>();
    const list = sorted.filter((r) => {
      const ih = bananaInfohash(r.url);
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
    const buckets: Record<BananaBucket, BananaOption[]> = { '4K': [], '1080p': [], '720p': [], SD: [], Other: [] };
    for (const r of list) buckets[bananaBucket(r)].push(r);
    // Hide known-not-cached releases (rank 2) so the picker only offers
    // instantly-playable torrents — but per bucket: if a bucket has nothing
    // cached/unknown, keep its uncached rows ("show only if nothing else").
    // The now-playing release is always kept regardless of cache status.
    if (hideUncached && rdMode) {
      for (const b of BANANA_BUCKET_ORDER) {
        const kept = buckets[b].filter(
          (r) => bananaCacheRank(r) < 2 || sameBanana(r.url, selectedReleaseUrl),
        );
        if (kept.length > 0) buckets[b] = kept;
      }
    }
    return buckets;
  }, [releases, relevanceTitle, hideUncached, rdMode, selectedReleaseUrl, verifyVersion]);

  // Live-verify Top-pick candidates against Real-Debrid. Comet's "[RD⚡]" is an
  // unreliable cache hint, so for the releases that could win a Top-pick slot
  // (top of the 4K + 1080p buckets, excluding trusted "[RD+]") we ask
  // /rd-by-hash whether RD has the hash cached right now, then re-rank.
  useEffect(() => {
    if (!verifyCache || !rdMode || !bananaBuckets || checksKickedRef.current >= MAX_LIVE_CHECKS) return;
    const toCheck: string[] = [];
    for (const bucket of ['4K', '1080p'] as const) {
      // Already has a confirmed-cached pick (trusted [RD+] or RD-verified) — no
      // need to spend checks on this bucket.
      if (bananaBuckets[bucket].some((r) => bananaCacheRank(r) === 0)) continue;
      for (const r of bananaBuckets[bucket].slice(0, 4)) {
        if (isCachedBanana(r) || isUncachedBanana(r)) continue; // trusted / explicitly-uncached
        const ih = bananaInfohash(r.url);
        if (ih && !rdCacheVerified.has(ih) && !rdCacheInflight.has(ih)) toCheck.push(ih);
      }
    }
    const batch = toCheck.slice(0, MAX_LIVE_CHECKS - checksKickedRef.current);
    if (batch.length === 0) return;
    checksKickedRef.current += batch.length;
    let cancelled = false;
    batch.forEach((ih) => rdCacheInflight.add(ih));
    void Promise.all(
      batch.map(async (ih) => {
        try {
          const res = await fetch(`/rd-by-hash?infoHash=${encodeURIComponent(ih)}`);
          rdCacheVerified.set(ih, res.ok);
        } catch {
          /* leave unchecked — falls back to the marker-based rank */
        } finally {
          rdCacheInflight.delete(ih);
        }
      }),
    ).then(() => {
      if (!cancelled) setVerifyVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [verifyCache, rdMode, bananaBuckets]);

  // "Top picks": best per slot, EXCLUDING the now-playing/continue-watching
  // release (it's shown in its own section above, so a slot must offer a
  // DIFFERENT option — otherwise the cached now-playing steals the 1080p slot
  // and gets filtered out, leaving only one pick). Prefer a confirmed-cached
  // release (trusted "[RD+]" or RD-verified); fall back to the best available.
  const bananaTopPicks = useMemo(() => {
    if (!bananaBuckets) return [] as BananaOption[];
    // Prefer a confirmed-cached release (trusted "[RD+]" or RD-verified via
    // /rd-by-hash) so the slot plays instantly — Comet's "[RD⚡]" lies, so it
    // only wins if RD actually confirms it. Fall back to the best release in
    // the bucket when nothing's confirmed cached, so Top picks are never empty
    // (non-RD / broken-RD profiles, or a title with no cached release). The
    // green "Cached" badge marks which picks truly play instantly.
    const pick = (b: BananaBucket) => {
      const rows = bananaBuckets[b].filter((r) => !sameBanana(r.url, selectedReleaseUrl));
      return rows.find((r) => bananaCacheRank(r) === 0) ?? rows[0];
    };
    return [pick('4K'), pick('1080p')].filter(Boolean) as BananaOption[];
  }, [bananaBuckets, selectedReleaseUrl]);

  const [openBananaBuckets, setOpenBananaBuckets] = useState<Set<BananaBucket>>(new Set());
  const toggleBananaBucket = (b: BananaBucket) =>
    setOpenBananaBuckets((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  if (!bananaBuckets) return null;

  const renderBananaRow = (r: BananaOption, key: string) => {
    const isSelected = sameBanana(r.url, selectedReleaseUrl);
    // Trust the cache RANK, not the addon's glyph: 0 = confirmed cached
    // (trusted "[RD+]" or RD-verified), 2 = confirmed NOT cached, 1 = unverified
    // (e.g. Comet "[RD⚡]" we couldn't confirm — show it plainly, no promises).
    const rank = bananaCacheRank(r);
    const confirmedCached = rank === 0;
    const notCached = rank === 2;
    const uncached = notCached;
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
          // Player: clicking the now-playing (selected) row is a no-op. Detail
          // page (reselectable): clicking the Continue-watching row still plays.
          if (!isSelected || reselectable) onSelectRelease?.(r.url);
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
            {confirmedCached ? (
              <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300/90">Cached</span>
            ) : null}
            {notCached ? (
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

  // The currently-playing release gets its own "Progress Banana" (continue-
  // watching) section at the top; pull it out of Top picks + the accordions so
  // it never appears (or ticks) twice — mirrors the desktop app.
  const allRows = BANANA_BUCKET_ORDER.flatMap((b) => bananaBuckets[b]);
  const nowPlaying = selectedReleaseUrl ? allRows.find((r) => sameBanana(r.url, selectedReleaseUrl)) ?? null : null;
  const visibleTopPicks = nowPlaying ? bananaTopPicks.filter((r) => r.url !== nowPlaying.url) : bananaTopPicks;
  const hideUrls = new Set<string>(visibleTopPicks.map((r) => r.url));
  if (nowPlaying) hideUrls.add(nowPlaying.url);
  return (
    <div className={'flex flex-col gap-3 ' + (className ?? '')}>
      {nowPlaying ? (
        <div className="flex flex-col gap-1">
          <div className="px-1 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--bliss-accent)]/80">
            🍌 Progress Banana
          </div>
          {renderBananaRow(nowPlaying, `cw-${nowPlaying.url}`)}
        </div>
      ) : null}
      {visibleTopPicks.length ? (
        <div className="flex flex-col gap-1">
          <div className="px-1 pt-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-white/50">
            Top picks
          </div>
          {visibleTopPicks.map((r, i) => renderBananaRow(r, `pick-${i}-${r.url}`))}
        </div>
      ) : null}
      {BANANA_BUCKET_ORDER.map((bucket) => {
        const items = bananaBuckets[bucket].filter((r) => !hideUrls.has(r.url));
        if (items.length === 0) return null;
        const isOpen = openBananaBuckets.has(bucket);
        return (
          <div key={bucket} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggleBananaBucket(bucket)}
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
                {items.map((r, i) => renderBananaRow(r, `${bucket}-${i}-${r.url}`))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
