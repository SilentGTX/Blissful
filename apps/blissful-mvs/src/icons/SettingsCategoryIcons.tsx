// Settings category icon set. One clean stroke SVG per settings category
// (plus a header gear) used by the two-column SettingsPage layout. Each is a
// 24x24 stroke icon (fill none, currentColor, width 2, round caps/joins) so it
// renders crisply at ~20px and inherits text color for the accent active state.

type IconProps = {
  className?: string;
};

// Shared <svg> wrapper props so every category icon stays geometrically
// consistent. Spread first, then the per-icon paths.
const svgProps = {
  viewBox: '0 0 24 24',
  width: 24,
  height: 24,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

// Header cog — the standard Feather "settings" gear.
export function SettingsGearIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

// Appearance — paintbrush.
export function AppearanceIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M9.5 14.5 4 20l3.5-1.5" />
      <path d="m14.5 4.5 5 5L11 18l-5-5 8.5-8.5z" />
      <path d="m13 6 5 5" />
    </svg>
  );
}

// Player — play triangle inside a circle.
export function PlayerIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5 16 12l-6 3.5z" />
    </svg>
  );
}

// Playback — monitor / display.
export function PlaybackIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8" />
      <path d="M12 16v4" />
    </svg>
  );
}

// Streaming — stacked server racks.
export function StreamingIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <path d="M7 7h.01" />
      <path d="M7 17h.01" />
    </svg>
  );
}

// Account — person head + shoulders.
export function AccountIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
    </svg>
  );
}

// Linked Accounts — chain link.
export function LinkedAccountsIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.41 4.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.42-1.4" />
    </svg>
  );
}

// Advanced — horizontal sliders with knobs.
export function AdvancedIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <path d="M4 7h11" />
      <path d="M19 7h1" />
      <circle cx="17" cy="7" r="2" />
      <path d="M4 17h5" />
      <path d="M13 17h7" />
      <circle cx="11" cy="17" r="2" />
    </svg>
  );
}

// About — info circle.
export function AboutIcon({ className }: IconProps) {
  return (
    <svg className={className} {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
