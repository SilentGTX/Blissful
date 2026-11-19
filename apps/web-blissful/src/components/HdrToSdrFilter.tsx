// HdrToSdrFilter — the SVG filter a watch-party guest's <video> references
// (`filter: url(#bliss-hdr-pq-to-sdr)`) when the host is relaying an HDR10
// source. Renders nothing visible. The maths and the reasons live in
// lib/hdrToSdr.ts.

import { useMemo } from 'react';
import {
  BT2020_TO_BT709,
  DECODE_MATRIX_FIX,
  HDR_TO_SDR_FILTER_ID,
  buildHdrToSdrTable,
  feColorMatrixValues,
  feTableValues,
} from '../lib/hdrToSdr';

export function HdrToSdrFilter() {
  const { fix, table, gamut } = useMemo(
    () => ({
      fix: feColorMatrixValues(DECODE_MATRIX_FIX),
      table: feTableValues(buildHdrToSdrTable(256)),
      gamut: feColorMatrixValues(BT2020_TO_BT709),
    }),
    [],
  );
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
    >
      {/* sRGB: the primitives must see the pixel values as they are. The default
          (linearRGB) would have the browser linearise them first — in 8 bits. */}
      <filter id={HDR_TO_SDR_FILTER_ID} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
        <feColorMatrix type="matrix" values={fix} />
        <feComponentTransfer>
          <feFuncR type="table" tableValues={table} />
          <feFuncG type="table" tableValues={table} />
          <feFuncB type="table" tableValues={table} />
        </feComponentTransfer>
        <feColorMatrix type="matrix" values={gamut} />
      </filter>
    </svg>
  );
}
