// Shared helpers between NativeMpvPlayer and its extracted
// SubtitleMenuPopover. Lifted out so both files can read the same
// language → display-name table without one having to re-export it
// for the other (which would couple them in the wrong direction).

/** Map a raw `lang` (BCP-47 or ISO-639 alpha-2/3) to a display label.
 *  Matches the full table in OpenCode's lib/subtitleUtils.ts so every
 *  language code mpv reports (or addons return) resolves to a proper
 *  name instead of a raw locale code. */
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
  return l.length <= 4 ? l.toUpperCase() : l.charAt(0).toUpperCase() + l.slice(1);
}
