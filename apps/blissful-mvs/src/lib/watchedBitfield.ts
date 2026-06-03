// Decoder for Stremio's serialized `WatchedBitField` (the value stored at
// LibraryItem.state.watched for series imported from a Stremio library).
//
// Serialized form: "<anchorVideoId>:<anchorLength>:<base64>" where:
//   - anchorVideoId is the id of the LAST WATCHED video (it itself contains
//     colons, e.g. "tt0106179:1:5"), so we MUST split off the trailing two
//     fields and re-join the rest.
//   - anchorLength is a 1-based index (lastWatchedIndex + 1).
//   - base64 is STANDARD (padded) base64 of a ZLIB-deflated byte buffer whose
//     bits are LSB-first within each byte.
//
// The bitfield is purely positional: bit i corresponds to the video at index i
// in the SAME ordered list that produced it (the addon meta's `videos` array,
// in its native season-then-episode order). We realign that decoded field onto
// the current ordered id list via the anchor: the decoded bit at position
// (anchorLength - 1) is pinned to anchorVideoId, giving
//   offset = (anchorLength - 1) - anchorIdxInCurrentList
// so current index i maps to decoded index (i + offset).
//
// Mirrors github.com/Stremio/stremio-watched-bitfield (JS, pako) and
// github.com/Stremio/stremio-core stremio-watched-bitfield (Rust, flate2).
//
// This function NEVER throws: any malformed/empty/undecodable input yields an
// empty Set (graceful degradation -> nothing shows as watched).

type ParsedWatched = {
  anchorVideoId: string;
  anchorLength: number;
  b64: string;
};

function parseWatched(serialized: string): ParsedWatched | null {
  // Anchor id contains ':' too, so pop the trailing two fields and re-join
  // the remainder. Require at least 3 colon-separated components.
  const components = serialized.split(':');
  if (components.length < 3) return null;
  const b64 = components.pop();
  const lengthStr = components.pop();
  if (b64 === undefined || lengthStr === undefined) return null;
  const anchorLength = parseInt(lengthStr, 10);
  if (!Number.isFinite(anchorLength)) return null;
  const anchorVideoId = components.join(':');
  return { anchorVideoId, anchorLength, b64 };
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    // Standard base64 (with '=' padding); atob is a Chromium global.
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

// ZLIB inflate via the WHATWG DecompressionStream. 'deflate' (NOT
// 'deflate-raw') means zlib-wrapped deflate (RFC 1950) — exactly what
// pako.inflate / flate2 ZlibDecoder produce. Async, hence the Promise.
async function inflateZlib(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    if (typeof DecompressionStream === 'undefined') return null;
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
      new DecompressionStream('deflate')
    );
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

// LSB-first, bounds-checked bit read. Trailing all-zero bytes are dropped by
// deflate, so indices past the decompressed buffer read as false.
function getBit(values: Uint8Array, i: number): boolean {
  if (i < 0) return false;
  const index = i >> 3;
  const bit = i & 7;
  if (index >= values.length) return false;
  return ((values[index] >> bit) & 1) !== 0;
}

/**
 * Decode a Stremio serialized WatchedBitField against the current ordered list
 * of series video ids and return the Set of ids that are marked watched.
 *
 * @param serialized  The raw `state.watched` string (may be null/empty/garbage).
 * @param orderedVideoIds  The series' video ids in their native meta `videos`
 *   order (do NOT re-sort) — e.g. ["tt0106179:1:1", "tt0106179:1:2", ...].
 * @returns A Set of watched video ids. Empty on any malformed/empty input.
 */
export async function decodeWatchedBitField(
  serialized: string | null | undefined,
  orderedVideoIds: string[]
): Promise<Set<string>> {
  const result = new Set<string>();
  if (!serialized || orderedVideoIds.length === 0) return result;

  const parsed = parseWatched(serialized);
  if (!parsed) return result;

  const { anchorVideoId, anchorLength, b64 } = parsed;
  const anchorIdx = orderedVideoIds.indexOf(anchorVideoId);
  // Anchor not present in the current list -> everything unwatched.
  if (anchorIdx === -1) return result;

  const bytes = base64ToBytes(b64);
  if (!bytes) return result;

  const values = await inflateZlib(bytes);
  if (!values) return result;

  // 1-based anchorLength, hence the -1.
  const offset = anchorLength - 1 - anchorIdx;
  for (let i = 0; i < orderedVideoIds.length; i += 1) {
    if (getBit(values, i + offset)) {
      result.add(orderedVideoIds[i]);
    }
  }
  return result;
}
