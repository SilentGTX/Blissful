// Ported verbatim from apps/blissful-mvs/src/lib/colorUtils.ts.
// volumeFillColor(v): v in [0..1] (= player volume / 2, so unity 1.0 → 0.5).
// Pure white up to unity, then ramps white→yellow→orange→red toward 200%.
const VOLUME_FILL_STOPS = [
  { t: 0.5, rgb: { r: 255, g: 255, b: 255 } },
  { t: 0.62, rgb: { r: 250, g: 204, b: 21 } },
  { t: 0.8, rgb: { r: 249, g: 115, b: 22 } },
  { t: 1.0, rgb: { r: 239, g: 68, b: 68 } },
];

export function volumeFillColor(v: number): string {
  const clamped = Math.max(0, Math.min(1, v));
  if (clamped <= VOLUME_FILL_STOPS[0].t) return '#ffffff';
  for (let i = 0; i < VOLUME_FILL_STOPS.length - 1; i++) {
    const lo = VOLUME_FILL_STOPS[i];
    const hi = VOLUME_FILL_STOPS[i + 1];
    if (clamped >= lo.t && clamped <= hi.t) {
      const t = (clamped - lo.t) / (hi.t - lo.t);
      const r = Math.round(lo.rgb.r + (hi.rgb.r - lo.rgb.r) * t);
      const g = Math.round(lo.rgb.g + (hi.rgb.g - lo.rgb.g) * t);
      const b = Math.round(lo.rgb.b + (hi.rgb.b - lo.rgb.b) * t);
      return `rgb(${r}, ${g}, ${b})`;
    }
  }
  const last = VOLUME_FILL_STOPS[VOLUME_FILL_STOPS.length - 1].rgb;
  return `rgb(${last.r}, ${last.g}, ${last.b})`;
}

// ── Subtitle / swatch colour helpers ─────────────────────────────────────────
// The account stores subtitle colours as rgba (the desktop format), sometimes
// with spaces ("rgba(200, 255, 225, 1)") and sometimes without. Normalise for
// equality so a saved colour matches its swatch regardless of spacing/case.
export function normColor(c: string | null | undefined): string {
  if (!c) return '';
  return c.replace(/\s+/g, '').toLowerCase();
}

/** True when the colour is fully transparent (alpha 0) or the literal keyword —
 *  used to render the "no colour" swatch and the transparent label. */
export function isTransparentColor(c: string | null | undefined): boolean {
  const n = normColor(c);
  return n === 'transparent' || /^rgba?\(\d+,\d+,\d+,0(\.0+)?\)$/.test(n);
}

/** Coerce any stored colour (hex / rgb / rgba / "transparent") to an rgba string
 *  so the rgba-based swatch palettes can represent it. Unknown input → white. */
export function toRgba(c: string | null | undefined): string {
  if (!c) return 'rgba(255,255,255,1)';
  const s = c.trim();
  if (/^transparent$/i.test(s)) return 'rgba(0,0,0,0)';
  if (/^rgba?\(/i.test(s)) return s;
  if (s.startsWith('#')) {
    const h = s.slice(1);
    const hex = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      if (![r, g, b].some((n) => Number.isNaN(n))) return `rgba(${r},${g},${b},1)`;
    }
  }
  return 'rgba(255,255,255,1)';
}

// Source badge code from the stream URL (ported from PlayerHdrBadges.detectSource).
export function detectSource(url: string | null | undefined): { code: string; label: string } | null {
  if (!url) return null;
  if (/\/resolve\/realdebrid\//i.test(url) || /realdebrid=/i.test(url)) return { code: 'RD', label: 'Real-Debrid' };
  if (/torrentio\.strem\.fun/i.test(url)) return { code: 'Torrentio', label: 'Torrentio' };
  if (/thepiratebay/i.test(url)) return { code: 'TPB+', label: 'ThePirateBay+' };
  if (/comet\.elfhosted/i.test(url)) return { code: 'Comet', label: 'Comet' };
  if (/mediafusion/i.test(url)) return { code: 'MediaFusion', label: 'MediaFusion' };
  if (/alldebrid|alldebrid=/i.test(url)) return { code: 'AD', label: 'AllDebrid' };
  if (/premiumize/i.test(url)) return { code: 'PM', label: 'Premiumize' };
  if (/127\.0\.0\.1:11470|localhost:11470/i.test(url)) return { code: 'Local', label: 'Local stream' };
  return null;
}

export function is4kTitle(title: string | null | undefined): boolean {
  return !!title && /\b(?:2160p|4k|uhd)\b/i.test(title);
}
export function isHdrTitle(title: string | null | undefined): boolean {
  return !!title && /\b(hdr|hdr10|dv|dolby\s*vision)\b/i.test(title);
}
