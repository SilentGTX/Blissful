import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

// The web TV UI (apps/web-blissful, html[data-tv]) is authored at a fixed
// 1920x1080 viewport (index.html `<meta viewport width=1920>`), using
// clamp(px, vw|vh, px) units. We replicate it 1:1 by scaling those EXACT CSS
// values to the current RN screen. `s(px)` maps a 1920-design px to dp; the
// clamp* helpers mirror CSS clamp() (px bounds scaled, the vw/vh term is % of
// the live screen). Source values are quoted from index.css next to each.
export function useMetrics() {
  const { width, height } = useWindowDimensions();
  // Memoise on [width, height]: every card calls useMetrics(); without this each
  // render rebuilt the object + the `s` closure, defeating downstream memo and
  // adding work to every focus move / list render.
  return useMemo(() => buildMetrics(width, height), [width, height]);
}

function buildMetrics(width: number, height: number) {
  const scale = width / 1920;
  const s = (px: number) => px * scale;
  const clampVw = (minPx: number, pct: number, maxPx: number) =>
    Math.min(Math.max(minPx * scale, (pct / 100) * width), maxPx * scale);
  const clampVh = (minPx: number, pct: number, maxPx: number) =>
    Math.min(Math.max(minPx * scale, (pct / 100) * height), maxPx * scale);

  const safeX = (5 / 100) * width; // --tv-safe-x: 5vw
  const safeY = (4 / 100) * height; // --tv-safe-y: 4vh
  const railCollapsed = clampVw(96, 5, 132); // --tv-rail-collapsed: clamp(96px,5vw,132px)
  const railExpanded = clampVw(340, 22, 420); // --tv-rail-expanded: clamp(340px,22vw,420px)
  const topbarH = clampVh(56, 7, 84); // --tv-topbar-h: clamp(56px,7vh,84px)

  return {
    width,
    height,
    scale,
    s,
    safeX,
    safeY,
    railCollapsed,
    railExpanded,
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
    // Rail labels. NOT a port of the web sidebar's clamp: the web value is sized
    // for a desk monitor, and at 1920-design px it lands near 16 — which on a TV
    // panel IS 16 physical px (a 1080p TV reports ~960dp, so s() halves), under
    // half Android TV's ~18sp floor and the smallest type in the app. Sized here
    // as 10-foot type instead, between the card title (19) and the row title
    // (35), matching the top bar's search/profile text.
    navLabel: clampVw(20, 1.4, 28), // primary rail items
    navLabelSm: clampVw(17, 1.15, 23), // secondary rail text (hints, list rows)
    navBrand: clampVw(24, 1.7, 34), // the "Blissful" wordmark at the rail's top
  };
}
