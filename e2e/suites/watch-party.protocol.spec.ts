import { test, expect } from '@playwright/test';
import WebSocket from 'ws';

// Watch Party v2 WIRE PROTOCOL — raw ws + http against the deployed backend
// (no browser, no shell). Ported from scripts/e2e/watchparty-v2.mjs. Covers
// Layer A (host:source relay for all kinds, sanitize, late-joiner snapshot,
// source-clear-on-episode, non-host guard, tick, presence) and Layer B
// (party:request/decline routing). Runs in the `protocol` project.
//
// NOT ported here (still in the .mjs, need a live shell / RD / the Mac relay):
// /rd-by-hash 200, the /party-relay pull-through, /hlsv2 contract.

const STORAGE_HTTP = process.env.STORAGE_HTTP || 'https://blissful.budinoff.com/storage';
const STORAGE_WS = process.env.STORAGE_WS || 'wss://blissful.budinoff.com/storage/ws/room';
const rid = () => 'e2ept' + Math.random().toString(36).slice(2, 12);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Msg = Record<string, unknown> & { t: string };
type WSClient = {
  send: (o: unknown) => void;
  waitFor: (pred: (m: Msg) => boolean, ms?: number) => Promise<Msg>;
  expectNone: (pred: (m: Msg) => boolean, ms?: number) => Promise<void>;
  close: () => void;
};

async function wsClient(): Promise<WSClient> {
  const ws = new WebSocket(STORAGE_WS);
  const msgs: Msg[] = [];
  ws.on('message', (raw: WebSocket.RawData) => {
    try {
      msgs.push(JSON.parse(raw.toString()));
    } catch {
      /* non-JSON frame */
    }
  });
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  return {
    send: (o) => ws.send(JSON.stringify(o)),
    waitFor: (pred, ms = 8000) =>
      new Promise<Msg>((res, rej) => {
        const hit = msgs.find(pred);
        if (hit) return res(hit);
        const iv = setInterval(() => {
          const h = msgs.find(pred);
          if (h) {
            clearInterval(iv);
            res(h);
          }
        }, 100);
        setTimeout(() => {
          clearInterval(iv);
          rej(new Error('ws timeout waiting for a message'));
        }, ms);
      }),
    expectNone: async (pred, ms = 1800) => {
      await sleep(ms);
      if (msgs.some(pred)) throw new Error('received a message that should NOT have arrived');
    },
    close: () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
  };
}

async function createRoom(opts: { type?: string; imdbId?: string } = {}) {
  const res = await fetch(`${STORAGE_HTTP}/watch-party`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: opts.type ?? 'movie',
      imdbId: opts.imdbId ?? 'tt1254207',
      videoId: null,
      password: null,
      guestId: rid(),
    }),
  });
  if (!res.ok) throw new Error(`create room HTTP ${res.status}`);
  const { code } = await res.json();
  if (!code) throw new Error('create room: no code');
  return code as string;
}

async function joinRoom(code: string, displayName: string) {
  const c = await wsClient();
  c.send({ t: 'join', code, displayName, guestId: rid() });
  const room = await c.waitFor((m) => m.t === 'room', 8000);
  return { c, room: room as Msg & { self?: { userId: string }; source?: unknown }, userId: (room as { self?: { userId: string } }).self?.userId as string };
}

async function hostAndGuest() {
  const code = await createRoom();
  const host = await joinRoom(code, 'V2 Host');
  const guest = await joinRoom(code, 'V2 Guest');
  return {
    code,
    host,
    guest,
    cleanup: () => {
      host.c.close();
      guest.c.close();
    },
  };
}

test.describe('Watch Party v2 protocol (Layer A)', () => {
  const KINDS = [
    { kind: 'torrent', infoHash: 'a'.repeat(40), fileIdx: 2, trackers: ['udp://t.example:6969'] },
    { kind: 'rd', rdUrl: 'https://x.download.real-debrid.com/d/ABC123/file.mkv' },
    { kind: 'vidking', tmdbId: 27205, mediaType: 'movie' },
    { kind: 'vidking', tmdbId: 1399, mediaType: 'tv', season: 1, episode: 3 },
    { kind: 'relay', url: 'https://blissful.budinoff.com/party-relay/abc-def/index.m3u8?k=key' },
  ] as const;

  for (const src of KINDS) {
    const label = `${src.kind}${'mediaType' in src ? `/${src.mediaType}` : ''}`;
    test(`host:source relays to guest — ${label}`, async () => {
      const { host, guest, cleanup } = await hostAndGuest();
      try {
        host.c.send({ t: 'host:source', source: src });
        const got = await guest.c.waitFor((m) => m.t === 'source');
        const s = got.source as Record<string, unknown> | null;
        expect(s, 'guest got source:null').toBeTruthy();
        expect(s!.kind).toBe(src.kind);
        if (src.kind === 'torrent') {
          expect(s!.infoHash).toBe(src.infoHash.toLowerCase());
          expect(s!.fileIdx).toBe(src.fileIdx);
        }
        if (src.kind === 'rd') expect(s!.rdUrl).toBe(src.rdUrl);
        if (src.kind === 'vidking') {
          expect(s!.tmdbId).toBe(src.tmdbId);
          expect(s!.mediaType).toBe(src.mediaType);
        }
        if (src.kind === 'relay') expect(s!.url).toBe(src.url);
      } finally {
        cleanup();
      }
    });
  }

  test('sanitize — bad infoHash → null', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      host.c.send({ t: 'host:source', source: { kind: 'torrent', infoHash: 'not-a-hash', fileIdx: 0 } });
      const got = await guest.c.waitFor((m) => m.t === 'source');
      expect(got.source).toBeNull();
    } finally {
      cleanup();
    }
  });

  test('sanitize — non-http rd url → null', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      host.c.send({ t: 'host:source', source: { kind: 'rd', rdUrl: 'ftp://nope/file' } });
      const got = await guest.c.waitFor((m) => m.t === 'source');
      expect(got.source).toBeNull();
    } finally {
      cleanup();
    }
  });

  test('late-joiner snapshot carries the source', async () => {
    const code = await createRoom();
    const host = await joinRoom(code, 'V2 Host');
    try {
      host.c.send({ t: 'host:source', source: { kind: 'torrent', infoHash: 'b'.repeat(40), fileIdx: 1 } });
      await sleep(600);
      const late = await joinRoom(code, 'V2 Late');
      try {
        const s = late.room.source as Record<string, unknown> | null;
        expect(s, 'late snapshot source is null').toBeTruthy();
        expect(s!.infoHash).toBe('b'.repeat(40));
        expect(s!.fileIdx).toBe(1);
      } finally {
        late.c.close();
      }
    } finally {
      host.c.close();
    }
  });

  test('host:episode clears the source (fresh snapshot null)', async () => {
    const code = await createRoom();
    const host = await joinRoom(code, 'V2 Host');
    try {
      host.c.send({ t: 'host:source', source: { kind: 'torrent', infoHash: 'c'.repeat(40), fileIdx: 0 } });
      await sleep(400);
      host.c.send({ t: 'host:episode', videoId: 'tt1254207:1:2' });
      await sleep(600);
      const late = await joinRoom(code, 'V2 Late');
      try {
        expect(late.room.source ?? null).toBeNull();
      } finally {
        late.c.close();
      }
    } finally {
      host.c.close();
    }
  });

  test('non-host host:source is ignored', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      guest.c.send({ t: 'host:source', source: { kind: 'torrent', infoHash: 'd'.repeat(40), fileIdx: 0 } });
      await host.c.expectNone((m) => m.t === 'source');
    } finally {
      cleanup();
    }
  });

  test('host:tick → guest tick (server-stamped sentAt)', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      host.c.send({ t: 'host:tick', currentTime: 42.5, isPlaying: true });
      const tick = await guest.c.waitFor((m) => m.t === 'tick');
      expect(tick.currentTime).toBe(42.5);
      expect(tick.isPlaying).toBe(true);
      expect(typeof tick.sentAt === 'number' && (tick.sentAt as number) > 0).toBe(true);
    } finally {
      cleanup();
    }
  });

  test('presence — host sees the guest join', async () => {
    const code = await createRoom();
    const host = await joinRoom(code, 'V2 Host');
    try {
      const guest = await joinRoom(code, 'V2 Guest');
      try {
        const pres = await host.c.waitFor((m) => m.t === 'presence' && m.kind === 'joined');
        expect(pres.userId).toBe(guest.userId);
      } finally {
        guest.c.close();
      }
    } finally {
      host.c.close();
    }
  });
});

test.describe('Watch Party v2 protocol (Layer B — host relay request)', () => {
  test('party:request-host-stream → routed to host with `from`', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      guest.c.send({ t: 'party:request-host-stream' });
      const req = await host.c.waitFor((m) => m.t === 'party:host-stream-request');
      const from = req.from as { userId: string; displayName: string };
      expect(from.userId).toBe(guest.userId);
      expect(from.displayName).toBe('V2 Guest');
    } finally {
      cleanup();
    }
  });

  test('party:decline-host-stream → routed to the requesting guest', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      host.c.send({ t: 'party:decline-host-stream', targetUserId: guest.userId });
      await guest.c.waitFor((m) => m.t === 'party:host-stream-declined');
    } finally {
      cleanup();
    }
  });

  test('non-host decline is ignored', async () => {
    const { host, guest, cleanup } = await hostAndGuest();
    try {
      guest.c.send({ t: 'party:decline-host-stream', targetUserId: host.userId });
      await host.c.expectNone((m) => m.t === 'party:host-stream-declined');
    } finally {
      cleanup();
    }
  });
});
