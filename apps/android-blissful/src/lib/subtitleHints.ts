// Subtitle hints read off a release NAME — no network, no Real-Debrid resolve,
// no ffprobe.
//
// MIRROR of apps/web-blissful/src/lib/subtitleHints.ts — keep the two in step.
// The web copy is canonical and carries the unit tests
// (apps/web-blissful/src/lib/subtitleHints.test.ts, which is where the
// false-positive cases live: Submarine, Multiplicity, Suburbicon, Subservience,
// The Substitute). This app has no unit-test runner, so any rule change belongs
// there first, with a test, and is copied here after.
//
// WHY A GUESS AND NOT THE TRUTH: subtitle tracks live inside the container, so
// knowing for certain means resolving the RD link and running ffprobe on the
// file. One probe is ~800ms and a handful of RD API calls (addMagnet → poll →
// selectFiles → delete), and the picker shows 20-50 releases. That budget is
// shared with PLAYBACK: the proxy already rate-limits /rd-by-hash to 20/min per
// IP and 4 concurrent for this reason, and a re-resolve storm has thrown RD into
// throttling before (73966e8 — "the segments kept failing for a different reason
// than they started"). A wrong badge costs nothing; a throttled account costs the
// episode. So this reads the name and says so.
//
// The badge text always names the SIGNAL, never a conclusion: a release tagged
// MULTI is reported as MULTI, not as "has subtitles", because in scene naming
// MULTI denotes multiple AUDIO tracks — it correlates with subtitles but does not
// promise them.

export type SubtitleHintKind =
  /** An explicit subtitle tag — SUBS, MULTISUB, ESUB, VOSTFR, a known softsub group. */
  | 'subs'
  /** Multiple audio languages (MULTI, DUAL AUDIO). Often subtitled too, not a promise. */
  | 'multi'
  /** Burned into the picture (HARDSUB). Always visible, never selectable or styleable. */
  | 'hardcoded';

export type SubtitleHint = {
  kind: SubtitleHintKind;
  /** Short badge text. */
  label: string;
  /** The token that matched, for the row's tooltip — so the guess is inspectable. */
  marker: string;
};

// Release names separate tokens with dots, underscores, brackets and dashes.
// Normalise them all to spaces so one set of word-boundary rules works, and
// collapse runs so "Show.S01E02.1080p.MULTi.WEB-DL" tokenises cleanly.
function normalize(s: string): string {
  return ` ${s.toLowerCase().replace(/[._\-[\]()/+,]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/** Matches `token` as a whole word inside an already-normalised haystack. */
function hasToken(hay: string, token: string): boolean {
  return hay.includes(` ${token} `);
}

// Ordered most-specific first: the first match wins, so MULTISUB is reported as
// multi-subs rather than being swallowed by the bare MULTI rule below it.
const SUB_RULES: Array<{ label: string; tokens: string[]; glued?: RegExp }> = [
  { label: 'Multi-subs', tokens: ['multisub', 'multisubs', 'multi sub', 'multi subs', 'msub', 'msubs', 'multi subtitles'] },
  { label: 'EN subs', tokens: ['esub', 'esubs', 'engsub', 'engsubs', 'eng sub', 'eng subs', 'en sub', 'en subs', 'english subs', 'english subtitles'] },
  { label: 'FR subs', tokens: ['vostfr', 'subfrench', 'sub french', 'vof'] },
  { label: 'IT subs', tokens: ['subita', 'sub ita', 'subs ita'] },
  { label: 'ES subs', tokens: ['subspa', 'sub esp', 'subesp', 'subtitulado'] },
  { label: 'DE subs', tokens: ['subger', 'sub ger', 'subbed ger'] },
  { label: 'SDH', tokens: ['sdh'] },
  // Generic, last: any explicit mention of subtitles.
  { label: 'Subs', tokens: ['subbed', 'subs', 'subtitled', 'subtitles', 'softsub', 'softsubs', 'sub pack', 'subpack', 'vostsub'] },
];

const HARDCODED_TOKENS = ['hardsub', 'hardsubs', 'hardcoded', 'hc sub', 'hcsub', 'hard sub', 'hard subs'];

// Multiple AUDIO languages. Deliberately separate from the subtitle rules.
const MULTI_TOKENS = ['multi', 'multi audio', 'dual audio', 'dualaudio', 'dual'];

// Fansub groups that softsub as a matter of course, so their name IS the signal.
// Erai-raws in particular ships a multi-language subtitle pack. Matched as a
// substring because the group tag is bracketed and may carry a suffix.
const SOFTSUB_GROUPS: Array<{ needle: string; label: string }> = [
  { needle: 'erai raws', label: 'Multi-subs' },
  { needle: 'erai-raws', label: 'Multi-subs' },
  { needle: 'subsplease', label: 'Subs' },
  { needle: 'horriblesubs', label: 'Subs' },
  { needle: 'judas', label: 'Subs' },
  { needle: 'ember', label: 'Subs' },
  { needle: 'asw', label: 'Subs' },
  { needle: 'nyanpasu', label: 'Subs' },
  { needle: 'anime time', label: 'Subs' },
];

/**
 * Best subtitle hint across every name we hold for a release (the addon's
 * display name and the torrent filename usually differ, and either may carry
 * the tag). Returns null when nothing matched — which means "unknown", NOT
 * "no subtitles".
 */
export function detectSubtitleHint(...names: Array<string | null | undefined>): SubtitleHint | null {
  const hay = normalize(names.filter(Boolean).join(' '));
  if (hay.trim() === '') return null;

  // Hardcoded first: it is a subtitle tag too, and "HARDSUB" contains "sub", so
  // checking it before the generic rule stops it being mislabelled as soft subs.
  for (const t of HARDCODED_TOKENS) {
    if (hasToken(hay, t)) return { kind: 'hardcoded', label: 'Hardsub', marker: t };
  }
  for (const rule of SUB_RULES) {
    for (const t of rule.tokens) {
      if (hasToken(hay, t)) return { kind: 'subs', label: rule.label, marker: t };
    }
  }
  for (const g of SOFTSUB_GROUPS) {
    if (hay.includes(g.needle)) return { kind: 'subs', label: g.label, marker: g.needle };
  }
  for (const t of MULTI_TOKENS) {
    if (hasToken(hay, t)) return { kind: 'multi', label: 'Multi', marker: t };
  }
  return null;
}

/**
 * Sort tier for the picker: lower sorts first.
 *
 * Explicit subtitle tags lead, then multi-audio, then everything unknown.
 * Hardcoded ranks WITH the unknowns rather than being promoted: burned-in
 * subtitles can't be turned off or restyled, so surfacing them is useful but
 * pushing them up the list is not. Unknown is never treated as "no subtitles" —
 * most releases simply don't say.
 */
export function subtitleHintRank(hint: SubtitleHint | null): number {
  if (!hint) return 2;
  if (hint.kind === 'subs') return 0;
  if (hint.kind === 'multi') return 1;
  return 2; // hardcoded
}
