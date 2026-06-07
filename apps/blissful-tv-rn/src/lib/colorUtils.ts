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
