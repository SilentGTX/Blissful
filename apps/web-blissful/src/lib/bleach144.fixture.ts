// Bleach (kitsu:244) episode 144, as seen on Ivan's profile in BUD-44.
//
// Stream names, titles and file names are the real Torrentio rows (fetched from
// torrentio.strem.fun/stream/series/kitsu:244:144.json), prefixed [RD+] the way a
// cached row arrives. The Anime Time probe is the real ffprobe result reported in
// BUD-44: 1080p HEVC 10-bit, eng (default) + jpn AAC, 9 subs (2 ASS eng + 7 SRT
// incl. eng SDH). The Judas pack probe could NOT be taken here (it needs Ivan's
// Real-Debrid key to resolve the file); its values are assumed from its name
// ("Dual-Audio", "Eng-Sub"): eng + jpn audio, two eng ASS subs, 1080p. Its hash is
// the real 9bb3fa7c prefix padded. Its file name is written with an SxxEyy marker so
// its episode score (4000) is higher than Anime Time's (3000), the situation the
// probe has to overcome; the real file name is not known here.

import type { ReleaseCandidate, ReleaseProbe } from './releaseRanking';
import type { ExpectedEpisode } from './episodeMatch';

export const ANIME_TIME_HASH = '1e9032d2aa7701f86535f5093bbdf5fdc3a4fb88';
export const JUDAS_HASH = '9bb3fa7c00000000000000000000000000000000';
export const ERAI_HASH = '090ca6a1'.padEnd(40, '0');
export const ANIMERG_HASH = '0295ba04'.padEnd(40, '0');
export const OTHER_EP_HASH = '3b3b3b3b'.padEnd(40, '0');

export type Bleach144Stream = { name: string; title: string; url: string; infoHash: string };

const stream = (name: string, title: string, hash: string): Bleach144Stream => ({
  name,
  title,
  infoHash: hash,
  url: `https://torrentio.strem.fun/resolve/realdebrid/KEY/${hash}/null/0/f.mkv`,
});

export const ANIME_TIME = stream(
  '[RD+] Torrentio\n1080p',
  '[Anime Time] Bleach Complete Series + Movies [Disney+ BD][1080p][HEVC 10bit x265][AAC AC3] Dual Audio][Multi Subs] [Batch]\n'
    + 'Season 7 - The Arrancar - The Hueco Mundo Sneak Entry/Bleach - 144 - Ishida Chad, The Quickening Of A New Power.mkv',
  ANIME_TIME_HASH,
);
export const JUDAS = stream(
  '[RD+] Torrentio\n1080p',
  'Bleach Complete Pack (Anime + Manga + Novel)\n[Judas] Bleach S01E144.mkv',
  JUDAS_HASH,
);
export const ERAI = stream(
  '[RD+] Torrentio\n1080p',
  '[Erai-raws] Bleach - 001 ~ 366 [1080p DSNP WEB-DL AVC AAC][MultiSub]\n[Erai-raws] Bleach - 144 [1080p DSNP WEB-DL AVC AAC][MultiSub][06778DE].mkv',
  ERAI_HASH,
);
export const ANIMERG_480 = stream(
  '[RD+] Torrentio\n480p',
  '[AnimeRG] Bleach (Complete Series) EP 001-366 [480p] [Dual-Audio] [Batch]\nSeason 07 (The Arrancar Part 2)/[AnimeRG] Bleach - 144 - Ishida and Chad.mkv',
  ANIMERG_HASH,
);
// Names another episode (S07E20) in its own text: must sink whatever it probes as.
export const WRONG_EPISODE = stream(
  '[RD+] Torrentio\n1080p',
  '[Group] Bleach S07E20 [1080p][BD][Dual-Audio]\nBleach.S07E20.1080p.mkv',
  OTHER_EP_HASH,
);

export const EXPECTED_144: ExpectedEpisode = { season: 1, episode: 144, absolute: 144, title: null };

export const describeBleach = (s: Bleach144Stream): ReleaseCandidate => ({
  name: s.name,
  title: s.title,
  url: s.url,
  infohash: s.infoHash,
});

export const ANIME_TIME_PROBE: ReleaseProbe = {
  audio: [{ lang: 'eng', title: null }, { lang: 'jpn', title: null }],
  subs: [
    { lang: 'eng', title: 'English', textBased: true },
    { lang: 'eng', title: 'Signs & Songs', textBased: true },
    { lang: 'eng', title: 'English [SDH]', textBased: true },
    { lang: 'spa', title: null, textBased: true },
    { lang: 'por', title: null, textBased: true },
    { lang: 'fre', title: null, textBased: true },
    { lang: 'ger', title: null, textBased: true },
    { lang: 'ita', title: null, textBased: true },
    { lang: 'rus', title: null, textBased: true },
  ],
  height: 1080,
};

export const JUDAS_PROBE: ReleaseProbe = {
  audio: [{ lang: 'eng', title: null }, { lang: 'jpn', title: null }],
  subs: [
    { lang: 'eng', title: 'English', textBased: true },
    { lang: 'eng', title: 'Signs & Songs', textBased: true },
  ],
  height: 1080,
};

/** What each release's /probe-streams + /transcode-audio answers look like on the wire. */
export const PROBE_BY_HASH: Record<string, ReleaseProbe> = {
  [ANIME_TIME_HASH]: ANIME_TIME_PROBE,
  [JUDAS_HASH]: JUDAS_PROBE,
};
