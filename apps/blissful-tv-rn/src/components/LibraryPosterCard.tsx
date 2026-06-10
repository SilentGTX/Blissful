import { memo, useEffect, useRef, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { normalizeStremioImage } from '@blissful/core';
import { useTvFocusable } from '../lib/useTvFocusable';
import { Img } from './Img';
import { Rating } from './Rating';
import { POSTER_RATIO, type CardItem } from './PosterCard';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';

// A PosterCard clone for the Library grid that adds HOLD-OK quick actions: a
// `longSelect` on the focused card opens an on-poster action overlay (Remove
// from library), mirroring the Continue Watching tile (HomeActionOverlay). The
// card reports focus up + measures its frame rect when it's the active target
// so LibraryScreen can lay the root-level overlay exactly on the poster. The
// shared PosterCard has none of this, so this stays a dedicated wrapper.
// Visuals are identical: lavender focus ring + 1.06 scale, IMDb pill, bottom
// progress bar, title that turns lavender on focus.

const IMDB_RE = /^tt\d{5,}$/;

type M = ReturnType<typeof useMetrics>;

export type CardRect = { x: number; y: number; w: number; h: number };

const PosterVisual = memo(function PosterVisual({
  item,
  width,
  focused,
  active,
  progress,
  m,
  frameRef,
}: {
  item: CardItem;
  width: number;
  focused: boolean;
  /** This card's action overlay is open — drop the ring + scale (the overlay
      draws its own accent border) so the measured frame matches the overlay. */
  active?: boolean;
  progress?: number;
  m: M;
  frameRef?: RefObject<View | null>;
}) {
  const poster = normalizeStremioImage(item.poster);
  const h = width * POSTER_RATIO;
  return (
    <>
      <View
        ref={frameRef}
        style={[
          styles.posterWrap,
          { width, height: h, borderRadius: m.s(16), borderWidth: 1 },
          focused && !active && { borderColor: colors.accent, transform: [{ scale: 1.06 }] },
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
          size="md"
          badge
          containerStyle={{ position: 'absolute', left: m.s(12), top: m.s(12) }}
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
  active,
  onSelect,
  onFocusItem,
  onBlurItem,
  onActiveRect,
}: {
  item: CardItem;
  width: number;
  autoFocus?: boolean;
  atRowStart?: boolean;
  progress?: number;
  /** This card's hold-OK action overlay is open — report the frame rect. */
  active?: boolean;
  onSelect: (item: CardItem) => void;
  onFocusItem?: (item: CardItem) => void;
  onBlurItem?: () => void;
  onActiveRect?: (r: CardRect) => void;
}) {
  const m = useMetrics();
  const frameRef = useRef<View | null>(null);
  const { focused, focusProps } = useTvFocusable({
    atRowStart,
    autoFocus,
    onPress: () => onSelect(item),
    onFocus: onFocusItem ? () => onFocusItem(item) : undefined,
    onBlur: onBlurItem,
  });

  // When this card becomes the action target, measure its frame rect (next tick,
  // after the un-scale settles) so the root overlay lands exactly on the poster.
  // Gated on `focused` too — only the on-screen held card reports. The overlay
  // can't render until the rect is set, so the card keeps focus through measure.
  useEffect(() => {
    if (!active || !focused) return;
    const id = setTimeout(() => {
      frameRef.current?.measureInWindow((x, y, ww, hh) => onActiveRect?.({ x, y, w: ww, h: hh }));
    }, 30);
    return () => clearTimeout(id);
  }, [active, focused, onActiveRect]);

  return (
    <Pressable {...focusProps} style={{ width }}>
      <PosterVisual item={item} width={width} focused={focused} active={active} progress={progress} m={m} frameRef={frameRef} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  posterWrap: { borderColor: 'transparent', overflow: 'hidden' },
  poster: { width: '100%', height: '100%', backgroundColor: colors.surface },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', padding: 8 },
});
