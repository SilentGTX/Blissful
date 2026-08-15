// Does this release actually contain the episode we asked for?
//
// Torrentio (and friends) answer /stream/series/<id> by mapping the id onto a
// file inside a torrent, and that mapping is regularly wrong for anime, where
// the addon id numbers episodes ABSOLUTELY (kitsu:244:2 = Bleach episode 2 of
// 366) while releases are packed per broadcast season. Asking for Bleach
// episode 2 returned, top of the list:
//
//   [LGH] Bleach Season 17 (S17) E01-E13 … Bleach.S17E02.1080p…mkv   ← wrong show-part
//   [pursua] Bleach 001-366 … S01E02 - 002 - A Shinigamis Work.mkv   ← right
//
// Both are cached 1080p H.264, so every existing signal (cache tier, codec,
// quality) called them equal and the auto-pick took the first — Thousand-Year
// Blood War instead of episode 2.
//
// So: score how well a release NAME matches the episode we expect, and let the
// auto-pick add it to its ranking. Bonus-only and deliberately mid-weight — it
// outranks codec/quality inside a cache tier but never promotes an uncached
// release over a cached one, and a title whose releases all disagree with the
// addon's numbering just scores 0 across the board (no reordering, no harm).

export type ExpectedEpisode = {
  /** Season from the addon meta for this videoId (Kitsu reports 1 for everything). */
  season: number | null;
  /** Episode within that season. */
  episode: number | null;
  /** Absolute episode number, for schemes that number that way (kitsu:<id>:<abs>). */
  absolute: number | null;
  /** Episode title from the addon meta, when it has one. */
  title: string | null;
};

/** Every explicit SxxEyy / 1x02 marker in a release name, in order. */
function parseSeasonEpisodeMarkers(text: string): Array<{ season: number; episode: number }> {
  const out: Array<{ season: number; episode: number }> = [];
  for (const m of text.matchAll(/\bs(\d{1,3})[\s._-]*e(\d{1,4})\b/gi)) {
    out.push({ season: Number.parseInt(m[1], 10), episode: Number.parseInt(m[2], 10) });
  }
  for (const m of text.matchAll(/\b(\d{1,2})x(\d{1,3})\b/g)) {
    out.push({ season: Number.parseInt(m[1], 10), episode: Number.parseInt(m[2], 10) });
  }
  return out;
}

/** Standalone episode numbers — "E002", "Episode 2", " - 002 - ". Never matches
 *  inside an SxxEyy marker (no word boundary between "S17" and "E02"), so a
 *  season-tagged release can't masquerade as absolute numbering. */
function parseAbsoluteMarkers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\be(\d{1,4})\b/gi)) out.push(Number.parseInt(m[1], 10));
  for (const m of text.matchAll(/\bep(?:isode)?[\s._-]*(\d{1,4})\b/gi)) out.push(Number.parseInt(m[1], 10));
  for (const m of text.matchAll(/(?:^|[\s._])-[\s._]*(\d{1,4})[\s._]*-(?:$|[\s._])/g)) {
    out.push(Number.parseInt(m[1], 10));
  }
  return out;
}

/** Lowercase alphanumerics only — release names mangle spaces, apostrophes and
 *  punctuation ("A Shinigami's Work" → "A Shinigamis Work"). */
function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * How strongly `releaseText` (name + description + filename, whatever is
 * available) says it is the expected episode. 0 = no positive evidence, which
 * is also what a release that CONTRADICTS the expected season scores.
 */
export function scoreEpisodeMatch(
  releaseText: string,
  expected: ExpectedEpisode | null | undefined,
): number {
  if (!expected || !releaseText) return 0;
  const { season, episode, absolute, title } = expected;
  let score = 0;

  // Episode title is the strongest signal and scheme-independent — it can only
  // come from the right episode. Short titles ("The End") collide too easily.
  if (title) {
    const needle = normalizeTitle(title);
    if (needle.length >= 8 && normalizeTitle(releaseText).includes(needle)) score += 6_000;
  }

  const markers = parseSeasonEpisodeMarkers(releaseText);
  if (season != null && episode != null && markers.some((m) => m.season === season && m.episode === episode)) {
    return score + 4_000;
  }
  // An SxxEyy that lands on our episode number but a DIFFERENT season is the
  // exact failure this scorer exists for (Bleach S17E02 for absolute ep 2).
  // Don't let its bare "02" earn the absolute bonus below.
  const contradicted =
    episode != null && markers.some((m) => m.episode === episode && m.season !== season);
  if (contradicted) return score;

  if (absolute != null && parseAbsoluteMarkers(releaseText).includes(absolute)) score += 3_000;
  return score;
}

/**
 * What episode `videoId` refers to, from the addon meta's own video list plus
 * the id's shape. Scheme-prefixed ids (`kitsu:244:2`) carry an ABSOLUTE episode
 * number in their last segment; `tt…:s:e` ids don't (their tail is the
 * in-season number, which the meta already reports).
 */
export function expectedEpisodeFor(
  videoId: string | null | undefined,
  videos: Array<{ id: string; season?: number; episode?: number; title?: string; name?: string }> | null | undefined,
): ExpectedEpisode | null {
  if (!videoId) return null;
  const parts = videoId.split(':');
  if (parts.length < 3) return null;
  const isSchemePrefixed = !/\d/.test(parts[0]);
  const tail = Number.parseInt(parts[parts.length - 1], 10);
  const absolute = isSchemePrefixed && Number.isFinite(tail) ? tail : null;

  const video = videos?.find((v) => v.id === videoId);
  const season = typeof video?.season === 'number' ? video.season : null;
  const metaEpisode = typeof video?.episode === 'number' ? video.episode : null;
  // No meta yet (it loads in parallel with the streams): fall back to the id's
  // own shape — `tt…:s:e` spells out the season/episode, prefixed ids give the
  // absolute number.
  const idSeason = !isSchemePrefixed ? Number.parseInt(parts[parts.length - 2], 10) : NaN;
  const episode = metaEpisode ?? (Number.isFinite(tail) ? tail : null);

  const result: ExpectedEpisode = {
    season: season ?? (Number.isFinite(idSeason) ? idSeason : null),
    episode,
    absolute,
    title: video?.title ?? video?.name ?? null,
  };
  return result.episode != null || result.absolute != null || result.title ? result : null;
}
