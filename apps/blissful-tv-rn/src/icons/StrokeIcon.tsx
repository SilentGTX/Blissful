import { useId } from 'react';
import Svg, { Defs, FeDropShadow, Filter, Path } from 'react-native-svg';

// 1:1 port of apps/blissful-mvs/src/icons/StrokeIcon.tsx — viewBox 24,
// fill none, stroke currentColor, strokeWidth 1.8, round caps/joins.
// `glow` adds the active-item drop-shadow (old: drop-shadow(0 0 10px accentGlow)).
export function StrokeIcon({
  path,
  size = 20,
  color,
  strokeWidth = 1.8,
  glow,
}: {
  path: string;
  size?: number;
  color: string;
  strokeWidth?: number;
  glow?: string;
}) {
  const id = useId().replace(/[:]/g, '');
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {glow ? (
        <Defs>
          <Filter id={id} x="-60%" y="-60%" width="220%" height="220%">
            <FeDropShadow dx="0" dy="0" stdDeviation="1.3" floodColor={glow} floodOpacity="0.95" />
          </Filter>
        </Defs>
      ) : null}
      <Path
        d={path}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={glow ? `url(#${id})` : undefined}
      />
    </Svg>
  );
}

// Exact icon paths from apps/blissful-mvs/src/components/SideNav/utils.ts ICONS.
export const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v6H4a1 1 0 0 1-1-1v-10.5Z',
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  discover:
    'M12 22a10 10 0 1 0-10-10 10 10 0 0 0 10 10Zm3.5-13.5-2.2 6.8a1 1 0 0 1-.6.6l-6.8 2.2 2.2-6.8a1 1 0 0 1 .6-.6l6.8-2.2Z',
  library:
    'M6.5 5.5h10a2 2 0 0 1 2 2v12.25a.75.75 0 0 1-1.12.65L12 17.25 6.62 20.4a.75.75 0 0 1-1.12-.65V7.5a2 2 0 0 1 2-2Z',
  addons: 'M4 7.5h16M4 12h16M4 16.5h16M7.5 4v16',
  settings:
    'M12 2.25a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5a.75.75 0 0 1 .75-.75Zm0 4.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0v-7.5a.75.75 0 0 1 .75-.75Zm6-4.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5a.75.75 0 0 1 .75-.75Zm0 4.5a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0v-7.5a.75.75 0 0 1 .75-.75Zm-12 0a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0v-7.5a.75.75 0 0 1 .75-.75Zm6 9a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5a.75.75 0 0 1 .75-.75Z',
  logout: 'M10 7V5a2 2 0 0 1 2-2h7v18h-7a2 2 0 0 1-2-2v-2m-6-5h10m0 0-3-3m3 3-3 3',
  continue: 'M12 8v5l3 2M21 12a9 9 0 1 1-9-9',
  watchParty:
    'M9 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 20a6 6 0 0 1 12 0H3Zm10 0a8 8 0 0 1 .7-3.2A6 6 0 0 1 21 20h-8Z',
} as const;
