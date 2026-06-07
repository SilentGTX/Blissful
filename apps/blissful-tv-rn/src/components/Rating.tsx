import type { ReactNode } from 'react';
import { Text, View, type TextStyle, type ViewStyle } from 'react-native';
import { ImdbIcon } from '../icons/ImdbIcon';
import { useImdbRating } from '../lib/useImdbRating';
import { font } from '../theme/colors';

// 1:1 port of apps/blissful-mvs/src/components/Rating.tsx: NUMBER (left) then the
// gold IMDb wordmark (right), no star. Renders nothing when there's no rating
// (<= 0 is suppressed). The wordmark is drawn in a SQUARE box like the web
// (h-7 w-7 etc.) so it sits centred with the same proportions.
export function Rating({
  imdbId,
  initialRating,
  numberSize,
  iconSize,
  numberColor = '#fff',
  gap,
  containerStyle,
  leading,
}: {
  imdbId?: string | null;
  initialRating?: string | number | null;
  numberSize: number;
  iconSize: number;
  numberColor?: string;
  gap: number;
  containerStyle?: ViewStyle; // e.g. the poster pill (bg + padding + position)
  leading?: ReactNode; // rendered before the number ONLY when a rating exists (e.g. a "·")
}) {
  const value = useImdbRating(imdbId ?? null, initialRating);
  if (value == null) return null;
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, containerStyle]}>
      {leading}
      <Text style={numberStyle(numberSize, numberColor)}>{value.toFixed(1)}</Text>
      {/* wordmark is ~2:1; iconSize is its height */}
      <ImdbIcon width={iconSize * 1.96} height={iconSize} />
    </View>
  );
}

function numberStyle(size: number, color: string): TextStyle {
  return { fontFamily: font.bodySemi, fontSize: size, color };
}
