// Color helpers shared by the players and SettingsPage. Previously
// duplicated verbatim in BlissfulPlayer / NativeMpvPlayer / SettingsPage —
// any change to one had to be mirrored to the other two, and any bug
// only got fixed in whichever player happened to be touched first.

export function parseColor(value: string): { hex: string; alpha: number } {
  const hexMatch = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hexMatch) {
    return { hex: `#${hexMatch[1]}`, alpha: 1 };
  }
  const rgbaMatch =
    /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/i.exec(value.trim()) ||
    /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(value.trim());
  if (rgbaMatch) {
    const r = Math.min(255, Math.max(0, Number(rgbaMatch[1])));
    const g = Math.min(255, Math.max(0, Number(rgbaMatch[2])));
    const b = Math.min(255, Math.max(0, Number(rgbaMatch[3])));
    const alpha = rgbaMatch[4] ? Math.min(1, Math.max(0, Number(rgbaMatch[4]))) : 1;
    const hex = `#${[r, g, b]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')}`;
    return { hex, alpha };
  }
  return { hex: '#ffffff', alpha: 1 };
}

export function buildRgba(hex: string, alpha: number): string {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return hex;
  const r = Number.parseInt(cleaned.slice(0, 2), 16);
  const g = Number.parseInt(cleaned.slice(2, 4), 16);
  const b = Number.parseInt(cleaned.slice(4, 6), 16);
  const safeAlpha = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16),
  };
}

// Volume slider fill color: linearly interpolate the rainbow stops
// (white -> yellow -> orange -> red) and return the RGB at the current
// volume position. The volume bar's filled region is painted as one
// solid color of this value, so the color "behind the thumb" matches
// the thumb's place on the scale instead of revealing a gradient.
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
