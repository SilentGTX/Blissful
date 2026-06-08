import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { normalizeStremioImage } from '@blissful/core';
import { useTvFocusable } from '../lib/useTvFocusable';
import { Img } from './Img';
import { Rating } from './Rating';
import { POSTER_RATIO, type CardItem } from './PosterCard';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';

// A PosterCard clone for the Library grid that adds HOLD-OK removal
// (onLongPress -> onLongSelect). The shared PosterCard has no long-press, and
// editing it is out of scope here, so this is a dedicated wrapper. Visuals are
// identical: lavender focus ring + 1.06 scale, IMDb pill, bottom progress bar,
// title that turns lavender on focus.
//
// Mirrors the web TV LibraryPage: on TV, removal is hold-OK on the card
// (onItemLongPress) rather than the mouse-only X overlay.

const IMDB_RE = /^tt\d{5,}$/;

type M = ReturnType<typeof useMetrics>;

const PosterVisual = memo(function PosterVisual({
  item,
  width,
  focused,
  progress,
  m,
}: {
  item: CardItem;
  width: number;
  focused: boolean;
  progress?: number;
  m: M;
}) {
  const poster = normalizeStremioImage(item.poster);
  const h = width * POSTER_RATIO;
  return (
    <>
      <View
        style={[
          styles.posterWrap,
          { width, height: h, borderRadius: m.s(16), borderWidth: 1 },
          focused && { borderColor: colors.accent, transform: [{ scale: 1.06 }] },
        ]}
      >
        {poster ? (
          <Img uri={poster} style={styles.poster} contentFit="cover" />
        ) : (
          <View style={[styles.poster, styles.posterEmpty]}>
            <Text style={{ fontFamily: font.body, color: colors.textDim, fontSize: m.s(22), textAlign: 'center' }} numberOfLines={3}>
              {item.name}
            </Text>
          </View>
        )}
        <Rating
          imdbId={IMDB_RE.test(item.id) ? item.id : null}
          initialRating={item.imdbRating}
          numberSize={m.s(22)}
          iconSize={m.s(22)}
          gap={m.s(5)}
          containerStyle={{ position: 'absolute', left: m.s(12), top: m.s(12), borderRadius: radius.pill, paddingLeft: m.s(11), paddingRight: m.s(8), paddingVertical: m.s(4), backgroundColor: 'rgba(0,0,0,0.45)' }}
        />
        {progress != null && progress > 0 ? (
          <View style={{ position: 'absolute', bottom: m.s(12), left: m.s(12), right: m.s(12), height: m.s(6), borderRadius: radius.pill, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)' }}>
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${Math.min(100, progress)}%`, backgroundColor: colors.accent }} />
          </View>
        ) : null}
      </View>
      <Text
        style={{ fontFamily: font.bodyMed, color: focused ? colors.accent : colors.textDim, fontSize: m.cardTitle, marginTop: m.s(17), textAlign: 'center' }}
        numberOfLines={2}
      >
        {item.name}
      </Text>
    </>
  );
});

export function LibraryPosterCard({
  item,
  width,
  autoFocus,
  atRowStart,
  progress,
  onSelect,
  onLongSelect,
}: {
  item: CardItem;
  width: number;
  autoFocus?: boolean;
  atRowStart?: boolean;
  progress?: number;
  onSelect: (item: CardItem) => void;
  onLongSelect?: (item: CardItem) => void;
}) {
  const m = useMetrics();
  const { focused, focusProps } = useTvFocusable({
    atRowStart,
    autoFocus,
    onPress: () => onSelect(item),
    onLongPress: onLongSelect ? () => onLongSelect(item) : undefined,
  });

  return (
    <Pressable {...focusProps} style={{ width }}>
      <PosterVisual item={item} width={width} focused={focused} progress={progress} m={m} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  posterWrap: { borderColor: 'transparent', overflow: 'hidden' },
  poster: { width: '100%', height: '100%', backgroundColor: colors.surface },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', padding: 8 },
});
