import { mergeTests, expect, type Page } from '@playwright/test';
import { test as desktopTest } from '../fixtures/desktop';
import { test as mediaTest } from '../fixtures/media';

// Player tracks (desktop / mpv). STRONG ORACLE: the test media is GENERATED with
// KNOWN tracks (2 audio: eng+spa, 1 subrip subtitle), so the expected result isn't
// "whatever the code does" — it's "mpv reports exactly the tracks we put in the
// file, and switching aid/sid changes the selected one".
const test = mergeTests(desktopTest, mediaTest);

const UI = process.env.E2E_DESKTOP_UI || 'http://localhost:5173';
const playerUrl = (url: string) =>
  `${UI}/player?${new URLSearchParams({ type: 'movie', id: 'tt1254207', url, rdsel: '1', title: 'Tracks' })}`;

type MpvTrack = { id: number; kind: string; lang: string | null; selected: boolean };
const getTracks = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { blissfulDesktop: { call: (m: string) => Promise<unknown> } }).blissfulDesktop.call('mpv.getTracks'),
  ) as Promise<MpvTrack[]>;
const setProp = (page: Page, name: string, value: string) =>
  page.evaluate(
    (args) =>
      (window as unknown as { blissfulDesktop: { call: (m: string, a: unknown) => Promise<unknown> } }).blissfulDesktop.call(
        'mpv.setProperty',
        [args.name, args.value],
      ),
    { name, value },
  );

test.describe('Player tracks (desktop / mpv)', () => {
  test("exposes the file's 2 audio + 1 subtitle, and audio/subtitle switch", async ({ desktop, multitrackUrl }) => {
    test.skip(!multitrackUrl, 'ffmpeg unavailable to generate the multi-track test media');
    const { page } = desktop;
    await page.goto(playerUrl(multitrackUrl!), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !!(window as unknown as { blissfulDesktop?: { call?: unknown } }).blissfulDesktop?.call,
      null,
      { timeout: 20_000 },
    );

    // Oracle: the file has exactly 2 audio tracks + ≥1 subtitle (we generated it).
    await expect
      .poll(async () => (await getTracks(page)).filter((t) => t.kind === 'audio').length, { timeout: 30_000, intervals: [1000] })
      .toBe(2);
    const tracks = await getTracks(page);
    const audio = tracks.filter((t) => t.kind === 'audio');
    const subs = tracks.filter((t) => t.kind === 'sub');
    expect(subs.length, 'one subtitle track').toBeGreaterThanOrEqual(1);

    // Switching the audio track changes which one mpv reports as selected.
    const target = audio.find((t) => !t.selected) ?? audio[1];
    await setProp(page, 'aid', String(target.id));
    await expect
      .poll(async () => (await getTracks(page)).find((t) => t.kind === 'audio' && t.selected)?.id, { timeout: 10_000 })
      .toBe(target.id);

    // Enabling the subtitle track selects it.
    await setProp(page, 'sid', String(subs[0].id));
    await expect
      .poll(async () => (await getTracks(page)).find((t) => t.kind === 'sub' && t.selected)?.id, { timeout: 10_000 })
      .toBe(subs[0].id);
  });
});
