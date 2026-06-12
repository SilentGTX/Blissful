/**
 * Minimal EBML/Matroska header parser.
 * Fetches the first 32–128 KB of an MKV file via Range request through the
 * addon-proxy, parses the Tracks element, and returns actual codec IDs.
 */

import type { AudioCodecTag, VideoCodecTag } from './browserCodecSupport';

export type ProbeResult = {
  videoCodec: VideoCodecTag;
  audioCodec: AudioCodecTag;
};

// --- EBML element IDs ---
const ID_EBML = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_TYPE = 0x83;
const ID_CODEC_ID = 0x86;

// Master elements we need to descend into
const MASTER_IDS = new Set([ID_EBML, ID_SEGMENT, ID_TRACKS, ID_TRACK_ENTRY]);

// --- VINT reading ---

function readVintRaw(data: Uint8Array, offset: number): { value: number; length: number } | null {
  if (offset >= data.length) return null;
  const first = data[offset];
  if (first === 0) return null;
  let numBytes = 1;
  let mask = 0x80;
  while ((first & mask) === 0 && mask > 0) {
    numBytes++;
    mask >>= 1;
  }
  if (offset + numBytes > data.length) return null;
  // Build the raw value (all bytes including marker bit)
  let raw = first;
  for (let i = 1; i < numBytes; i++) {
    raw = (raw * 256) + data[offset + i]; // avoid << for values > 32 bits
  }
  return { value: raw, length: numBytes };
}

function readElementId(data: Uint8Array, offset: number) {
  return readVintRaw(data, offset);
}

function readElementSize(data: Uint8Array, offset: number): { size: number; length: number } | null {
  if (offset >= data.length) return null;
  const first = data[offset];
  if (first === 0) return null;
  let numBytes = 1;
  let mask = 0x80;
  while ((first & mask) === 0 && mask > 0) {
    numBytes++;
    mask >>= 1;
  }
  if (offset + numBytes > data.length) return null;
  // Mask off the leading bit from first byte
  let size = first & (mask - 1);
  for (let i = 1; i < numBytes; i++) {
    size = (size * 256) + data[offset + i];
  }
  // Check for "unknown size" (all data bits set to 1)
  const allOnes = Math.pow(2, 7 * numBytes) - 1;
  if (size === allOnes) return { size: -1, length: numBytes };
  return { size, length: numBytes };
}

function readString(data: Uint8Array, offset: number, length: number): string {
  const end = Math.min(offset + length, data.length);
  let s = '';
  for (let i = offset; i < end; i++) {
    if (data[i] === 0) break; // null-terminated
    s += String.fromCharCode(data[i]);
  }
  return s;
}

function readUint(data: Uint8Array, offset: number, length: number): number {
  let val = 0;
  const end = Math.min(offset + length, data.length);
  for (let i = offset; i < end; i++) {
    val = val * 256 + data[i];
  }
  return val;
}

// --- Codec ID mapping ---

function mapVideoCodecId(codecId: string): VideoCodecTag {
  if (codecId.startsWith('V_MPEG4/ISO/AVC')) return 'h264';
  if (codecId.startsWith('V_MPEGH/ISO/HEVC')) return 'hevc';
  if (codecId === 'V_AV1') return 'av1';
  return 'unknown';
}

function mapAudioCodecId(codecId: string): AudioCodecTag {
  if (codecId.startsWith('A_AAC')) return 'aac';
  if (codecId === 'A_AC3') return 'ac3';
  if (codecId === 'A_EAC3') return 'eac3';
  if (codecId.startsWith('A_DTS')) return 'dts'; // A_DTS, A_DTS/EXPRESS, A_DTS/LOSSLESS
  if (codecId === 'A_TRUEHD') return 'truehd';
  if (codecId === 'A_FLAC') return 'flac';
  if (codecId === 'A_OPUS') return 'opus';
  if (codecId === 'A_VORBIS') return 'opus'; // vorbis supported similarly
  if (codecId.startsWith('A_MPEG')) return 'aac'; // MP3/MP2 are supported
  if (codecId.startsWith('A_PCM')) return 'aac'; // PCM is supported
  return 'unknown';
}

// --- EBML tree walker ---

type Track = { type: number; codecId: string };

function extractTracks(data: Uint8Array): Track[] {
  const tracks: Track[] = [];
  let offset = 0;

  function walk(end: number, depth: number, currentTrack: { type: number; codecId: string } | null): void {
    while (offset < end) {
      const idResult = readElementId(data, offset);
      if (!idResult) return;
      offset += idResult.length;

      const sizeResult = readElementSize(data, offset);
      if (!sizeResult) return;
      offset += sizeResult.length;

      const elementId = idResult.value;
      const elementSize = sizeResult.size;
      const elementEnd = elementSize === -1 ? end : Math.min(offset + elementSize, end);

      if (MASTER_IDS.has(elementId)) {
        const track = elementId === ID_TRACK_ENTRY ? { type: 0, codecId: '' } : null;
        walk(elementEnd, depth + 1, track ?? currentTrack);
        if (track && track.codecId) {
          tracks.push(track);
        }
        offset = elementEnd;
      } else if (elementId === ID_TRACK_TYPE && currentTrack && elementSize > 0) {
        currentTrack.type = readUint(data, offset, elementSize);
        offset = elementEnd;
      } else if (elementId === ID_CODEC_ID && currentTrack && elementSize > 0) {
        currentTrack.codecId = readString(data, offset, elementSize);
        offset = elementEnd;
      } else {
        // Skip non-interesting elements
        if (elementSize === -1) return; // can't skip unknown-size non-master
        offset = elementEnd;
      }
    }
  }

  walk(data.length, 0, null);
  return tracks;
}

// --- Fetch + parse ---

const PROBE_BYTES = 32 * 1024; // 32 KB
const FETCH_TIMEOUT = 10_000; // 10 seconds

function buildProxyUrl(url: string): string {
  return `/addon-proxy?url=${encodeURIComponent(url)}`;
}

/** Fetch first N bytes using Range header + streaming reader with abort. */
async function fetchRange(url: string, bytes: number): Promise<Uint8Array | null> {
  const proxyUrl = buildProxyUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(proxyUrl, {
      headers: { Range: `bytes=0-${bytes - 1}` },
      signal: controller.signal,
    });
    if (!resp.ok && resp.status !== 206) {
      clearTimeout(timer);
      return null;
    }

    // Read only the bytes we need via streaming, then abort the rest.
    // This handles servers that ignore Range and send the full file.
    const reader = resp.body?.getReader();
    if (!reader) {
      clearTimeout(timer);
      const buf = await resp.arrayBuffer();
      return new Uint8Array(buf.slice(0, bytes));
    }

    const chunks: Uint8Array[] = [];
    let totalRead = 0;
    while (totalRead < bytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalRead += value.length;
    }
    // Cancel remaining data
    reader.cancel().catch(() => {});
    controller.abort();
    clearTimeout(timer);

    const result = new Uint8Array(totalRead);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

// In-memory cache: URL → ProbeResult (or null for failed probes)
const probeCache = new Map<string, ProbeResult | null>();

export async function probeMkvCodecs(url: string): Promise<ProbeResult | null> {
  const cached = probeCache.get(url);
  if (cached !== undefined) return cached;

  const data = await fetchRange(url, PROBE_BYTES);
  if (!data || data.length < 32) {
    probeCache.set(url, null);
    return null;
  }

  const tracks = extractTracks(data);
  if (tracks.length === 0) {
    // Tracks element might be beyond 32KB — try 128KB
    const data2 = await fetchRange(url, 128 * 1024);
    if (data2 && data2.length > PROBE_BYTES) {
      const tracks2 = extractTracks(data2);
      if (tracks2.length > 0) {
        const result = buildResult(tracks2);
        probeCache.set(url, result);
        return result;
      }
    }
    probeCache.set(url, null);
    return null;
  }

  const result = buildResult(tracks);
  probeCache.set(url, result);
  return result;
}

function buildResult(tracks: Track[]): ProbeResult {
  let videoCodec: VideoCodecTag = 'unknown';
  let audioCodec: AudioCodecTag = 'unknown';

  for (const track of tracks) {
    if (track.type === 1 && videoCodec === 'unknown') {
      videoCodec = mapVideoCodecId(track.codecId);
    }
    if (track.type === 2 && audioCodec === 'unknown') {
      // Use first audio track's codec
      audioCodec = mapAudioCodecId(track.codecId);
    }
  }

  return { videoCodec, audioCodec };
}
