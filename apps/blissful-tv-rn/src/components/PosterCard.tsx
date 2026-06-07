import { memo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { normalizeStremioImage } from '@blissful/core';
import { markContentFocus } from '../lib/focusBus';
import { useSelfTag } from '../lib/useSelfTag';
import { Img } from './Img';
import { Rating } from './Rating';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';

export type CardItem = {
  id: string;
  type: string;
  name: string;
  poster?: string | null;
  imdbRating?: string | number;
};

const IMDB_RE = /^tt\d{5,}$/;

export const POSTER_RATIO = 1.464; // --poster-shape-ratio: 1/1.464

type M = ReturnType<typeof useMetrics>;

// Heavy visual (image + badges + title). Memoised so a rail open/close — which
// re-renders the Pressable shell below to flip isTVSelectable — does NOT reflow
// the image. Only a real focus change (border/scale/title colour) re-renders it.
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

export function PosterCard({
  item,
  width,
  autoFocus,
  atRowStart,
  progress,
  onSelect,
}: {
  item: CardItem;
  width: number;
  autoFocus?: boolean;
  atRowStart?: boolean;
  progress?: number;
  onSelect: (item: CardItem) => void;
}) {
  const m = useMetrics();
  const [focused, setFocused] = useState(false);
  const ref = useRef(null);
  const selfTag = useSelfTag(ref, Boolean(atRowStart));

  return (
    <Pressable
      ref={ref}
      hasTVPreferredFocus={autoFocus}
      nextFocusLeft={selfTag}
      onFocus={() => { setFocused(true); markContentFocus(Boolean(atRowStart)); }}
      onBlur={() => setFocused(false)}
      onPress={() => onSelect(item)}
      style={{ width }}
    >
      <PosterVisual item={item} width={width} focused={focused} progress={progress} m={m} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  posterWrap: { borderColor: 'transparent', overflow: 'hidden' },
  poster: { width: '100%', height: '100%', backgroundColor: colors.surface },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', padding: 8 },
});
