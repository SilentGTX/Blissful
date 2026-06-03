// Leading icons for the Discover filter dropdowns (Content Type / Sort /
// Genre / Year), matching the mockup. Simple stroke SVGs, 24x24, currentColor.

type IconProps = { className?: string };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Content type — a clapperboard. */
export function ContentTypeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 9.5h18V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M3.4 9.5 4.6 5.2 19.8 5.2 18.6 9.5" />
      <path d="M8 5.2 9.6 9.5M13 5.2 14.6 9.5" />
    </svg>
  );
}

/** Sort — a trending-up line. */
export function SortIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </svg>
  );
}

/** Genre — a theatre mask. */
export function GenreIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 4.5h14v4.5a7 7 0 0 1-14 0z" />
      <circle cx="9.3" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="14.7" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
      <path d="M9.5 12a2.6 2 0 0 0 5 0" />
    </svg>
  );
}

/** Year — a calendar. */
export function YearIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="2.5" x2="8" y2="6" />
      <line x1="16" y1="2.5" x2="16" y2="6" />
    </svg>
  );
}
