/**
 * Icon set — single SVG paths, rendered via react-native-svg.
 * Stroke icons (24×24 viewBox). Keep paths in one place so swapping is easy.
 */
import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

export const ICON_PATHS = {
  search: null, // drawn as circle+line below
  home: 'M3 11l9-8 9 8M5 9.5V20h5v-6h4v6h5V9.5',
  discover: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM14.8 9.2l-1.9 4.6-4.6 1.9 1.9-4.6z',
  library: 'M6 4h12v17l-6-4-6 4z',
  addons: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  party: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a3 3 0 0 0 0-6M21 20a6 6 0 0 0-4-5.6',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  friends: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a3 3 0 0 0 0-6M21 20a6 6 0 0 0-4-5.6',
  chevron: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  play: null, // filled triangle
  check: 'M5 13l4 4L19 7',
  close: 'M6 6l12 12M18 6L6 18',
};

export function Icon({ name, size = 26, color = '#fff', strokeWidth = 1.9 }) {
  if (name === 'search') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
        <Circle cx={11} cy={11} r={7} />
        <Path d="M21 21l-4.3-4.3" />
      </Svg>
    );
  }
  if (name === 'play') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <Path d="M8 5v14l11-7z" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <Path d={ICON_PATHS[name]} />
    </Svg>
  );
}
