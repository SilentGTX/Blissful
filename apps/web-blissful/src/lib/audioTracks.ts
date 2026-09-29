// Audio-track preference for TRANSCODED streams (the House RD path).
//
// The transcoder muxes exactly ONE audio track per stream, chosen by `&a=N` on
// the /transcode.m3u8 URL — so nothing downstream (hls.js, the <video> element)
// can honour the user's language preference the way it does for a multi-audio
// HLS ladder. This module picks the index the player should ask for.

import { languageFromTitle, languageMatch } from './subtitleUtils';

/** One entry from the proxy's `/transcode-audio` ffprobe result. */
export type ProbedAudioTrack = {
  i: number;
  lang: string | null;
  title: string | null;
  channels: number | null;
  codec: string | null;
};

// Tags a fansub mux leaves on tracks it never labelled properly: missing, `und`,
// or a blanket `eng` on every track. Only these can be re-filed by their title.
function hasGenericTag(lang: string | null): boolean {
  const l = (lang ?? '').trim().toLowerCase();
  return l === '' || l === 'und' || l === 'unknown' || l === 'eng' || l === 'en';
}

/**
 * Index of the audio track matching `pref` (an ISO 639 code as stored by
 * profile settings, e.g. `eng`), or `null` when nothing matches — the caller
 * then keeps whatever it already had (usually track 0, the file's default).
 *
 * Matching is delegated to `languageMatch`, so a stored `eng` also matches
 * container tags like `en`, `en-US` and `english`. The `lang` tag is consulted
 * first. Only when NO track's tag matches does the title get a say, and only for
 * a track whose tag is generic (missing, `und`, or a blanket `eng`): a track with
 * no tag titled "Japanese" is found that way. A specifically tagged track is never
 * re-filed by its title, and release titles use scene shorthand ("VO", "VFF",
 * "VFQ") that looks like a language but isn't one, so only language names count.
 *
 * Among several matches the one with the most channels wins (a 5.1 mix beats
 * a stereo commentary-style downmix of the same language); ties keep file
 * order so the result is stable.
 */
export function pickPreferredAudioTrack(
  tracks: ProbedAudioTrack[],
  pref: string | null | undefined,
): number | null {
  const target = (pref ?? '').trim();
  if (!target || tracks.length === 0) return null;
  let matches = tracks.filter((t) => languageMatch(target, t.lang));
  if (matches.length === 0) {
    matches = tracks.filter((t) => hasGenericTag(t.lang) && languageMatch(target, languageFromTitle(t.title)));
  }
  if (matches.length === 0) return null;
  let best = matches[0];
  for (const t of matches.slice(1)) {
    if ((t.channels ?? 0) > (best.channels ?? 0)) best = t;
  }
  return best.i;
}
