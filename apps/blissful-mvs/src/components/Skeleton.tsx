/**
 * Skeleton screen primitives and composed layouts.
 * Uses CSS shimmer animation (no JS-driven layout thrash).
 * Styled to match the liquid glass design system.
 */

// ─── CSS Shimmer keyframes (injected once) ──────────────────────────────────

const SHIMMER_STYLE_ID = 'bliss-skeleton-shimmer';

if (typeof document !== 'undefined' && !document.getElementById(SHIMMER_STYLE_ID)) {
  const style = document.createElement('style');
  style.id = SHIMMER_STYLE_ID;
  style.textContent = `
    @keyframes bliss-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    .bliss-shimmer {
      background: linear-gradient(
        90deg,
        rgba(255,255,255,0.04) 25%,
        rgba(255,255,255,0.08) 50%,
        rgba(255,255,255,0.04) 75%
      );
      background-size: 200% 100%;
      animation: bliss-shimmer 1.8s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
}

// ─── Primitives ─────────────────────────────────────────────────────────────

export function SkeletonBox({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={`bliss-shimmer rounded-[28px] bg-white/6 backdrop-blur ${className}`}
      style={style}
    />
  );
}

export function SkeletonText({
  width = '100%',
  height = '0.875rem',
  className = '',
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
}) {
  return (
    <div
      className={`bliss-shimmer rounded-lg bg-white/6 ${className}`}
      style={{ width, height }}
    />
  );
}

export function SkeletonPoster({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bliss-shimmer aspect-[2/3] w-full rounded-2xl bg-white/6 ${className}`}
    />
  );
}

// ─── Composed Layouts ───────────────────────────────────────────────────────

/** Matches MediaRail / MediaRailMobile layout: title bar + horizontal row of posters. */
export function SkeletonHomeRow({ count = 6 }: { count?: number }) {
  return (
    <section className="space-y-3">
      {/* Title bar */}
      <div className="flex items-center justify-between gap-4">
        <SkeletonText width="40%" height="1.25rem" />
        <SkeletonText width="3rem" height="1rem" />
      </div>
      {/* Poster row */}
      <div className="flex gap-5 overflow-hidden">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="w-[160px] flex-shrink-0 sm:w-[180px] lg:w-[200px]">
            <SkeletonPoster />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Matches DetailPage meta layout: backdrop + poster + title lines + description. */
export function SkeletonDetailPanel() {
  return (
    <div className="space-y-6 p-4 lg:p-8">
      {/* Backdrop placeholder */}
      <SkeletonBox className="h-[200px] w-full lg:h-[300px]" />
      <div className="flex gap-4">
        {/* Poster */}
        <div className="w-[120px] flex-shrink-0 lg:w-[160px]">
          <SkeletonPoster />
        </div>
        {/* Meta text */}
        <div className="flex flex-1 flex-col gap-3 pt-2">
          <SkeletonText width="80%" height="1.5rem" />
          <SkeletonText width="50%" height="1rem" />
          <SkeletonText width="60%" height="0.875rem" />
          <div className="mt-2 flex gap-2">
            <SkeletonText width="4rem" height="1.5rem" className="rounded-full" />
            <SkeletonText width="4rem" height="1.5rem" className="rounded-full" />
            <SkeletonText width="4rem" height="1.5rem" className="rounded-full" />
          </div>
        </div>
      </div>
      {/* Description lines */}
      <div className="space-y-2">
        <SkeletonText width="100%" />
        <SkeletonText width="95%" />
        <SkeletonText width="80%" />
      </div>
    </div>
  );
}

/** Matches SearchPage results grid: 4-column grid of poster skeletons. */
export function SkeletonSearchGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonPoster key={i} />
      ))}
    </div>
  );
}
