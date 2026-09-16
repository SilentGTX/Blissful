import { describe, it, expect, vi } from 'vitest';
import {
  animeIdOf,
  episodeNumberOf,
  fillerRunContaining,
  describeRun,
  type FillerMap,
} from './fillerList';

// The Kitsu -> MAL hop is ani.zip's business (covered by lib/aniskip); here it
// is a stub so the tests exercise only the proxy lookup and its cache.
vi.mock('./aniskip', () => ({
  resolveMalId: vi.fn(async (_scheme: string, value: string) => Number.parseInt(value, 10) + 1000),
}));

const vids = (eps: number[]) => eps.map((e) => ({ id: `kitsu:244:${e}`, episode: e }));
const fm = (entries: Array<[number, 'filler' | 'recap']>): FillerMap => new Map(entries);

describe('animeIdOf', () => {
  it('reads the scheme and value off anime ids and imdb ids', () => {
    expect(animeIdOf('kitsu:244')).toEqual({ scheme: 'kitsu', value: '244' });
    expect(animeIdOf('kitsu:244:65')).toEqual({ scheme: 'kitsu', value: '244' });
    expect(animeIdOf('mal:269')).toEqual({ scheme: 'mal', value: '269' });
    expect(animeIdOf('tt0434665:1:65')).toEqual({ scheme: 'imdb', value: 'tt0434665' });
  });
  it('is null for ids we cannot map', () => {
    expect(animeIdOf('tmdb:123')).toBeNull();
    expect(animeIdOf('')).toBeNull();
    expect(animeIdOf(null)).toBeNull();
  });
});

describe('fetchFillerMap scheme gate', () => {
  it('never looks up imdb ids: their episode numbering is per season, the map is absolute', async () => {
    const { fetchFillerMap } = await import('./fillerList');
    expect(await fetchFillerMap('tt0434665')).toBeNull();
    expect(await fetchFillerMap('tt0434665:3:8')).toBeNull();
  });
});

describe('episodeNumberOf', () => {
  it('takes the last numeric segment', () => {
    expect(episodeNumberOf('kitsu:244:65')).toBe(65);
    expect(episodeNumberOf('tt0434665:3:8')).toBe(8);
    expect(episodeNumberOf('kitsu:244')).toBe(244); // a bare show id has no episode; callers guard
    expect(episodeNumberOf('tt0434665')).toBeNull();
  });
});

describe('fillerRunContaining', () => {
  // Bleach's Bount arc: 64-91 filler, canon resumes at 92 (numbers illustrative).
  const map = fm([
    [33, 'filler'], [50, 'filler'],
    ...([64, 65, 66, 67, 68, 69, 70] as const).map((e) => [e, 'filler'] as [number, 'filler']),
    [100, 'recap'],
  ]);
  const videos = vids([30, 31, 32, 33, 34, 49, 50, 51, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 100]);

  it('returns null for a canon episode', () => {
    expect(fillerRunContaining(map, videos, 34)).toBeNull();
    expect(fillerRunContaining(map, videos, 63)).toBeNull();
  });

  it('finds a single-episode run and the episode to resume on', () => {
    const run = fillerRunContaining(map, videos, 33);
    expect(run).toMatchObject({ firstEp: 33, lastEp: 33, count: 1, hasRecap: false, resumeEp: 34, resumeVideoId: 'kitsu:244:34' });
  });

  it('expands to the whole run from any episode inside it', () => {
    // Entering at the start, and asking from the middle, describe the SAME run —
    // that identity is what stops the prompt re-firing on every episode inside it.
    const fromStart = fillerRunContaining(map, videos, 64);
    const fromMiddle = fillerRunContaining(map, videos, 67);
    expect(fromStart).toMatchObject({ firstEp: 64, lastEp: 70, count: 7, resumeEp: 71, resumeVideoId: 'kitsu:244:71' });
    expect(fromMiddle).toEqual(fromStart);
  });

  it('counts a recap as part of a run and says so', () => {
    const run = fillerRunContaining(map, videos, 100);
    expect(run).toMatchObject({ firstEp: 100, lastEp: 100, hasRecap: true });
    // Last episode in the list: nothing to resume on.
    expect(run!.resumeEp).toBeNull();
    expect(run!.resumeVideoId).toBeNull();
  });

  it('still describes the run when the episode list is missing the episode', () => {
    const sparse = vids([71, 72]);
    const run = fillerRunContaining(map, sparse, 66);
    expect(run).toMatchObject({ firstEp: 64, lastEp: 70, resumeEp: 71, resumeVideoId: 'kitsu:244:71' });
  });

  it('is null without a map', () => {
    expect(fillerRunContaining(null, videos, 64)).toBeNull();
  });
});

describe('fetchFillerMap', () => {
  const payload = (eps: Record<string, string>) =>
    new Response(JSON.stringify({ mal: 1, total: 3, source: 'jikan', episodes: eps }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  it('shares one lookup between concurrent callers and keeps only real flags', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => payload({ '33': 'filler', '50': 'recap', '7': 'bogus' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { fetchFillerMap } = await import('./fillerList');
      // The detail page and the player ask for the same title (one with the
      // episode suffix); the map is fetched once and both get the same object.
      const [a, b] = await Promise.all([fetchFillerMap('kitsu:9001'), fetchFillerMap('kitsu:9001:33')]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toBe('/skip-times?filler=1&mal=10001');
      expect(a).toBe(b);
      expect(a?.get(33)).toBe('filler');
      expect(a?.get(50)).toBe('recap');
      expect(a?.has(7)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not pin a failed lookup: the next caller retries', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(payload({ '2': 'filler' }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { fetchFillerMap } = await import('./fillerList');
      expect(await fetchFillerMap('kitsu:9002')).toBeNull();
      const again = await fetchFillerMap('kitsu:9002');
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(again?.get(2)).toBe('filler');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('pins a "nothing for this title" answer for the session', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response('nope', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { fetchFillerMap } = await import('./fillerList');
      expect(await fetchFillerMap('kitsu:9003')).toBeNull();
      expect(await fetchFillerMap('kitsu:9003')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('describeRun', () => {
  it('words single and multi-episode runs, and mentions recaps', () => {
    expect(describeRun({ firstEp: 33, lastEp: 33, count: 1, hasRecap: false, resumeEp: 34, resumeVideoId: 'x' })).toBe('Episode 33 is filler');
    expect(describeRun({ firstEp: 64, lastEp: 70, count: 7, hasRecap: false, resumeEp: 71, resumeVideoId: 'x' })).toBe('Episodes 64–70 are filler');
    expect(describeRun({ firstEp: 99, lastEp: 100, count: 2, hasRecap: true, resumeEp: null, resumeVideoId: null })).toBe('Episodes 99–100 are filler/recap');
  });
});
