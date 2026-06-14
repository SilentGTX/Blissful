// Relevance filtering for addon torrent results.
//
// Comet (and other scraper addons) loose-match the meta title, so a search for
// a short/common title leaks unrelated torrents into the list:
//   - the show "From" returns "From Bureaucrat to Villainess", "Love from 9 to 5"
//     (any release whose name merely CONTAINS the word "from"), AND
//   - unrelated anime "S01E01" packs (Arifureta, LasDan) that share no title word
//     at all but matched on the episode marker.
// Torrentio doesn't do this; Comet does. This module decides whether a release
// name plausibly belongs to the requested title, with a bias toward KEEPING
// (over-inclusion is harmless; over-exclusion hides the real stream).

// Common English articles/prepositions/pronouns that are ALSO real one-word
// titles ("From", "It", "Us", "Them", "Her", "Up"). Only used to (a) decide
// whether a title is "all stopwords" — which needs the strict path — and (b)
// ignore these as "extra content" words. Keep this list conservative.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'at', 'for', 'with', 'from',
  'it', 'us', 'them', 'her', 'his', 'him', 'up', 'down', 'out', 'me', 'you',
  'we', 'i', 'is', 'as', 'by', 'or', 'no', 'so', 'go', 'into', 'this', 'that',
]);

// Tokens that may appear in a release's title region without making it a
// DIFFERENT title — region/country tags, edition/repack markers, etc. Used only
// in the strict (all-stopword title) path to allow "From.US.S01E01" through.
const METADATA_TOKENS = new Set([
  'us', 'uk', 'usa', 'au', 'ca', 'nz', 'proper', 'repack', 'internal',
  'extended', 'uncut', 'remastered', 'limited', 'unrated', 'dubbed', 'subbed',
  'multi', 'dual', 'audio',
]);

/** lowercase, de-accent, drop apostrophes, split on non-alphanumerics. */
export function normalizeTitleTokens(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['‘’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

const isNumericToken = (t: string): boolean => /^\d+$/.test(t);

// First token that marks the END of the title in a release name: season/episode
// (S01E01, S01, 1x01), a 4-digit year, a resolution, or a source/codec tag.
// Everything before it is the candidate "title region".
const TITLE_END_MARKER =
  /\b(s\d{1,2}e\d{1,3}|s\d{1,2}|\d{1,2}x\d{1,3}|(?:19|20)\d{2}|2160p|1080p|720p|480p|360p|4k|uhd|bluray|blu-ray|web-?dl|webrip|hdrip|brrip|bdrip|dvdrip|hdtv|x264|x265|h\.?264|h\.?265|hevc|avc|remux|complete|season)\b/i;

/**
 * Extract the leading "title" portion of a release name: strip leading bracket
 * / paren groups ("[GetItTwisted]", "(2024)"), then cut at the first
 * season/episode/year/quality marker.
 */
export function extractBananaTitleRegion(name: string): string {
  let s = name.replace(/^(?:\s*[\[(][^\])]*[\])]\s*)+/u, '');
  const m = s.match(TITLE_END_MARKER);
  if (m && typeof m.index === 'number' && m.index > 0) {
    s = s.slice(0, m.index);
  }
  return s.trim();
}

/**
 * True if `torrentName` plausibly belongs to `expectedTitle`.
 *
 *  - No expected title, or no parseable release name → KEEP (can't judge).
 *  - Title has content (non-stopword) words → the release name must contain
 *    ALL of them (set membership, order-free). Keeps franchise prefixes
 *    ("Marvels Daredevil" for "Daredevil") and abbreviations; drops unrelated
 *    shows. Slightly over-includes sequels — intentional (inclusion is safe).
 *  - All-stopword title ("From", "It", "Us") → the release's TITLE REGION must
 *    equal the title (ignoring region/edition metadata tokens). This is the
 *    only way to tell "From.S01E01" (keep) from "From Bureaucrat…" (drop).
 *  - Purely numeric title ("1917") → KEEP (too ambiguous to filter safely).
 */
export function isRelevantBanana(
  torrentName: string | null | undefined,
  expectedTitle: string | null | undefined,
): boolean {
  const expected = normalizeTitleTokens(expectedTitle);
  if (expected.length === 0) return true;
  if (!torrentName) return true;

  const content = expected.filter((t) => !STOPWORDS.has(t) && !isNumericToken(t));

  if (content.length >= 1) {
    // Expected title fully present in the release name — handles franchise
    // prefixes ("Marvels Daredevil" for "Daredevil") and extra tags.
    const whole = new Set(normalizeTitleTokens(torrentName));
    if (content.every((t) => whole.has(t))) return true;
    // …or the release's title region is a subset/abbreviation of the expected
    // title — handles dropped possessives ("Daredevil" for "Marvel's
    // Daredevil", "Legends of Tomorrow" for "DC's Legends of Tomorrow").
    const expectedSet = new Set(expected);
    const regionContent = normalizeTitleTokens(extractBananaTitleRegion(torrentName)).filter(
      (t) => !STOPWORDS.has(t) && !isNumericToken(t),
    );
    return regionContent.length >= 1 && regionContent.every((t) => expectedSet.has(t));
  }

  // All-stopword title. Bail out if it's numeric-flavoured (e.g. "1917").
  if (expected.some(isNumericToken)) return true;

  const region = normalizeTitleTokens(extractBananaTitleRegion(torrentName));
  if (region.length === 0) return true; // couldn't isolate a title region → keep
  const expectedSet = new Set(expected);
  const shared = region.filter((t) => expectedSet.has(t));
  const extra = region.filter((t) => !expectedSet.has(t) && !STOPWORDS.has(t) && !METADATA_TOKENS.has(t));
  return shared.length >= 1 && extra.length === 0;
}

/**
 * Drop releases that don't plausibly match `expectedTitle`. SAFETY: if the
 * filter would remove everything (parser miss, unusual naming), the original
 * list is returned unchanged — better to show loose results than an empty
 * picker. Releases are matched on `torrentName`, falling back to `name`.
 */
export function filterRelevantBananas<T extends { torrentName?: string | null; name?: string | null }>(
  releases: T[],
  expectedTitle: string | null | undefined,
): T[] {
  if (!expectedTitle || normalizeTitleTokens(expectedTitle).length === 0) return releases;
  const kept = releases.filter((r) => isRelevantBanana(r.torrentName ?? r.name ?? null, expectedTitle));
  return kept.length > 0 ? kept : releases;
}
