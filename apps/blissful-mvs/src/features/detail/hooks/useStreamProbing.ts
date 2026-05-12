import { useEffect, useRef, useState } from 'react';
import type { StreamRow } from '../streams';
import { probeMkvCodecs, type ProbeResult } from '../../../lib/probeMkvCodecs';
import { isAudioCodecSupported, isVideoCodecSupported } from '../../../lib/browserCodecSupport';
import { isIos } from '../utils';

const audioCodecLabel: Record<string, string> = {
  aac: 'AAC', ac3: 'AC3', eac3: 'EAC3', dts: 'DTS', truehd: 'TrueHD',
  atmos: 'Atmos', flac: 'FLAC', opus: 'Opus',
};

const videoCodecLabel: Record<string, string> = {
  h264: 'H.264', hevc: 'HEVC', av1: 'AV1',
};

const MAX_CONCURRENT = 4;

function isMkvUrl(url: string | null): boolean {
  if (!url) return false;
  return /\.mkv(\b|$|%)/i.test(url);
}

// 'pending' = probe hasn't completed, 'failed' = probe returned null
type ProbeEntry = ProbeResult | 'pending' | 'failed';
type ProbeMap = Map<string, ProbeEntry>;

/**
 * Probes MKV streams to determine actual codecs, then patches the rows
 * with corrected likelyPlayableInBrowser / unplayableReason.
 *
 * Only probes when `enabled` is true (WEB Ready filter ON).
 * MKV streams are hidden until probe confirms supported codecs.
 */
export function useStreamProbing(
  rows: StreamRow[],
  enabled: boolean
): { rows: StreamRow[]; probing: boolean } {
  const [probeMap, setProbeMap] = useState<ProbeMap>(new Map());
  const [probing, setProbing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Collect MKV URLs that need probing
  const mkvUrls = enabled
    ? [...new Set(rows.filter((r) => r.effectiveUrl && isMkvUrl(r.effectiveUrl)).map((r) => r.effectiveUrl!))]
    : [];

  // URLs not yet in the probeMap at all
  const urlsToProbe = mkvUrls.filter((url) => !probeMap.has(url));

  useEffect(() => {
    if (!enabled || urlsToProbe.length === 0) {
      setProbing(false);
      return;
    }

    // Mark all new URLs as pending before starting
    setProbeMap((prev) => {
      const next = new Map(prev);
      for (const url of urlsToProbe) {
        if (!next.has(url)) next.set(url, 'pending');
      }
      return next;
    });

    setProbing(true);
    const controller = new AbortController();
    abortRef.current = controller;

    let cancelled = false;

    async function probeAll() {
      const queue = [...urlsToProbe];

      while (queue.length > 0 && !cancelled) {
        const batch = queue.splice(0, MAX_CONCURRENT);
        const batchResults = await Promise.allSettled(
          batch.map(async (url) => {
            const result = await probeMkvCodecs(url);
            return { url, result };
          })
        );

        if (!cancelled) {
          setProbeMap((prev) => {
            const next = new Map(prev);
            for (const settled of batchResults) {
              if (settled.status === 'fulfilled') {
                const { url, result } = settled.value;
                next.set(url, result ?? 'failed');
              } else {
                // Promise rejected (shouldn't happen with probeMkvCodecs, but be safe)
              }
            }
            return next;
          });
        }
      }

      if (!cancelled) setProbing(false);
    }

    probeAll();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, urlsToProbe.join(',')]);

  // When disabled, pass through rows unchanged
  if (!enabled) {
    return { rows, probing: false };
  }

  // Patch rows: MKV streams are hidden unless probe confirms supported codecs
  const patchedRows = rows.map((row) => {
    if (!row.effectiveUrl || !isMkvUrl(row.effectiveUrl)) return row;

    const entry = probeMap.get(row.effectiveUrl);

    // Not yet probed or still pending — keep original playability (optimistic).
    // The stream may play fine; we'll restrict only when probe confirms bad codecs.
    if (!entry || entry === 'pending') {
      return row;
    }

    // Probe failed — keep original playability (optimistic).
    // Better to show a stream that might lack audio than to hide one that works.
    if (entry === 'failed') {
      return row;
    }

    // Probe succeeded — check actual codecs
    const audioSupported = isAudioCodecSupported(entry.audioCodec);
    const videoSupported = isVideoCodecSupported(entry.videoCodec);
    const likelyPlayableInBrowser = audioSupported && videoSupported;

    let unplayableReason: string | null = null;
    if (!likelyPlayableInBrowser) {
      if (!audioSupported) {
        unplayableReason = isIos()
          ? 'May require an external player (VLC)'
          : `No audio in web player (${audioCodecLabel[entry.audioCodec] || entry.audioCodec})`;
      } else if (!videoSupported) {
        unplayableReason = isIos()
          ? 'May require an external player (VLC)'
          : `No video in web player (${videoCodecLabel[entry.videoCodec] || entry.videoCodec})`;
      }
    }

    return { ...row, likelyPlayableInBrowser, unplayableReason };
  });

  return { rows: patchedRows, probing };
}
