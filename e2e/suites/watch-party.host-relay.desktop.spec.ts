import { test } from '../fixtures/desktop';
import { expect } from '@playwright/test';

// Migrated from scripts/e2e/host-relay.mjs. The real Layer-B "desktop shares its
// stream" MECHANISM: the shell's startPartyRelay opens an outbound wss tunnel to
// the Mac, ensures local stremio-service, and the Mac pulls through the tunnel —
// so a GET of the public relay URL returns a real, key-rewritten HLS master.
// Uses the public Sintel WebM directly (the shell has internet); needs the live Mac.

const MEDIA = process.env.TEST_STREAM_URL || 'https://media.w3.org/2010/05/sintel/trailer.webm';

test('host relay serves a real key-rewritten HLS master through the Mac', async ({ desktop }) => {
  const { bridge } = desktop;
  const room = 'e2e-relay-' + Math.random().toString(36).slice(2, 8);
  const hlsPath = `hlsv2/blissful-party/master.m3u8?mediaURL=${encodeURIComponent(MEDIA)}&maxWidth=3840`;

  const ipc = await bridge<{ relayUrl?: string }>('startPartyRelay', { room, hlsPath });
  expect(ipc.ok, `startPartyRelay rejected: ${ipc.err}`).toBe(true);
  const relayUrl = ipc.r?.relayUrl;
  expect(relayUrl, 'no relayUrl in IPC result').toBeTruthy();

  // The Mac pulls through the shell's real tunnel → a valid, key-rewritten HLS master.
  let ok = false;
  let last = '';
  for (let i = 0; i < 8 && !ok; i++) {
    const res = await fetch(relayUrl!, { signal: AbortSignal.timeout(20000) }).catch(() => null);
    const body = res && res.status === 200 ? await res.text() : '';
    last = body || `status ${res?.status ?? 'err'}`;
    if (/^#EXTM3U/.test(body.trim()) && /k=/.test(body)) ok = true;
    else await new Promise((r) => setTimeout(r, 2000));
  }
  expect(ok, `relay did not serve a valid key-rewritten HLS master: ${last.slice(0, 160)}`).toBe(true);

  await bridge('stopPartyRelay');
});
