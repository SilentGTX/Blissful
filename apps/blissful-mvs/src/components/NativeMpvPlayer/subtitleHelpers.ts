// Shared helpers between NativeMpvPlayer and its extracted
// SubtitleMenuPopover. Lifted out so both files can read the same
// language → display-name table without one having to re-export it
// for the other (which would couple them in the wrong direction).

const LANG_LABELS: Record<string, string> = {
  en: 'English', eng: 'English',
  es: 'Spanish', spa: 'Spanish',
  fr: 'French', fra: 'French', fre: 'French',
  it: 'Italian', ita: 'Italian',
  pt: 'Portuguese', por: 'Portuguese', ptbr: 'Portuguese (BR)',
  de: 'German', deu: 'German', ger: 'German',
  nl: 'Dutch', nld: 'Dutch', dut: 'Dutch',
  ru: 'Russian', rus: 'Russian',
  pl: 'Polish', pol: 'Polish',
  tr: 'Turkish', tur: 'Turkish',
  ar: 'Arabic', ara: 'Arabic',
  hi: 'Hindi', hin: 'Hindi',
  ja: 'Japanese', jpn: 'Japanese',
  ko: 'Korean', kor: 'Korean',
  zh: 'Chinese', zho: 'Chinese', chi: 'Chinese',
  uk: 'Ukrainian', ukr: 'Ukrainian',
};

/** Map a raw `lang` (BCP-47 or ISO-639 alpha-2/3) to a display label. */
export function subtitleLangLabel(lang: string): string {
  const l = lang.trim().toLowerCase();
  if (!l) return 'Unknown';
  if (LANG_LABELS[l]) return LANG_LABELS[l];
  return l.length <= 4 ? l.toUpperCase() : l;
}
