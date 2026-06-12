import type { ReactNode } from 'react';
import { Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { ImdbIcon } from '../icons/ImdbIcon';
import { useImdbRating } from '../lib/useImdbRating';
import { font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';

// THE one IMDb rating component: NUMBER (left) + gold IMDb wordmark (right), no
// star. Every rating in the app goes through this so they all read the same — the
// only knob is a `size` VARIANT (sm / md / lg). Sizes are 1920-design px scaled
// internally via `m.s()`, so callers just pick a variant (and optionally `badge`
// for the dark pill used on poster / still overlays). Renders nothing when there's
// no rating (<= 0 suppressed). 1:1 with apps/web-blissful/src/components/Rating.tsx.

export type RatingSize = 'sm' | 'md' | 'lg';

// number = the digits' fontSize; icon = the wordmark HEIGHT (it's ~2:1 wide);
// gap = space between them. All in 1920-design px (scaled by m.s at render).
const RATING_SIZES: Record<RatingSize, { number: number; icon: number; gap: number }> = {
  sm: { number: 16, icon: 17, gap: 5 }, // card / still overlay badges
  md: { number: 22, icon: 23, gap: 6 }, // inline meta rows, poster badges
  lg: { number: 26, icon: 27, gap: 7 }, // hero / home InfoPanel meta
};

export function Rating({
  imdbId,
  initialRating,
  size = 'md',
  numberColor = '#fff',
  badge = false,
  containerStyle,
  leading,
}: {
  imdbId?: string | null;
  initialRating?: string | number | null;
  /** Visual size scale — sm (card overlays), md (meta rows / poster badges), lg (hero). */
  size?: RatingSize;
  numberColor?: string;
  /** Wrap in the standard dark pill (poster / episode-still overlay badge). */
  badge?: boolean;
  /** Positioning / extra layout (e.g. `position:'absolute', left, top` on a card). */
  containerStyle?: ViewStyle;
  /** Rendered before the number ONLY when a rating exists (e.g. a "·" separator). */
  leading?: ReactNode;
}) {
  const m = useMetrics();
  const value = useImdbRating(imdbId ?? null, initialRating);
  if (value == null) return null;
  const sz = RATING_SIZES[size];
  return (
    <View
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: m.s(sz.gap) },
        badge && {
          borderRadius: radius.pill,
          paddingLeft: m.s(10),
          paddingRight: m.s(8),
          paddingVertical: m.s(4),
          backgroundColor: 'rgba(0,0,0,0.55)',
        },
        containerStyle,
      ]}
    >
      {leading}
      <Text style={numberStyle(m.s(sz.number), numberColor)}>{value.toFixed(1)}</Text>
      {/* wordmark is ~2:1; icon is its height */}
      <ImdbIcon width={m.s(sz.icon) * 1.96} height={m.s(sz.icon)} />
    </View>
  );
}

function numberStyle(size: number, color: string): TextStyle {
  return { fontFamily: font.bodySemi, fontSize: size, color };
}
