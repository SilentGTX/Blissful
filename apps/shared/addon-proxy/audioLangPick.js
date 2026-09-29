'use strict';
// Pure helpers for choosing a /transcode audio track by language. Split out of
// server.js so they can be unit-tested without booting the proxy (same split as
// transcodeSrcResolution.js).
//
// The transcoder muxes exactly ONE audio track per stream. Without `&a=N` it takes
// the file's first track, which is English on most dual-audio anime releases, so
// the web player also sends `&alang=<iso639>` and lets the proxy choose on its
// first request instead of waiting for a client-side probe that can time out.

// Each group is one language: ISO 639-2/T, 639-2/B, 639-1, and the English name.
const LANGUAGE_GROUPS = [
  ['eng', 'en', 'english'],
  ['jpn', 'ja', 'jp', 'japanese'],
  ['spa', 'es', 'spanish', 'espanol', 'castellano'],
  ['fra', 'fre', 'fr', 'french', 'francais'],
  ['deu', 'ger', 'de', 'german', 'deutsch'],
  ['ita', 'it', 'italian', 'italiano'],
  ['por', 'pt', 'portuguese', 'portugues'],
  ['rus', 'ru', 'russian'],
  ['kor', 'ko', 'korean'],
  ['zho', 'chi', 'zh', 'chinese', 'mandarin', 'cantonese'],
  ['ara', 'ar', 'arabic'],
  ['hin', 'hi', 'hindi'],
  ['tur', 'tr', 'turkish'],
  ['pol', 'pl', 'polish'],
  ['nld', 'dut', 'nl', 'dutch'],
  ['bul', 'bg', 'bulgarian'],
  ['tha', 'th', 'thai'],
  ['vie', 'vi', 'vietnamese'],
  ['ind', 'id', 'indonesian'],
];

function canonicalLanguage(value) {
  const v = String(value == null ? '' : value).trim().toLowerCase().split(/[-_]/)[0];
  if (!v) return null;
  const group = LANGUAGE_GROUPS.find((g) => g.includes(v));
  return group ? group[0] : v;
}

// A track's title can name the language ("Japanese 5.1", "English - Dub") when the
// container tag is missing. Whole words only, so "Eng" does not match inside other words.
function titleNamesLanguage(title, canonical) {
  const group = LANGUAGE_GROUPS.find((g) => g[0] === canonical);
  if (!group || !title) return false;
  const words = String(title).toLowerCase().split(/[^a-zÀ-ɏ]+/).filter(Boolean);
  return group.some((name) => name.length > 3 && words.includes(name));
}

/** Case-insensitive read of an ffprobe tag (mkv writes LANGUAGE, mp4 writes language). */
function readStreamTag(tags, ...names) {
  if (!tags || typeof tags !== 'object') return null;
  const wanted = names.map((n) => n.toLowerCase());
  for (const key of Object.keys(tags)) {
    if (wanted.includes(key.toLowerCase()) && tags[key]) return String(tags[key]);
  }
  return null;
}

/**
 * Index (the audio-relative `i` of probeAudioTracks) of the track in `alang`, or
 * null when nothing matches so the caller keeps track 0. Tag match first; a track
 * with a generic tag (missing, und, blanket eng) falls back to its title. Among several matches the one with
 * the most channels wins, ties keep file order (the same rule as the web client's
 * pickPreferredAudioTrack, so the client never has to "correct" the proxy).
 */
function pickAudioByLanguage(tracks, alang) {
  const target = canonicalLanguage(alang);
  if (!target || !Array.isArray(tracks) || tracks.length === 0) return null;
  const best = (list) => {
    let top = list[0];
    for (const t of list.slice(1)) {
      if ((t.channels || 0) > (top.channels || 0)) top = t;
    }
    return top.i;
  };
  const byTag = tracks.filter((t) => canonicalLanguage(t.lang) === target);
  if (byTag.length > 0) return best(byTag);
  // Only a generic tag (missing, und, or a blanket eng) can be re-filed by title.
  const generic = (l) => !l || ['und', 'unknown', 'eng'].includes(canonicalLanguage(l));
  const byTitle = tracks.filter((t) => generic(t.lang) && titleNamesLanguage(t.title, target));
  return byTitle.length > 0 ? best(byTitle) : null;
}

module.exports = { pickAudioByLanguage, readStreamTag, canonicalLanguage };
