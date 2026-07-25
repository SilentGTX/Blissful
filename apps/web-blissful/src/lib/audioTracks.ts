// Audio-track preference for TRANSCODED streams (the House RD path).
//
// The transcoder muxes exactly ONE audio track per stream, chosen by `&a=N` on
// the /transcode.m3u8 URL — so nothing downstream (hls.js, the <video> element)
// can honour the user's language preference the way it does for a multi-audio
// HLS ladder. This module picks the index the player should ask for.

import { languageMatch } from './subtitleUtils';

/** One entry from the proxy's `/transcode-audio` ffprobe result. */
export type ProbedAudioTrack = {
  i: number;
  lang: string | null;
  title: string | null;
  channels: number | null;
  codec: string | null;
};

/**
 * Index of the audio track matching `pref` (an ISO 639 code as stored by
 * profile settings, e.g. `eng`), or `null` when nothing matches — the caller
 * then keeps whatever it already had (usually track 0, the file's default).
 *
 * Matching is delegated to `languageMatch`, so a stored `eng` also matches
 * container tags like `en`, `en-US` and `english`. Only the `lang` tag is
 * consulted: release titles use scene shorthand ("VO", "VFF", "VFQ") that
 * looks like a language but isn't a code, and guessing from it would pick the
 * wrong track with false confidence.
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
  const matches = tracks.filter((t) => languageMatch(target, t.lang));
  if (matches.length === 0) return null;
  let best = matches[0];
  for (const t of matches.slice(1)) {
    if ((t.channels ?? 0) > (best.channels ?? 0)) best = t;
  }
  return best.i;
}
