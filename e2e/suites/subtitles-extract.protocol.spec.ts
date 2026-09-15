import { mergeTests, expect } from '@playwright/test';
import { test as mediaTest } from '../fixtures/media';
import { test as base } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Embedded-subtitle extraction (addon-proxy). STRONG ORACLE: the media is
// GENERATED with a known subtitle track carrying a known cue, so "correct" isn't
// "whatever came back" — it's "the cue we put in the file".
//
// What this guards: /extract-subtitle.vtt is SINGLE-FLIGHT. The players
// re-request the same track while a run is already going (the web player
// re-attaches its <track>, which makes the browser abort the old GET and issue a
// new one), and before the guard each request spawned its own ffmpeg demuxing the
// same multi-GB file over the same Real-Debrid link — four concurrent runs on one
// Bleach episode put the first cues 8.7s out, against 2.1s for a single run.
// They weren't doing different work, they were competing for bandwidth.
//
// The invariant is the run COUNT, not a stopwatch: N concurrent requests must
// produce exactly one ffmpeg run and N identical complete responses. Latency
// follows from that, and a count is not flaky the way a time threshold is.
// Run counts are read from the proxy's own log lines (the only signal it exposes).

const PROXY = path.join('apps', 'shared', 'addon-proxy', 'server.js');
const CONCURRENT = 4;

type Proxy = { url: string; log: () => string; close: () => void };

const proxyTest = base.extend<{ proxy: Proxy | null }>({
  proxy: async ({}, use, testInfo) => {
    // Cold every run: a private cache dir means the extraction can never be
    // served from a previous run's cache (which would test nothing).
    const cacheDir = path.join(testInfo.outputDir, 'json-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const port = 34000 + (process.pid % 1000);
    let log = '';
    let child: ChildProcess | null = spawn('node', [PROXY], {
      env: { ...process.env, PORT: String(port), JSON_CACHE_DIR: cacheDir, IMG_CACHE_DIR: cacheDir },
    });
    child.stdout?.on('data', (b) => { log += b.toString(); });
    child.stderr?.on('data', (b) => { log += b.toString(); });

    const started = await Promise.race([
      new Promise<boolean>((resolve) => {
        const t = setInterval(() => {
          if (/listening on port/i.test(log)) { clearInterval(t); resolve(true); }
        }, 200);
        setTimeout(() => { clearInterval(t); resolve(false); }, 20_000);
      }),
      new Promise<boolean>((resolve) => child?.once('exit', () => resolve(false))),
    ]);

    if (!started) {
      // The proxy's runtime deps are installed by its container at boot
      // (docker-compose: `npm install crypto-js ws`), so a bare checkout may not
      // have them. Skip loudly rather than fail on an environment gap.
      child?.kill();
      // eslint-disable-next-line no-console
      console.warn(`[subtitles-extract] proxy did not start; skipping.\n${log.slice(0, 400)}`);
      await use(null);
      return;
    }

    try {
      await use({ url: `http://127.0.0.1:${port}`, log: () => log, close: () => child?.kill() });
    } finally {
      child?.kill();
      child = null;
    }
  },
});

const test = mergeTests(mediaTest, proxyTest);

test.describe('Embedded subtitle extraction (addon-proxy)', () => {
  test('N concurrent requests for one track share a single ffmpeg run', async ({ proxy, multitrackLanUrl }) => {
    test.skip(!multitrackLanUrl, "ffmpeg unavailable, or no LAN address for the proxy to reach the test media");
    test.skip(!proxy, 'addon-proxy could not start (missing crypto-js/ws in this checkout)');
    const p = proxy!;

    // Do exactly what the players do: probe for text tracks, then extract one.
    const probe = await fetch(`${p.url}/probe-streams?url=${encodeURIComponent(multitrackLanUrl!)}`);
    expect(probe.status, 'probe responds').toBe(200);
    const data = (await probe.json()) as {
      subtitles?: Array<{ index: number; textBased: boolean; language: string }>;
    };
    const textSubs = (data.subtitles ?? []).filter((s) => s.textBased);
    // Oracle: we generated the file with exactly one subrip track, language eng.
    expect(textSubs.length, 'the generated file has one text subtitle track').toBe(1);
    expect(textSubs[0].language).toBe('eng');

    const target = `${p.url}/extract-subtitle.vtt?url=${encodeURIComponent(multitrackLanUrl!)}&track=${textSubs[0].index}`;
    const t0 = Date.now();
    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, async (_, i) => {
        // Stagger slightly, the way a re-attaching player does.
        await new Promise((r) => setTimeout(r, i * 120));
        const res = await fetch(target);
        const body = await res.text();
        return { status: res.status, body, finishedAt: Date.now() - t0 };
      }),
    );

    // Every caller gets a complete, correct VTT...
    for (const [i, r] of results.entries()) {
      expect(r.status, `response ${i} status`).toBe(200);
      expect(r.body, `response ${i} is WebVTT`).toContain('WEBVTT');
      expect(r.body, `response ${i} carries the cue we generated`).toContain('E2E test subtitle');
    }
    // ...and they are byte-identical, which is what proves they came from one run
    // rather than from separate ffmpeg invocations that merely agreed.
    expect(new Set(results.map((r) => r.body)).size, 'all responses identical').toBe(1);

    // The invariant: ONE ffmpeg, the rest joined it.
    const log = p.log();
    const runs = (log.match(/Extracting embedded sub track/g) ?? []).length;
    const joins = (log.match(/JOIN in-flight/g) ?? []).length;
    expect(runs, `one ffmpeg run for ${CONCURRENT} concurrent requests`).toBe(1);
    expect(joins, 'the other requests joined the in-flight run').toBe(CONCURRENT - 1);

    // Joiners are served from the leader's stream, so they finish with it rather
    // than starting their own clock. Loose bound — this is corroboration, not the
    // assertion the test rests on.
    const spread = Math.max(...results.map((r) => r.finishedAt)) - Math.min(...results.map((r) => r.finishedAt));
    expect(spread, 'joiners finish alongside the leader').toBeLessThan(5_000);
  });

  test('a second request for the same track is served from cache, with no ffmpeg', async ({ proxy, multitrackLanUrl }) => {
    test.skip(!multitrackLanUrl, "ffmpeg unavailable, or no LAN address for the proxy to reach the test media");
    test.skip(!proxy, 'addon-proxy could not start (missing crypto-js/ws in this checkout)');
    const p = proxy!;

    const probe = await fetch(`${p.url}/probe-streams?url=${encodeURIComponent(multitrackLanUrl!)}`);
    const data = (await probe.json()) as { subtitles?: Array<{ index: number; textBased: boolean }> };
    const idx = (data.subtitles ?? []).find((s) => s.textBased)!.index;
    const target = `${p.url}/extract-subtitle.vtt?url=${encodeURIComponent(multitrackLanUrl!)}&track=${idx}`;

    const first = await (await fetch(target)).text();
    expect(first).toContain('E2E test subtitle');
    const runsAfterFirst = (p.log().match(/Extracting embedded sub track/g) ?? []).length;

    const second = await (await fetch(target)).text();
    expect(second, 'cache returns the same VTT').toBe(first);
    const runsAfterSecond = (p.log().match(/Extracting embedded sub track/g) ?? []).length;
    expect(runsAfterSecond, 'the warm path spawns no further ffmpeg').toBe(runsAfterFirst);
    expect(p.log()).toContain('Embedded sub cache HIT');
  });
});

export { expect };
