// /offline-check — the device-capability probe.
//
// Standalone and dependency-free on purpose: open it on the actual phone
// (blissful.budinoff.com/offline-check) and it answers the only questions that
// decide whether offline works there — is there an MSE implementation to feed
// stored segments into, how much storage will this origin actually get, and is
// the app installed (durable) or a plain tab (evictable). It also writes and
// reads back a real 8 MB blob, because a quota figure the browser reports and a
// write it actually honours are different things.
//
// Deliberately outside AppShell's chrome: it must render even if the rest of
// the app is broken on that device.

import { useCallback, useEffect, useState } from 'react';
import { detectOfflineCapabilities } from '../lib/offlineCapabilities';
import { estimateStorage, formatBytes, requestPersistentStorage } from '../lib/offlineStore';

type WriteTest = { state: 'idle' | 'running' | 'ok' | 'fail'; detail: string };

const PROBE_DB = 'blissful-offline-probe';
const PROBE_BYTES = 8 * 1024 * 1024;

/** Write an 8 MB blob to a throwaway IndexedDB, read it back, verify the size,
 *  then delete the database. Proves the storage path end to end. */
async function runWriteTest(): Promise<WriteTest> {
  if (typeof indexedDB === 'undefined') {
    return { state: 'fail', detail: 'IndexedDB is not available in this browser.' };
  }
  const cleanup = () => {
    try {
      indexedDB.deleteDatabase(PROBE_DB);
    } catch {
      // Best effort — a leftover probe DB is harmless.
    }
  };
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(PROBE_DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('blobs'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('open failed'));
    });
    const blob = new Blob([new Uint8Array(PROBE_BYTES)], { type: 'video/mp2t' });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('blobs', 'readwrite');
      tx.objectStore('blobs').put(blob, 'probe');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('write failed'));
      tx.onabort = () => reject(tx.error ?? new Error('write aborted'));
    });
    const readBack = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction('blobs', 'readonly');
      const req = tx.objectStore('blobs').get('probe') as IDBRequest<Blob | undefined>;
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('read failed'));
    });
    db.close();
    cleanup();
    if (!readBack || readBack.size !== PROBE_BYTES) {
      return { state: 'fail', detail: `read back ${readBack?.size ?? 0} of ${PROBE_BYTES} bytes` };
    }
    return { state: 'ok', detail: `wrote and read back ${formatBytes(PROBE_BYTES)}` };
  } catch (err: unknown) {
    cleanup();
    return { state: 'fail', detail: err instanceof Error ? err.message : 'unknown error' };
  }
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean | null }) {
  const tone =
    good == null ? 'text-white/70' : good ? 'text-[var(--bliss-accent)]' : 'text-red-300';
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/10 py-2 last:border-b-0">
      <div className="text-[13px] text-white/60">{label}</div>
      <div className={`text-right text-[13px] font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default function OfflineCheckPage() {
  const [caps] = useState(() => detectOfflineCapabilities());
  const [storage, setStorage] = useState<{ usage: number | null; quota: number | null }>({
    usage: null,
    quota: null,
  });
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [write, setWrite] = useState<WriteTest>({ state: 'idle', detail: '' });

  useEffect(() => {
    void (async () => {
      setStorage(await estimateStorage());
      setPersisted(await requestPersistentStorage());
    })();
  }, []);

  const onRunWriteTest = useCallback(async () => {
    setWrite({ state: 'running', detail: '' });
    setWrite(await runWriteTest());
    setStorage(await estimateStorage());
  }, []);

  const verdict = caps.canPlay && caps.canStore;
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;

  return (
    <div className="min-h-dvh bg-[#07080b] px-4 py-8 text-white">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="font-[Fraunces] text-3xl font-semibold tracking-tight">Offline check</div>
        <div className="mt-1 text-sm text-white/55">
          Can this device download and play Blissful streams offline?
        </div>

        <div
          className={`mt-5 rounded-[20px] px-4 py-4 ring-1 ${
            verdict
              ? 'bg-[var(--bliss-accent)]/10 text-[var(--bliss-accent)] ring-[var(--bliss-accent)]/25'
              : 'bg-red-500/10 text-red-200 ring-red-400/25'
          }`}
        >
          <div className="text-base font-semibold">
            {verdict ? 'Yes — offline playback is supported here' : 'No — offline playback will not work here'}
          </div>
          {caps.blockedReason ? (
            <div className="mt-1 text-[13px] leading-relaxed opacity-90">{caps.blockedReason}</div>
          ) : null}
        </div>

        <div className="mt-5 rounded-[20px] bg-white/5 px-4 py-3 ring-1 ring-white/10">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            Playback
          </div>
          <Row
            label="MediaSource (full MSE)"
            value={caps.hasMse ? 'yes' : 'no'}
            good={caps.hasMse ? true : null}
          />
          <Row
            label="ManagedMediaSource (iOS 17.1+)"
            value={caps.hasManagedMse ? 'yes' : 'no'}
            good={caps.hasManagedMse ? true : null}
          />
          <Row
            label="Can play stored segments"
            value={caps.canPlay ? 'yes' : 'no'}
            good={caps.canPlay}
          />
        </div>

        <div className="mt-3 rounded-[20px] bg-white/5 px-4 py-3 ring-1 ring-white/10">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            Storage
          </div>
          <Row label="IndexedDB" value={caps.canStore ? 'available' : 'unavailable'} good={caps.canStore} />
          <Row
            label="Quota for this origin"
            value={storage.quota != null ? formatBytes(storage.quota) : 'not reported'}
            good={storage.quota != null ? storage.quota > 2 * 1024 ** 3 : null}
          />
          <Row
            label="Already used"
            value={storage.usage != null ? formatBytes(storage.usage) : 'not reported'}
          />
          <Row
            label="Persistent storage granted"
            value={persisted == null ? 'checking…' : persisted ? 'yes' : 'no (normal on iOS)'}
          />
          <Row
            label="8 MB write test"
            value={
              write.state === 'idle'
                ? 'not run'
                : write.state === 'running'
                  ? 'running…'
                  : write.state === 'ok'
                    ? write.detail
                    : `failed: ${write.detail}`
            }
            good={write.state === 'ok' ? true : write.state === 'fail' ? false : null}
          />
          <button
            type="button"
            onClick={() => void onRunWriteTest()}
            disabled={write.state === 'running'}
            className="mt-3 w-full cursor-pointer rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            Run write test
          </button>
        </div>

        <div className="mt-3 rounded-[20px] bg-white/5 px-4 py-3 ring-1 ring-white/10">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            Durability
          </div>
          <Row
            label="Installed to Home Screen"
            value={caps.isInstalled ? 'yes' : 'no — running in a browser tab'}
            good={caps.isInstalled ? true : false}
          />
          <Row label="Screen Wake Lock" value={caps.hasWakeLock ? 'supported' : 'not supported'} good={caps.hasWakeLock} />
          <Row label="iOS-like device" value={caps.isIosLike ? 'yes' : 'no'} />
          <Row label="iOS version (from UA)" value={caps.iosVersion ?? 'n/a'} />
          {caps.isIosLike && !caps.isInstalled ? (
            <div className="mt-3 rounded-xl bg-amber-400/10 px-3 py-2.5 text-[12px] leading-relaxed text-amber-100/90 ring-1 ring-amber-300/20">
              In a Safari tab, iOS can clear downloads after about a week of not
              opening Blissful, and the storage budget is smaller. Share → Add to
              Home Screen, then re-run this check.
            </div>
          ) : null}
        </div>

        <div className="mt-3 rounded-[20px] bg-white/5 px-4 py-3 ring-1 ring-white/10">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            User agent
          </div>
          <div className="break-words text-[11px] leading-relaxed text-white/50">{ua}</div>
        </div>
      </div>
    </div>
  );
}
