# Blissful TV — Glass (fake-it) + iPhone-look Plan

I now have full grounding in the real DOM and CSS. Here is the decisive plan.

---

# Blissful TV — Liquid Glass + iPhone-Look Design Plan

Grounded in the actual code: `DesktopNav.tsx`, `NavItem.tsx`, `useGradientBackdrop.ts`, and `index.css` (the `html[data-tv]` layer at line 2052+, the `.bliss-content`/`--content-left-offset` system at line 107/185, and the netflix card overlay at 1305). Decisions below reference real selectors only.

---

## 1. Glass on TV: real or faked? — FAKE IT (with one narrow exception)

**Decision: the full-height nav rail is FAKE glass. No `backdrop-filter` on it. Ever.**

Two independent reasons, both confirmed in this repo:

- **It can't look right.** `useGradientBackdrop.ts` sets `--dynamic-bg` to either a dark gradient (classic) or the solid `NETFLIX_BG`. `backdrop-filter` only samples the pixels *directly behind* the element. Behind the rail there is nothing but a near-uniform dark gradient, so `blur(24px) saturate(180%)` (current code, index.css:2106) has nothing to amplify — it collapses to flat dark. That is exactly the reported symptom. No tuning fixes a dark backdrop.
- **It's the pathological perf case on TV.** A full-height, always-on blur forces a continuous re-blur of a tall region on every focus animation, hero transition, or playing video on Mali-G31-class GPUs. And a real subset of TV WebViews (Fire TV / locked set-top boxes on Blink 58/59, pre-Chrome-76) don't support the property at all — the rail would render as a bare translucent gradient with no legibility guarantee.

Because what's behind the rail is **static and known**, we bake "glass-over-this-gradient" directly into the rail's own background. The eye reads glass from the specular lip + edge catchlight + float shadow, not from per-pixel blur. Zero per-frame GPU cost, identical look on every TV including pre-76 WebViews.

### Fake-glass rail (the default, ALL TVs) — replaces index.css:2100-2113

```css
html[data-tv] .bliss-sidebar > .solid-surface {
  /* Faked liquid glass — pre-baked translucent gradient, NO live blur.
     Legibility comes from the baked dark-tint layer, not from blur, so this
     stays readable even on pre-76 WebViews that ignore backdrop-filter. */
  background:
    linear-gradient(160deg, rgba(255,255,255,0.12), rgba(255,255,255,0.035)),
    linear-gradient(160deg, rgba(124,144,176,0.10), rgba(18,24,36,0.20)) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  border: 1px solid rgba(255,255,255,0.14) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.34),   /* top specular lip — sells the glass */
    inset -1px 0 0 rgba(255,255,255,0.06),  /* right-edge catchlight */
    inset 0 0 40px rgba(255,255,255,0.04),  /* faint interior bloom */
    0 24px 60px rgba(0,0,0,0.45) !important;/* float / depth */
}
```

### Real blur: ONLY the small static search pill, capability- AND opt-in-gated

`@supports` only tells you the property *parses*, not that it *performs* — a slow GPU still "supports" it. So real blur is double-gated: `@supports` for correctness + an explicit `data-effects="rich"` flag set at runtime after a cheap capability probe. Default = no flag = fake path, so the cheapest box and old WebViews never touch the property.

```css
/* Default pill: static glass, no blur (this is what ALL TVs get). */
html[data-tv] .tv-topbar-search,
html[data-tv] .tv-topbar-profile {
  background: linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.05));
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: 1px solid rgba(255,255,255,0.18);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.35),
    0 12px 40px rgba(0,0,0,0.35);
}

/* Real blur only when BOTH the property is supported AND a runtime probe opted in. */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  html[data-tv][data-effects="rich"] .tv-topbar-search,
  html[data-tv][data-effects="rich"] .tv-topbar-profile {
    backdrop-filter: blur(8px) saturate(160%);
    -webkit-backdrop-filter: blur(8px) saturate(160%);
  }
}
```

Also lower the existing pill blur from `22px` to `8px` regardless (index.css:2138, 2179) — on a small element the perceptual difference is nil and 22px is needlessly heavy. Set `data-effects="rich"` on `<html>` only after a one-rAF probe or a known-good-device allowlist; never on the tall rail.

**"Compatible with ALL TVs":** the fake path is the default and uses no GPU effects and no `backdrop-filter` property — it renders pixel-identically on Blink-58 Fire TV WebViews and on the newest Chromium. Real blur is purely additive on capable, opted-in devices. There is no device where the UI degrades to unreadable.

---

## 2. iPhone-like recipe over the dark bg

Apple's look = **content slides under a translucent nav**, a bright tint, a crisp specular top edge, a hairline border, boosted saturation, and a faint grain. Here's the exact recipe against our real selectors.

### a. Content goes UNDER the rail; first cards stay visible AND focusable

The rail is already an overlay on TV (`--vertical-nav-bar-size` is pinned to the collapsed width at index.css:2065, and the rail expands over content). To get the iPhone "content peeks under the glass" effect, set the content's left to `0` and replace the offset with **padding + scroll-padding** equal to the collapsed rail width. Padding keeps the first poster peeking just past the rail edge; matching `scroll-padding-inline-start` guarantees D-pad `scrollIntoView` never parks a focused card *under* the rail.

```css
html[data-tv] .bliss-content {
  left: 0;
  padding-left: var(--tv-rail-collapsed);
  scroll-padding-inline-start: var(--tv-rail-collapsed);
  top: calc(var(--tv-safe-y) + var(--tv-topbar-h) + 1rem); /* keep existing top */
}
/* The horizontal poster rails already scroll; ensure their snap padding clears
   the nav so the first card is never stranded behind the glass. */
html[data-tv] .board-row-poster,
html[data-tv] .netflix-rail {
  scroll-padding-inline-start: calc(var(--tv-rail-collapsed) + var(--tv-safe-x));
}
```

### b. Tint / highlight / border / saturation / grain (exact values)

These are baked into the rail surface (the `.solid-surface` block in §1). The Apple-tuned values:

| Property | Value | Role |
|---|---|---|
| Tint (top→bottom) | `rgba(255,255,255,0.12)` → `0.035)` | bright translucent glass body |
| Dark legibility under-layer | `rgba(18,24,36,0.20)` | keeps text readable without blur |
| Specular highlight | `inset 0 1px 0 rgba(255,255,255,0.34)` | the top "glass lip" |
| Edge catchlight | `inset -1px 0 0 rgba(255,255,255,0.06)` | right edge catches light |
| Border (hairline) | `1px solid rgba(255,255,255,0.14)` | crisp Apple edge |
| Saturation | bake a slightly cooler-blue secondary gradient (`rgba(124,144,176,0.10)`) instead of live `saturate()` — same vibrancy, zero GPU |
| Grain | `::before` static noise PNG at `opacity:0.05`, `mix-blend-mode:overlay` |

Grain (breaks the flatness, mimics frosted texture, still zero per-frame cost):

```css
html[data-tv] .bliss-sidebar > .solid-surface::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background-image: url("/noise.png");      /* tiny tiled grain, ~128px */
  background-size: 128px 128px;
  opacity: 0.05;
  mix-blend-mode: overlay;
  pointer-events: none;
}
```

(Avoid SVG `feTurbulence` filters in Chromium TV WebViews — slow and inconsistent. Use a tiny static PNG.)

### c. Expand-on-focus glass over posters

The desktop `.netflix-card-overlay` (index.css:1305) only fires on `:hover`, which never triggers from a D-pad. On TV, drive the same glass panel from `[data-focused="true"]`, and make it an iPhone-style frosted info sheet that **expands up** from the bottom of the focused poster — a baked translucent panel (no `backdrop-filter`, since the poster behind it is dark at the bottom anyway).

```css
/* D-pad focus drives the overlay (hover never fires from a remote). */
html[data-tv] .netflix-card-wrap:has([data-focused="true"]) .netflix-card-overlay,
html[data-tv] .tv-focusable-card[data-focused="true"] ~ .netflix-card-overlay {
  opacity: 1;
  pointer-events: auto;
}
/* Frosted info sheet rising from the poster bottom on focus. Baked glass,
   no live blur — the lower poster region is dark so a translucent panel reads
   as frosted without sampling. */
html[data-tv] .netflix-card-overlay {
  background:
    linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(10,14,22,0.55) 70%, rgba(10,14,22,0.85) 100%),
    linear-gradient(180deg, rgba(255,255,255,0) 60%, rgba(255,255,255,0.06) 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18); /* specular lip on the sheet */
}
```

Use the existing focus enlarge (`.netflix-card-focus-width`, index.css:1671/1701) as the "expand" motion; the overlay sheet fades in over it.

---

## 3. Nav sizing (exact)

Detach the TV rail from the desktop-derived `.nav-icon-slot` math (index.css:675, `calc(clamp(128px,7vw,200px) - 4.5rem - 2px)`) — that fixed slot is what pushes the icon left and leaves dead space on the right. Target M3 Expressive's 96dp tier (sized up from Google's 80dp baseline for 10-foot distance).

| Dimension | Value | Source / rationale |
|---|---|---|
| **Collapsed width** | `96px` | M3 Expressive container; Netflix/Google TV/YouTube TV icon rails sit in the 72–96px band. Current `clamp(88px,5.2vw,116px)` (index.css:2055) tops out too wide and reads as a half-open drawer. |
| **Icon size** | `28px` | 28/96 ≈ 0.29 glyph-to-rail ratio, matching Google TV/Netflix. Single source of truth — overrides both the inline `clamp(1.25rem,1.1vw,2rem)` in NavItem.tsx:83 and the `.nav-icon-slot svg` rule at index.css:2081. |
| **Centering** | icon slot `width:100%`, `justify-center`, in a **full-width row** (drop the `mx-4`/`w-[calc(100%-2rem)]` on TV) | Scaling the icon then grows it symmetrically about the rail centerline — no horizontal jump on collapse/expand. |
| **Active/focus pill** | `56px × 56px`, centered (`left:50%; translateX(-50%)`), `border-radius:18px` | M3 active-indicator scale for an icon rail; hugs the glyph instead of spanning the wide row. |
| **Row height** | `64px` | M3 Expressive item min-height; clears the 48dp D-pad hit-target minimum with margin. Standardizes the current inconsistent `clamp(56px,7vh,84px)`. |
| **Expanded width** | `320px` | Matches Netflix/Google TV labeled drawer. "Join Party" (longest label) fits in 320 − 96 gutter − padding ≈ 200px; bump to 360px only if it truncates on a real device. |

On expand, the icon slot snaps to a fixed `96px` left gutter (= collapsed width) so the icon does **not** move horizontally when labels appear; the row switches to `justify-content:flex-start`.

**Two wiring caveats** (must be handled in JSX, not CSS):
- The active pill in NavItem.tsx:68-73 is a `motion.div` with `className="absolute inset-0 ..."` and **no stable class** — add `nav-active-pill` to it so snippet 5 below can target it (or target the `layoutId="nav-active-desktop"` element directly).
- The 28px icon is set in two places — neutralize the inline Tailwind clamp on TV; the index.css rule below wins by specificity but remove the duplication to avoid future drift.
- The 96px row + 3px outline + 6px ring (focus ring, index.css:2217) must not clip: `.bliss-vertical-nav` already sets `overflow:visible` (index.css:2068), but `.solid-surface` at DesktopNav.tsx:128 has `overflow-hidden`. Keep ~6px internal row padding so the ring isn't clipped at the rail edge.

---

## 4. Concrete CSS — drop into the `html[data-tv]` layer

Replace the rail variables (index.css:2055-2056), the `.solid-surface` blur block (2100-2113), the collapsed-center rules (2190-2195), and the icon-svg rule (2081-2084) with the following. Everything else is additive.

```css
/* ── TV nav rail sizing: true 96px M3-Expressive icon rail ───────────── */
html[data-tv] {
  --tv-rail-collapsed: 96px;   /* icon rail (Google TV/Netflix band 72–96) */
  --tv-rail-expanded: 320px;   /* labeled drawer */
}

/* Full-width centered row — kill the desktop slot math & mx-4 on TV. */
html[data-tv] .nav-icon-slot { width: 100%; }
html[data-tv] .bliss-sidebar-link {
  margin-left: 0;
  margin-right: 0;
  width: 100%;
  height: 64px;
  padding-inline: 6px;          /* breathing room so the focus ring isn't clipped */
  justify-content: center;      /* collapsed: icon on the rail centerline */
}
html[data-tv] .nav-icon-slot svg { width: 28px; height: 28px; }

/* Centered 56px active/focus pill (requires adding `nav-active-pill` to the
   motion.div in NavItem.tsx, OR retarget [data-focused] below). */
html[data-tv] .bliss-sidebar-link .nav-active-pill,
html[data-tv] .bliss-sidebar-link[data-focused="true"]::before {
  width: 56px; height: 56px;
  left: 50%; right: auto;
  transform: translateX(-50%);
  border-radius: 18px;
}

/* Expanded: fixed 96px icon gutter so the glyph doesn't shift; labels align. */
html[data-tv] .bliss-sidebar[data-rail-expanded="true"] .nav-icon-slot {
  width: 96px; flex: 0 0 96px;
}
html[data-tv] .bliss-sidebar[data-rail-expanded="true"] .bliss-sidebar-link {
  justify-content: flex-start;
}

/* ── Faked liquid glass on the rail (default for ALL TVs, no blur) ────── */
html[data-tv] .bliss-sidebar > .solid-surface {
  background:
    linear-gradient(160deg, rgba(255,255,255,0.12), rgba(255,255,255,0.035)),
    linear-gradient(160deg, rgba(124,144,176,0.10), rgba(18,24,36,0.20)) !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  border: 1px solid rgba(255,255,255,0.14) !important;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.34),
    inset -1px 0 0 rgba(255,255,255,0.06),
    inset 0 0 40px rgba(255,255,255,0.04),
    0 24px 60px rgba(0,0,0,0.45) !important;
}
html[data-tv] .bliss-sidebar > .solid-surface::before {
  content: ""; position: absolute; inset: 0; border-radius: inherit;
  background-image: url("/noise.png"); background-size: 128px 128px;
  opacity: 0.05; mix-blend-mode: overlay; pointer-events: none;
}

/* ── iPhone content-under-nav: peek + keep first card focusable ──────── */
html[data-tv] .bliss-content {
  left: 0;
  padding-left: var(--tv-rail-collapsed);
  scroll-padding-inline-start: var(--tv-rail-collapsed);
}
html[data-tv] .board-row-poster,
html[data-tv] .netflix-rail {
  scroll-padding-inline-start: calc(var(--tv-rail-collapsed) + var(--tv-safe-x));
}

/* ── Static glass topbar (default no blur; real blur only when opted in) ─ */
html[data-tv] .tv-topbar-search,
html[data-tv] .tv-topbar-profile {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  html[data-tv][data-effects="rich"] .tv-topbar-search,
  html[data-tv][data-effects="rich"] .tv-topbar-profile {
    backdrop-filter: blur(8px) saturate(160%);
    -webkit-backdrop-filter: blur(8px) saturate(160%);
  }
}

/* ── Expand-on-focus frosted sheet over posters (D-pad, not hover) ────── */
html[data-tv] .netflix-card-wrap:has([data-focused="true"]) .netflix-card-overlay {
  opacity: 1; pointer-events: auto;
}
html[data-tv] .netflix-card-overlay {
  background:
    linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(10,14,22,0.55) 70%, rgba(10,14,22,0.85) 100%),
    linear-gradient(180deg, rgba(255,255,255,0) 60%, rgba(255,255,255,0.06) 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
}
```

### Required JSX edits (CSS alone can't do these)
- **NavItem.tsx:70** — add `nav-active-pill` to the active `motion.div` className (currently `absolute inset-0 rounded-2xl bg-white/[0.08] ...`) so the centered-pill rule binds. Alternatively retarget the rule at the `layoutId="nav-active-desktop"` node.
- **NavItem.tsx:83** — neutralize the inline icon clamp on TV (the 28px CSS rule wins by specificity, but remove the duplication).
- **Runtime** — set `document.documentElement.dataset.effects = "rich"` only after a one-rAF capability probe or a known-good-device allowlist; default everything to the fake path.
- **Asset** — add a ~128px tiled `noise.png` to `public/` for the grain `::before`.

### Risk notes
- Keep `!important` on the rail rules — HeroUI/Tailwind `solid-surface bg-white/6` base styles (DesktopNav.tsx:128) will otherwise win.
- `:has()` is supported on Chromium 105+; on a pre-105 TV WebView the focus-overlay falls back to invisible (acceptable — the focus ring still shows). If you must support pre-105, mirror it with a sibling-combinator selector keyed off `.tv-focusable-card[data-focused="true"]` as already used at index.css:2232.
- `96px` is a fixed px (not a clamp) — correct because Android TV WebViews report ~1920 CSS px at both 1080p and 4K (DPR handles scaling). Verify the real CSS viewport on a target panel; if one reports 3840 CSS px, switch to `clamp(96px, 5vw, 128px)`.

**Files touched:** `D:\blissfullll\Blissful\apps\blissful-mvs\src\index.css` (rail vars 2055-2056, glass block 2100-2113, collapsed-center 2190-2195, icon svg 2081-2084, content offset 2086-2088, topbar blur 2138/2179), `D:\blissfullll\Blissful\apps\blissful-mvs\src\components\SideNav\NavItem.tsx` (lines 70, 83), and a new `D:\blissfullll\Blissful\apps\blissful-mvs\public\noise.png`.