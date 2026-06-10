/**
 * Blissful TV — design tokens
 * All sizes are in dp, designed against a 1920×1080 reference.
 * Scale with your own responsive helper if targeting multiple TV resolutions.
 */
export const colors = {
  bg: '#06080c',
  panel: 'rgba(15,18,26,0.99)',
  panelEdge: 'rgba(255,255,255,0.07)',
  text: '#ffffff',
  textDim: 'rgba(255,255,255,0.62)',
  textFaint: 'rgba(255,255,255,0.45)',
  ink: '#0b0b0d',          // text on accent
  imdb: '#f5c518',
  hairline: 'rgba(255,255,255,0.08)',
};

// Accent is themeable. Default periwinkle.
export const ACCENTS = ['#8aa0ff', '#1ad1b0', '#f5c518', '#ff7a59', '#c061f0', '#5ad1ff'];
export const ACCENT_DEFAULT = '#8aa0ff';

export const layout = {
  railWidth: 110,
  drawerWidth: 480,
  contentLeft: 150,
  tileW: 432,
  tileH: 243,
  tileGap: 40,
  rowStep: 352,      // vertical pitch between rows (title 40 + 18 + tile 243 + 51)
  rowsTop: 600,      // y where the rows band starts
};

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const f = (i) => parseInt(h.slice(i, i + 2), 16);
  return { r: f(0), g: f(2), b: f(4) };
}
export function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Placeholder artwork gradient seeded from an item's hue pair.
 *  Replace <PosterArt> with a real <Image> in production. */
export function artStops(item, landscape = true) {
  const { hue, hue2 } = item;
  return {
    base: `hsl(${hue}, 30%, 12%)`,
    a: `hsla(${hue2}, 58%, 52%, 0.55)`,
    b: `hsla(${hue}, 60%, 30%, 0.85)`,
    c1: `hsl(${hue}, 44%, 22%)`,
    c2: `hsl(${hue2}, 40%, 9%)`,
    angle: landscape ? 118 : 158,
  };
}
