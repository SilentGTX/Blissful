import { describe, it, expect } from 'vitest';
import {
  compareProbeScores,
  computeRankInfos,
  rankReleases,
  scoreProbedRelease,
  type ReleaseCandidate,
  type RankContext,
} from './releaseRanking';
import type { ExpectedEpisode } from './episodeMatch';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);
const HASH_C = 'c'.repeat(40);

type Rel = { name: string; title?: string; url: string };
const describeRel = (r: Rel): ReleaseCandidate => ({ name: r.name, title: r.title, url: r.url });
const rel = (name: string, hash: string, title = ''): Rel => ({ name, title, url: `https://x/${hash}/f.mkv` });
const rank = (items: Rel[], ctx: RankContext = {}) => rankReleases(items, describeRel, ctx).map((r) => r.name);

const EP2: ExpectedEpisode = { season: 1, episode: 2, absolute: 2, title: null };

describe('rankReleases', () => {
  it('never lets an uncached release beat a cached one', () => {
    const out = rank(
      [rel('[RD download] Show 1080p', HASH_A), rel('[RD+] Show 480p x265', HASH_B)],
      { rememberedInfohash: HASH_A, savedInfohash: HASH_A },
    );
    expect(out[0]).toBe('[RD+] Show 480p x265');
  });

  it('ranks cached above unknown above uncached', () => {
    const out = rank([
      rel('[RD download] Show 1080p', HASH_A),
      rel('[RD⚡] Show 1080p', HASH_B),
      rel('[RD+] Show 1080p', HASH_C),
    ]);
    expect(out).toEqual(['[RD+] Show 1080p', '[RD⚡] Show 1080p', '[RD download] Show 1080p']);
  });

  it('puts the remembered cached pack first, over better quality', () => {
    const out = rank(
      [rel('[RD+] Show S01E02 1080p', HASH_A), rel('[RD+] Anime Time Pack 720p', HASH_B)],
      { rememberedInfohash: HASH_B },
    );
    expect(out[0]).toBe('[RD+] Anime Time Pack 720p');
  });

  it('does not promote an uncached remembered pack', () => {
    const out = rank(
      [rel('[RD+] Show 1080p', HASH_A), rel('[RD download] Pack 1080p', HASH_B)],
      { rememberedInfohash: HASH_B },
    );
    expect(out[0]).toBe('[RD+] Show 1080p');
  });

  it('drops a remembered pack that contradicts the episode below one that matches', () => {
    const out = rank(
      [
        rel('[RD+] Show S17 E01-E13 S17E02', HASH_A),
        rel('[RD+] Show S01E02 1080p', HASH_B),
      ],
      { rememberedInfohash: HASH_A, expected: EP2 },
    );
    expect(out[0]).toBe('[RD+] Show S01E02 1080p');
  });

  it('prefers the release last played for this episode, before probe and quality', () => {
    const out = rank(
      [rel('[RD+] Show 1080p', HASH_A), rel('[RD+] Show 720p', HASH_B)],
      { savedInfohash: HASH_B },
    );
    expect(out[0]).toBe('[RD+] Show 720p');
  });

  it('orders by probe score before codec and quality', () => {
    const a = rel('[RD+] Show 1080p', HASH_A);
    const b = rel('[RD+] Show 720p x265', HASH_B);
    const out = rankReleases([a, b], describeRel, {
      probeScores: new Map([[b.url, [1, 0, 0, 0, 0, 0]]]),
    });
    expect(out[0]).toBe(b);
  });

  it('uses codec only as a late tiebreak: non-HEVC first, HEVC kept', () => {
    const out = rank([rel('[RD+] Show 1080p x265', HASH_A), rel('[RD+] Show 1080p', HASH_B)]);
    expect(out).toEqual(['[RD+] Show 1080p', '[RD+] Show 1080p x265']);
    // codec sits above quality in the order, but below every earlier rule
    expect(rank([rel('[RD+] Show 1080p x265', HASH_A), rel('[RD download] Show 480p', HASH_B)])[0]).toBe(
      '[RD+] Show 1080p x265',
    );
  });

  it('orders quality 1080p > 720p > 2160p > untagged > 480p and sinks .avi', () => {
    const out = rank([
      rel('[RD+] other', HASH_A),
      rel('[RD+] 480p', HASH_B),
      rel('[RD+] 2160p', HASH_C),
      rel('[RD+] 720p', 'd'.repeat(40)),
      rel('[RD+] 1080p', 'e'.repeat(40)),
    ]);
    // an explicit 480p sinks below a release with no resolution tag at all
    expect(out).toEqual(['[RD+] 1080p', '[RD+] 720p', '[RD+] 2160p', '[RD+] other', '[RD+] 480p']);
    const avi: Rel = { name: '[RD+] 1080p', url: 'https://x/f.avi' };
    const withAvi = rankReleases([avi, rel('[RD+] 2160p', HASH_A)], describeRel, {});
    expect(withAvi[0].name).toBe('[RD+] 2160p');
  });

  it('is stable for equal candidates', () => {
    const a = rel('[RD+] Show 1080p', HASH_A, 'first');
    const b = rel('[RD+] Show 1080p', HASH_B, 'second');
    expect(rankReleases([a, b], describeRel, {})).toEqual([a, b]);
    expect(rankReleases([b, a], describeRel, {})).toEqual([b, a]);
  });
});

describe('scoreProbedRelease', () => {
  const prefs = { audioLanguage: 'jpn', subtitlesLanguage: 'eng' };
  const sub = (lang: string, textBased = true) => ({ lang, title: null, textBased });

  it('ranks preferred-language audio above everything else', () => {
    const jp = scoreProbedRelease({ audio: [{ lang: 'jpn' }], subs: [], height: 720 }, prefs);
    const rich = scoreProbedRelease(
      { audio: [{ lang: 'eng' }, { lang: 'fra' }], subs: [sub('eng'), sub('eng'), sub('eng')], height: 2160, name: 'BD Complete' },
      prefs,
    );
    expect(compareProbeScores(jp, rich)).toBeLessThan(0);
  });

  it('caps preferred-language subs at 3 and then counts total text subs', () => {
    const three = scoreProbedRelease({ audio: [], subs: [sub('eng'), sub('eng'), sub('eng')], height: null }, prefs);
    const five = scoreProbedRelease(
      { audio: [], subs: [sub('eng'), sub('eng'), sub('eng'), sub('eng'), sub('eng')], height: null },
      prefs,
    );
    expect(three.slice(0, 2)).toEqual(five.slice(0, 2));
    expect(compareProbeScores(five, three)).toBeLessThan(0);
  });

  it('ignores image-based subs', () => {
    const s = scoreProbedRelease({ audio: [], subs: [sub('eng', false)], height: null }, prefs);
    expect(s[1]).toBe(0);
    expect(s[4]).toBe(0);
  });

  it('ranks dual audio, then 1080p, then subs, then pack markers', () => {
    const dual = scoreProbedRelease({ audio: [{ lang: 'jpn' }, { lang: 'eng' }], subs: [], height: 480 }, prefs);
    const single = scoreProbedRelease({ audio: [{ lang: 'jpn' }], subs: [], height: 1080 }, prefs);
    expect(compareProbeScores(dual, single)).toBeLessThan(0);
    const hd = scoreProbedRelease({ audio: [], subs: [], height: 1080 }, prefs);
    const sd = scoreProbedRelease({ audio: [], subs: [sub('fra'), sub('deu')], height: 720 }, prefs);
    expect(compareProbeScores(hd, sd)).toBeLessThan(0);
    const pack = scoreProbedRelease({ audio: [], subs: [], height: 720, name: 'Show BD Batch' }, prefs);
    const plain = scoreProbedRelease({ audio: [], subs: [], height: 720, name: 'Show' }, prefs);
    expect(compareProbeScores(pack, plain)).toBeLessThan(0);
  });

  it('works with no preferences', () => {
    const s = scoreProbedRelease(
      { audio: [{ lang: 'jpn' }], subs: [sub('eng')], height: 1080 },
      { audioLanguage: null, subtitlesLanguage: null },
    );
    expect(s.slice(0, 2)).toEqual([0, 0]);
  });
});

// The BUD-37 report: Bleach episode 45 (kitsu:244:45), Anime Time Disney+ BD pack
// remembered, both releases cached and x265. The AnimeRG batch names the episode
// in its filename (" - 045 - "), the Anime Time pack's filenames carry no marker.
describe('Bleach remembered pack vs AnimeRG 480p batch', () => {
  const A_NAME = '[RD+] Torrentio 1080p';
  const A_TITLE = '[Anime Time] Bleach Complete Series + Movies [Disney+ BD][1080p][HEVC 10bit x265][AAC AC3]';
  const B_NAME = '[RD+] Torrentio 480p';
  const B_TITLE = '[AnimeRG] Bleach (Complete Series) EP 001-366 [480p] [Dual-Audio] [Batch] [x265] [10-bit] [pseudo]';
  const EP_TITLE = 'The Fight to the Death Begins';
  const a: Rel = { name: A_NAME, title: A_TITLE, url: `https://x/${HASH_A}/pack.mkv` };
  const b: Rel = { name: B_NAME, title: B_TITLE, url: `https://x/${HASH_B}/pack.mkv` };
  const filenames = new Map<string, string>([
    [b.url, `Bleach - 045 - ${EP_TITLE}.mkv`],
  ]);
  const describeWithFile = (r: Rel): ReleaseCandidate => ({ ...describeRel(r), filename: filenames.get(r.url) ?? null });
  const withTitle: ExpectedEpisode = { season: 1, episode: 45, absolute: 45, title: EP_TITLE };
  const withoutTitle: ExpectedEpisode = { season: 1, episode: 45, absolute: 45, title: null };
  const order = (items: Rel[], ctx: RankContext) => rankReleases(items, describeWithFile, ctx).map((r) => r.name);

  for (const [label, expected] of [['with', withTitle], ['without', withoutTitle]] as const) {
    it(`keeps the remembered Anime Time pack first, ${label} the episode title`, () => {
      expect(order([b, a], { rememberedInfohash: HASH_A, expected })).toEqual([A_NAME, B_NAME]);
      expect(order([a, b], { rememberedInfohash: HASH_A, expected })).toEqual([A_NAME, B_NAME]);
      const [info] = computeRankInfos([a], describeWithFile, { rememberedInfohash: HASH_A, expected });
      expect(info.remembered).toBe(true);
    });

    it(`ranks the 1080p release over the 480p batch with nothing remembered, ${label} the episode title`, () => {
      expect(order([b, a], { expected })).toEqual([A_NAME, B_NAME]);
    });

    it(`still ranks the 1080p release first when only the 480p batch was probed, ${label} the episode title`, () => {
      const probeScores = new Map([[b.url, [1, 3, 1, 0, 9, 1] as const]]);
      expect(order([b, a], { expected, probeScores })).toEqual([A_NAME, B_NAME]);
    });
  }

  it('does not remember a pack whose own text names another episode', () => {
    const wrong: Rel = { name: '[RD+] Show 1080p', title: 'Show S01E07 pack', url: `https://x/${HASH_C}/f.mkv` };
    const right: Rel = { name: '[RD+] Show 1080p', title: 'Show S01E45', url: `https://x/${HASH_B}/f.mkv` };
    const [info] = computeRankInfos([wrong], describeRel, { rememberedInfohash: HASH_C, expected: withoutTitle });
    expect(info.remembered).toBe(false);
    expect(info.contradicts).toBe(true);
    expect(rankReleases([wrong, right], describeRel, { rememberedInfohash: HASH_C, expected: withoutTitle })[0]).toBe(right);
  });

  it('uses the infohash a source carries when the url does not', () => {
    const house: ReleaseCandidate = {
      name: '[RD+] Show 720p',
      url: 'https://45-4.download.real-debrid.com/d/ABC/Show.mkv',
      infohash: HASH_B.toUpperCase(),
    };
    const other: ReleaseCandidate = { name: '[RD+] Show 1080p', url: `https://x/${HASH_A}/f.mkv` };
    const out = rankReleases([other, house], (x) => x, { rememberedInfohash: HASH_B });
    expect(out[0]).toBe(house);
  });

  it('sinks a wrong-episode 1080p below a right-episode 480p', () => {
    const wrong: Rel = { name: '[RD+] Show 1080p', title: 'Show S02E01', url: `https://x/${HASH_A}/f.mkv` };
    const right: Rel = { name: '[RD+] Show 480p', title: 'Show S01E45', url: `https://x/${HASH_B}/f.mkv` };
    expect(rankReleases([wrong, right], describeRel, { expected: withoutTitle })[0]).toBe(right);
  });
});
