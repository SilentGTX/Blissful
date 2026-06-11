// Fetch the full Real-Debrid release list for a title — the SAME source the
// in-player "Releases" picker uses: every installed addon's /stream results
// PLUS the house /rd-fallback, parsed into the structured fields the picker
// buckets/sorts on. Lets surfaces OUTSIDE the player (e.g. the unreleased-
// episode "Play with RealDebrid" selector) show the complete list, not just
// the ~4 the house fallback returns on its own.
//
// Streams results PROGRESSIVELY: `onPartial` fires with the accumulated list as
// each source resolves, so the UI can show the button + a partial list within
// ~1-2s instead of blocking on the slowest addon. A per-source timeout means a
// dead/hung addon can't stall the whole fetch.

import { fetchStreams, type StremioStream } from './stremioAddon';
import { parseStreamDescription } from '../features/detail/utils';
import type { AddonDescriptor } from './mediaTypes';

export type FallbackRelease = {
  name: string;
  torrentName: string | null;
  quality: string | null;
  size: string | null;
  seeders: string | null;
  url: string;
};

// Some addons (e.g. Comet) title-search and return WRONG shows that merely
// contain the title word — for "From" S04E07 you get "Quiz from God S04E07",
// "3rd Rock from the Sun S04E07", "From Married To Medicine S04E07", etc. A real
// release has the show title sitting right before the SxxExx marker (modulo a
// trailing year / country / edition tag), with at most a franchise/studio
// PREFIX before it ("Marvels.Daredevil"). So: the title must appear in the
// pre-episode part, and everything AFTER its last occurrence must be tag-like —
// allowing anything before it. Keep only those.
export function releaseMatchesShow(releaseName: string, showTitle: string): boolean {
  const target = showTitle.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!target || target.length < 2) return true; // too generic to filter safely
  const name = releaseName || '';
  const m = name.match(/(s\d{1,2}\s*e\d{1,2}|\b\d{1,2}x\d{1,2}\b|\bs\d{1,2}\b)/i);
  if (!m || m.index === undefined) return true; // no episode marker → don't judge
  const norm = name.slice(0, m.index).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const idx = norm.lastIndexOf(target);
  if (idx < 0) return false; // title not present at all → wrong show
  let rest = norm.slice(idx + target.length); // what sits between title and SxxExx
  // Allow trailing year / country / common edition tags (any order, a few deep).
  for (let i = 0; i < 4; i++) {
    rest = rest.replace(/^((19|20)\d{2}|us|uk|au|ca|nz|uncut|extended|proper|repack|internal|complete|limited)/, '');
  }
  return rest.length === 0;
}

export async function fetchFallbackReleases(opts: {
  type: string;
  /** streamId — the episode videoId for series (e.g. "tt9813792:4:7"), else the id. */
  id: string;
  addons: AddonDescriptor[];
  /** Show title — when set, drop releases for OTHER shows (fuzzy addon matches). */
  showTitle?: string;
  /** Called with the accumulated releases as each source resolves. */
  onPartial?: (releases: FallbackRelease[]) => void;
  /** Per-source cap so one dead addon can't stall everything. Default 8s. */
  perSourceTimeoutMs?: number;
}): Promise<FallbackRelease[]> {
  const { type, id, addons, showTitle, onPartial, perSourceTimeoutMs = 8000 } = opts;
  const stripManifest = (t: string) => t.replace(/\/manifest\.json$/, '').replace(/\/$/, '');

  const withTimeout = (p: Promise<StremioStream[]>): Promise<StremioStream[]> =>
    Promise.race([
      p.catch(() => [] as StremioStream[]),
      new Promise<StremioStream[]>((res) => setTimeout(() => res([]), perSourceTimeoutMs)),
    ]);

  const acc: FallbackRelease[] = [];
  const parseInto = (streams: StremioStream[], addonName: string) => {
    for (const s of streams ?? []) {
      // HTTPS only — magnets / notWebReady need the local stremio-service we
      // don't run in the browser.
      if (!s.url || !/^https?:\/\//i.test(s.url)) continue;
      if (s.behaviorHints?.notWebReady === true) continue;
      const description = s.description ?? s.title ?? '';
      const parsed = parseStreamDescription(description);
      // Drop fuzzy wrong-show matches (Comet etc.).
      if (showTitle && !releaseMatchesShow(parsed.torrentName || s.name || '', showTitle)) continue;
      const hay = `${s.name ?? ''} ${description}`;
      const qualMatch = hay.match(/\b(2160p|4k|1080p|720p|480p|360p)\b/i);
      acc.push({
        name: s.name ?? addonName,
        torrentName: parsed.torrentName,
        quality: qualMatch ? qualMatch[1].toLowerCase() : null,
        size: parsed.size,
        seeders: parsed.seeders,
        url: s.url,
      });
    }
    onPartial?.(acc.slice());
  };

  const tasks: Promise<void>[] = addons.map((a) => {
    let addonName = a.manifest?.name ?? 'Addon';
    if (!a.manifest?.name) {
      try { addonName = new URL(a.transportUrl).hostname; } catch { /* keep default */ }
    }
    return withTimeout(
      fetchStreams({ type, id, baseUrl: stripManifest(a.transportUrl) }).then((res) => res.streams ?? [])
    ).then((streams) => parseInto(streams, addonName));
  });

  // House RD fallback — server-side key, key-free direct URLs. Folded in so
  // keyless users still see releases.
  tasks.push(
    withTimeout(
      fetch(`/rd-fallback?type=${type}&id=${encodeURIComponent(id)}`)
        .then((r) => (r.ok ? r.json() : { streams: [] }))
        .then((d: { streams?: StremioStream[] }) => d.streams ?? [])
    ).then((streams) => parseInto(streams, 'Real-Debrid'))
  );

  await Promise.allSettled(tasks);
  return acc;
}
