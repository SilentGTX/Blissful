import { useWindowDimensions } from 'react-native';

// The web TV UI (apps/blissful-mvs, html[data-tv]) is authored at a fixed
// 1920x1080 viewport (index.html `<meta viewport width=1920>`), using
// clamp(px, vw|vh, px) units. We replicate it 1:1 by scaling those EXACT CSS
// values to the current RN screen. `s(px)` maps a 1920-design px to dp; the
// clamp* helpers mirror CSS clamp() (px bounds scaled, the vw/vh term is % of
// the live screen). Source values are quoted from index.css next to each.
export function useMetrics() {
  const { width, height } = useWindowDimensions();
  const scale = width / 1920;
  const s = (px: number) => px * scale;
  const clampVw = (minPx: number, pct: number, maxPx: number) =>
    Math.min(Math.max(minPx * scale, (pct / 100) * width), maxPx * scale);
  const clampVh = (minPx: number, pct: number, maxPx: number) =>
    Math.min(Math.max(minPx * scale, (pct / 100) * height), maxPx * scale);

  const safeX = (5 / 100) * width; // --tv-safe-x: 5vw
  const safeY = (4 / 100) * height; // --tv-safe-y: 4vh
  const railCollapsed = clampVw(96, 5, 132); // --tv-rail-collapsed: clamp(96px,5vw,132px)
  const topbarH = clampVh(56, 7, 84); // --tv-topbar-h: clamp(56px,7vh,84px)

  return {
    width,
    height,
    scale,
    s,
    safeX,
    safeY,
    railCollapsed,
    topbarH,
    // .bliss-content { left: rail + safe-x; top: safe-y + topbar + 1rem }
    contentLeft: railCollapsed + safeX,
    contentTop: safeY + topbarH + s(16),
    heroMinH: clampVh(420, 52, 640), // .now-popular-hero-inner min-height
    heroTitle: clampVw(32, 3, 56), // .tv-hero-title (2rem..3vw..3.5rem)
    railTitle: clampVw(24, 1.8, 36), // .tv-rail-title (1.5rem..1.8vw..2.25rem)
    cardTitle: clampVw(16, 1, 21.6), // .tv-card-title (1rem..1vw..1.35rem)
    searchW: clampVw(420, 48, 820), // .tv-topbar-search width
    searchFont: clampVw(17.6, 1.3, 24), // search input (1.1rem..1.3vw..1.5rem)
    profileFont: clampVw(19.2, 1.4, 27.2), // .tv-topbar-profile (1.2rem..1.4vw..1.7rem)
    navIcon: clampVw(26, 1.6, 30), // .nav-icon-slot svg
    navItemH: clampVh(60, 4.4, 76), // .bliss-sidebar-link height
  };
}
