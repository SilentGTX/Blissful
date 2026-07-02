// Subtitle helpers shared by BlissfulPlayer and NativeMpvPlayer. Both
// players need to: convert SRT→VTT, time-shift cues, fetch + blob-
// cache the result, canonicalize language codes/names, score tracks
// for auto-pick, and re-layout VTT cues to a custom line position.
// Previously each helper was duplicated across both players (and
// drifted: NativeMpvPlayer's `scoreSubtitleTrack` was missing the
// embedded-origin bonus that BlissfulPlayer applied).

export type SubtitleTrack = {
  key: string;
  lang: string;
  label: string;
  origin: string;
  url: string;
};

// ── SRT/VTT parse + transform ──────────────────────────────────────────

export function srtToVtt(input: string): string {
  const normalized = input.replace(/\r+/g, '').trim();
  const withDots = normalized.replace(/(\d\d:\d\d:\d\d),(\d\d\d)/g, '$1.$2');
  return `WEBVTT\n\n${withDots}\n`;
}

export function looksLikeSrt(text: string): boolean {
  return /(\d\d:\d\d:\d\d,\d\d\d)\s*-->\s*(\d\d:\d\d:\d\d,\d\d\d)/.test(text);
}

export function shiftVtt(text: string, delaySeconds: number): string {
  if (!delaySeconds) return text;
  const toSeconds = (value: string) => {
    const [h, m, rest] = value.split(':');
    const [s, ms] = rest.split('.');
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
  };
  const toTimestamp = (value: number) => {
    const clamped = Math.max(0, value);
    const h = Math.floor(clamped / 3600);
    const m = Math.floor((clamped % 3600) / 60);
    const s = Math.floor(clamped % 60);
    const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  };
  return text.replace(/(\d\d:\d\d:\d\d\.\d\d\d)\s*-->\s*(\d\d:\d\d:\d\d\.\d\d\d)/g, (_m, a, b) => {
    const start = toTimestamp(toSeconds(a) + delaySeconds);
    const end = toTimestamp(toSeconds(b) + delaySeconds);
    return `${start} --> ${end}`;
  });
}

export async function fetchSubtitleVttBlobUrl(url: string, delaySeconds: number): Promise<string> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Subtitle fetch failed: ${resp.status}`);
  const text = await resp.text();
  const base = text.trim().startsWith('WEBVTT') ? text : looksLikeSrt(text) ? srtToVtt(text) : text;
  const body = delaySeconds ? shiftVtt(base, delaySeconds) : base;
  const blob = new Blob([body], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
}

// ── Blob URL cache ─────────────────────────────────────────────────────
// Session-scoped cache, keyed by the upstream URL → blob URL. Lives on
// `globalThis` so multiple <video> mounts (quality swaps, episode hops)
// reuse the same blob instead of re-fetching the same subtitle file.

export function isCachedSubtitleBlobUrl(url: string): boolean {
  try {
    const cache: Map<string, string> | undefined = (globalThis as { __bliss_subtitle_blob_cache?: Map<string, string> }).__bliss_subtitle_blob_cache;
    if (!cache) return false;
    return Array.from(cache.values()).includes(url);
  } catch {
    return false;
  }
}

export function scheduleRevokeSubtitleBlobUrl(url: string): void {
  if (isCachedSubtitleBlobUrl(url)) return;
  window.setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // ignore
    }
  }, 500);
}

// ── TextTrack layout (applies to the <video>'s native subtitle track) ──
// Browsers default VTT cues to snapToLines=true + line=auto, which
// pins them near the bottom edge. We move them up so they sit above
// the player's bottom controls. `applySubtitleLayout` re-creates all
// cues with the new position; `applySubtitlePositionActive` mutates
// only the currently-visible cues (cheaper for live position tweaks).

export function applySubtitleLayout(track: TextTrack, position: number): void {
  const cues = track.cues ? Array.from(track.cues) : [];
  for (const cue of cues) {
    try {
      const text = (cue as VTTCue).text ?? (cue as { text?: string }).text ?? '';
      const next = new VTTCue(cue.startTime, cue.endTime, text);
      next.id = cue.id;
      next.snapToLines = false;
      next.line = position;
      next.lineAlign = 'center';
      next.position = 50;
      next.positionAlign = 'center';
      next.size = 100;
      next.align = 'center';
      track.removeCue(cue);
      track.addCue(next);
    } catch {
      // ignore
    }
  }
  try {
    track.mode = 'disabled';
    track.mode = 'showing';
  } catch {
    // ignore
  }
}

export function applySubtitlePositionActive(track: TextTrack, position: number): void {
  const active = track.activeCues ? Array.from(track.activeCues) : [];
  for (const cue of active) {
    try {
      if (cue instanceof VTTCue) {
        cue.snapToLines = false;
        cue.line = position;
        cue.lineAlign = 'center';
        cue.position = 50;
        cue.positionAlign = 'center';
        cue.size = 100;
        cue.align = 'center';
      }
    } catch {
      // ignore
    }
  }
}

// ── Language canonicalization ──────────────────────────────────────────
// Each language has every 2-letter (ISO 639-1), 3-letter (639-2/T and
// 639-2/B), and full English name spelling folded onto the same
// canonical label, so addon-provided lang codes ("ger", "alb") and
// Videasy's display names ("German", "Albanian") dedupe into a single
// row in the picker.

export function subtitleLangLabel(lang: string): string {
  const l = lang.trim().toLowerCase();
  if (!l) return 'Unknown';
  if (l === 'local') return 'Local';
  const map: Record<string, string> = {
    en: 'English', eng: 'English', english: 'English',
    es: 'Spanish', spa: 'Spanish', spanish: 'Spanish',
    fr: 'French', fra: 'French', fre: 'French', french: 'French',
    it: 'Italian', ita: 'Italian', italian: 'Italian',
    pt: 'Portuguese', por: 'Portuguese', portuguese: 'Portuguese',
    ptbr: 'Portuguese (BR)', 'pt-br': 'Portuguese (BR)',
    de: 'German', deu: 'German', ger: 'German', german: 'German',
    nl: 'Dutch', nld: 'Dutch', dut: 'Dutch', dutch: 'Dutch',
    ru: 'Russian', rus: 'Russian', russian: 'Russian',
    pl: 'Polish', pol: 'Polish', polish: 'Polish',
    tr: 'Turkish', tur: 'Turkish', turkish: 'Turkish',
    ar: 'Arabic', ara: 'Arabic', arabic: 'Arabic',
    hi: 'Hindi', hin: 'Hindi', hindi: 'Hindi',
    ja: 'Japanese', jpn: 'Japanese', japanese: 'Japanese',
    ko: 'Korean', kor: 'Korean', korean: 'Korean',
    zh: 'Chinese', zho: 'Chinese', chi: 'Chinese', chinese: 'Chinese',
    uk: 'Ukrainian', ukr: 'Ukrainian', ukrainian: 'Ukrainian',
    sq: 'Albanian', alb: 'Albanian', sqi: 'Albanian', albanian: 'Albanian',
    bg: 'Bulgarian', bul: 'Bulgarian', bulgarian: 'Bulgarian',
    cs: 'Czech', ces: 'Czech', cze: 'Czech', czech: 'Czech',
    da: 'Danish', dan: 'Danish', danish: 'Danish',
    fi: 'Finnish', fin: 'Finnish', finnish: 'Finnish',
    el: 'Greek', gre: 'Greek', ell: 'Greek', greek: 'Greek',
    he: 'Hebrew', heb: 'Hebrew', hebrew: 'Hebrew',
    hu: 'Hungarian', hun: 'Hungarian', hungarian: 'Hungarian',
    id: 'Indonesian', ind: 'Indonesian', indonesian: 'Indonesian',
    no: 'Norwegian', nor: 'Norwegian', nob: 'Norwegian', norwegian: 'Norwegian',
    ro: 'Romanian', ron: 'Romanian', rum: 'Romanian', romanian: 'Romanian',
    sv: 'Swedish', swe: 'Swedish', swedish: 'Swedish',
    th: 'Thai', tha: 'Thai', thai: 'Thai',
    vi: 'Vietnamese', vie: 'Vietnamese', vietnamese: 'Vietnamese',
    sr: 'Serbian', srp: 'Serbian', serbian: 'Serbian',
    hr: 'Croatian', hrv: 'Croatian', croatian: 'Croatian',
    sk: 'Slovak', slk: 'Slovak', slo: 'Slovak', slovak: 'Slovak',
    sl: 'Slovenian', slv: 'Slovenian', slovenian: 'Slovenian',
    et: 'Estonian', est: 'Estonian', estonian: 'Estonian',
    lv: 'Latvian', lav: 'Latvian', latvian: 'Latvian',
    lt: 'Lithuanian', lit: 'Lithuanian', lithuanian: 'Lithuanian',
    fa: 'Persian', per: 'Persian', fas: 'Persian', persian: 'Persian', farsi: 'Persian',
    ms: 'Malay', msa: 'Malay', may: 'Malay', malay: 'Malay',
    tl: 'Tagalog', tgl: 'Tagalog', fil: 'Filipino', filipino: 'Filipino', tagalog: 'Tagalog',
    bn: 'Bengali', ben: 'Bengali', bengali: 'Bengali',
    ta: 'Tamil', tam: 'Tamil', tamil: 'Tamil',
    te: 'Telugu', tel: 'Telugu', telugu: 'Telugu',
    ml: 'Malayalam', mal: 'Malayalam', malayalam: 'Malayalam',
  };
  if (map[l]) return map[l];
  // BCP-47 tags (mpv reports the MKV's IETF tag verbatim): fold region and
  // script variants onto the base language so an embedded "en-US" track
  // lands in the same row as addon subs tagged "eng". Multi-part tags the
  // map knows explicitly (pt-br) matched above, before the strip.
  const primary = l.split(/[-_]/, 1)[0];
  if (primary !== l && map[primary]) return map[primary];
  return l.length <= 4 ? l.toUpperCase() : l.charAt(0).toUpperCase() + l.slice(1);
}

export function langPriority(lang: string): number {
  const l = lang.trim().toLowerCase();
  if (l === 'local') return 2;
  if (subtitleLangLabel(l) === 'English') return 1;
  return 0;
}

const LANGUAGE_ALIASES: Record<string, string[]> = {
  en: ['en', 'eng'],
  eng: ['en', 'eng'],
  es: ['es', 'spa'],
  spa: ['es', 'spa'],
  fr: ['fr', 'fre', 'fra'],
  fre: ['fr', 'fre', 'fra'],
  fra: ['fr', 'fre', 'fra'],
  de: ['de', 'ger', 'deu'],
  ger: ['de', 'ger', 'deu'],
  deu: ['de', 'ger', 'deu'],
  it: ['it', 'ita'],
  ita: ['it', 'ita'],
  pt: ['pt', 'por', 'pob', 'ptbr'],
  por: ['pt', 'por', 'pob', 'ptbr'],
  pob: ['pt', 'por', 'pob', 'ptbr'],
  ptbr: ['pt', 'por', 'pob', 'ptbr'],
  ru: ['ru', 'rus'],
  rus: ['ru', 'rus'],
  uk: ['uk', 'ukr'],
  ukr: ['uk', 'ukr'],
  zh: ['zh', 'zho', 'chi'],
  zho: ['zh', 'zho', 'chi'],
  chi: ['zh', 'zho', 'chi'],
  ja: ['ja', 'jpn'],
  jpn: ['ja', 'jpn'],
  ko: ['ko', 'kor'],
  kor: ['ko', 'kor'],
  ar: ['ar', 'ara'],
  ara: ['ar', 'ara'],
  hi: ['hi', 'hin'],
  hin: ['hi', 'hin'],
  tr: ['tr', 'tur'],
  tur: ['tr', 'tur'],
  pl: ['pl', 'pol'],
  pol: ['pl', 'pol'],
  nl: ['nl', 'nld', 'dut'],
  nld: ['nl', 'nld', 'dut'],
  dut: ['nl', 'nld', 'dut'],
  sv: ['sv', 'swe'],
  swe: ['sv', 'swe'],
  no: ['no', 'nor', 'nob', 'nno'],
  nor: ['no', 'nor', 'nob', 'nno'],
  nob: ['no', 'nor', 'nob', 'nno'],
  nno: ['no', 'nor', 'nob', 'nno'],
  da: ['da', 'dan'],
  dan: ['da', 'dan'],
  fi: ['fi', 'fin'],
  fin: ['fi', 'fin'],
  he: ['he', 'heb'],
  heb: ['he', 'heb'],
  el: ['el', 'ell'],
  ell: ['el', 'ell'],
  ro: ['ro', 'ron'],
  ron: ['ro', 'ron'],
  cs: ['cs', 'ces', 'cze'],
  ces: ['cs', 'ces', 'cze'],
  cze: ['cs', 'ces', 'cze'],
  hu: ['hu', 'hun'],
  hun: ['hu', 'hun'],
};

export function languageMatch(target: string | null, candidate: string | null): boolean {
  if (!target || !candidate) return false;
  const t = target.trim().toLowerCase();
  const c = candidate.trim().toLowerCase();
  if (!t || !c) return false;
  if (t === c) return true;
  const aliases = LANGUAGE_ALIASES[t] ?? [t];
  if (aliases.includes(c)) return true;
  // BCP-47 region tags (en-us) aren't in the alias table — canonical-label
  // equality lets a plain-code preference ("eng") match an embedded
  // IETF-tagged track ("en-US").
  return subtitleLangLabel(t) === subtitleLangLabel(c);
}

export function findMatchingLanguage<T extends { lang: string }>(list: T[], target: string | null): string | null {
  if (!target) return null;
  const match = list.find((t) => languageMatch(target, t.lang));
  return match?.lang ?? null;
}

export function isEmbeddedOrigin(origin: string): boolean {
  const o = origin.toLowerCase();
  return o === 'embedded' || o === 'built-in';
}

// Auto-pick scoring. Embedded/built-in tracks ship with the stream so
// they're always perfectly synced and add no extra fetch — they win
// over any addon-fetched variant. After that, OpenSubtitles and
// addons named "subtitles" rank above unknown sources, and VTT beats
// SRT (no parse step needed). Generic enough that both players can
// share it: takes the minimum SubtitleTrack shape, ignores any extra
// fields the caller adds (e.g. NativeMpvPlayer's `rating`).
export function scoreSubtitleTrack(t: { origin: string; url: string }): number {
  const origin = t.origin.toLowerCase();
  const url = t.url.toLowerCase();
  let score = 0;
  if (isEmbeddedOrigin(origin)) score += 100;
  if (origin.includes('opensubtitles')) score += 50;
  if (origin.includes('subtitles')) score += 20;
  if (url.endsWith('.vtt')) score += 10;
  if (url.endsWith('.srt')) score += 5;
  return score;
}
