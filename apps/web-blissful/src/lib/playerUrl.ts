// Short, shareable player URLs.
//
// The web player historically took ALL of its state as query params on
// `/player?url=…&type=…&id=…&poster=…&title=…&t=…` — which, for a
// Real-Debrid stream, meant the fully-resolved torrentio URL plus a
// giant title blob plus every artwork URL, producing address-bar
// monsters hundreds of characters long.
//
// These helpers express the SAME playback intent as a short path:
//
//   /player/auto/tt2861424:9:1/Rick.and.Morty.S09E01
//   /player/rd/tt2861424:9:1/Rick.and.Morty.S09E01.1080p.Slurpuff
//   /player/auto/tt0137523/Fight.Club                  (movie)
//
// The path carries only what the player can't re-derive: the SOURCE
// (rd = this profile has a Real-Debrid key, resolve RD-first; auto = no RD
// key, resolve vidking-first — the player falls back to RD either way if the
// primary is down; `vidking` is the legacy alias for `auto`, still parsed so
// old links keep working) and the machine id (`<imdbId>` for a movie,
// `<imdbId>:<season>:<episode>`
// for an episode). The trailing segment is a cosmetic slug — ignored on
// parse, present only so the URL reads like the thing you're watching.
// Everything else (artwork, title, resume position, the exact stream)
// the player looks up: Cinemeta meta by id, saved progress, and a fresh
// vidking / rd-fallback resolve. The legacy query form still parses, so
// old bookmarks and shared links keep working.

import { readStoredPlayerSettings } from './playerSettings';

// `rd` = this profile plays Real-Debrid (it has an RD key). `auto` = resolve
// fresh, vidking-first (profiles with no RD key). `vidking` is the legacy alias
// for `auto`, kept so old bookmarks / shared links still parse.
export type PlayerSource = 'vidking' | 'rd' | 'auto';

// The source label for a freshly-built player link, chosen from THIS profile's
// settings: `rd` when it has a Real-Debrid key (so the URL reads /player/rd/…,
// honest about what plays), else `auto`. Behaviour is identical either way —
// the player resolves RD-first for RD-key profiles regardless of the label —
// so this only decides how the address bar reads. Reads the local settings
// cache (sync); falls back to `auto` if it's unavailable.
export function defaultPlayerSource(): PlayerSource {
  try {
    return readStoredPlayerSettings().realDebridApiKey?.trim() ? 'rd' : 'auto';
  } catch {
    return 'auto';
  }
}

export type PlayerTarget = {
  source: PlayerSource;
  type: string; // 'movie' | 'series' (derived from the id shape)
  id: string; // bare imdb id, e.g. tt2861424
  videoId: string | null; // series only, e.g. tt2861424:9:1
};

// Turn a human title / release name into a URL-safe, dot-joined slug:
// "Rick and Morty - S9E1" → "Rick.and.Morty.S9E1". Release names that
// are already dot-joined ("Rick.and.Morty.S09E01.1080p.Slurpuff") pass
// through essentially unchanged. Capped so a pathological title can't
// re-bloat the URL. Purely cosmetic — never read back.
export function slugifyTitle(title: string | null | undefined): string {
  if (!title) return '';
  return (
    title
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}.\-_ ]+/gu, '') // drop emoji, slashes, punctuation
      .replace(/\s+-\s+/g, ' ') // " - " is a separator, not a token hyphen (keep "x265-ELiTE")
      .trim()
      .replace(/[\s_]+/g, '.') // spaces → dots
      .replace(/\.{2,}/g, '.') // collapse runs
      .replace(/^\.+|\.+$/g, '') // trim leading/trailing dots
      .slice(0, 80)
      .replace(/\.+$/, '') // re-trim if the slice cut mid-run
  );
}

// The id segment: `tt…:season:episode` for an episode, bare `tt…` for a
// movie. `videoId` (when present) already has the `id:season:episode`
// shape stremio uses, so it IS the episode id segment.
function idSegment(target: { id: string; videoId: string | null }): string {
  return target.videoId && target.videoId.includes(':') ? target.videoId : target.id;
}

// Build the short player path for a playback intent. The slug is optional
// and cosmetic; omit it entirely rather than emit a trailing slash.
export function buildPlayerPath(params: {
  source: PlayerSource;
  id: string;
  videoId?: string | null;
  title?: string | null;
}): string {
  // The id segment is always URL-safe (`tt\d+`, optionally `:season:episode`);
  // colons are legal in a path segment and the short URL keeps them literal
  // rather than %3A-encoding them, so it reads the way the user typed it.
  const seg = idSegment({ id: params.id, videoId: params.videoId ?? null });
  const slug = slugifyTitle(params.title);
  const base = `/player/${params.source}/${seg}`;
  return slug ? `${base}/${slug}` : base;
}

// Parse a short player path back into its playback intent, or null if the
// pathname isn't one (e.g. the legacy `/player?…` query form, which has no
// source segment). Tolerant of a trailing cosmetic slug and of a trailing
// slash. The id segment decides movie vs series: two colons (`tt…:s:e`) =
// an episode, otherwise a movie.
export function parsePlayerPath(pathname: string): PlayerTarget | null {
  const m = /^\/player\/(vidking|rd|auto)\/([^/]+)(?:\/.*)?$/.exec(pathname);
  if (!m) return null;
  const source = m[1] as PlayerSource;
  let seg: string;
  try {
    seg = decodeURIComponent(m[2]);
  } catch {
    seg = m[2];
  }
  // `tt2861424:9:1` → id=tt2861424, videoId=tt2861424:9:1, series.
  // `tt0137523`     → id=tt0137523, movie.
  const parts = seg.split(':');
  if (parts.length >= 3) {
    return { source, type: 'series', id: parts[0], videoId: seg };
  }
  return { source, type: 'movie', id: seg, videoId: null };
}
