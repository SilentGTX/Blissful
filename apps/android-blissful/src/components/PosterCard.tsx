import { memo, useEffect, useRef, useState, type RefObject } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { normalizeStremioImage } from '@blissful/core';
import { useTvFocusable } from '../lib/useTvFocusable';
import { useAuth } from '../context/AuthContext';
import { fetchTmdbBackdrop } from '../lib/tmdbArt';
import { metahubPosterToBackdrop } from '../lib/images';
import { Img } from './Img';
import { Skeleton } from './Skeleton';
import { Rating } from './Rating';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';

export type CardItem = {
  id: string;
  type: string;
  name: string;
  poster?: string | null;
  imdbRating?: string | number | null;
};

// Measured window rect of a card's poster frame — used to lay a root-level
// hold-OK action overlay (Library Remove / Home tile actions) exactly on the card.
export type CardRect = { x: number; y: number; w: number; h: number };

// Card shape. `portrait` = the 2:3 poster used in Discover/Library/Search/Detail.
// `landscape` = a 16:9 tile (the immersive Home rows): the bigger server-keyed TMDB
// backdrop art, the title laid over a bottom scrim, the image zooming inside a fixed
// frame on focus.
export type PosterVariant = 'portrait' | 'landscape';
// Where the title sits on a `landscape` card: `inside` over the bottom scrim (Home),
// `below` the card left-aligned (Discover/Library content grids), or `none`.
export type TitlePlacement = 'inside' | 'below' | 'none';

const IMDB_RE = /^tt\d{5,}$/;

export const POSTER_RATIO = 1.464; // portrait height = width * ratio (--poster-shape-ratio 1/1.464)
export const LANDSCAPE_RATIO = 9 / 16; // landscape height = width * ratio (16:9)

// Named poster widths in 1920-design px — callers scale with m.s() (or pass a
// computed width). Most portrait grids use `md`; `land` is the Home tile width.
export const POSTER_W = { sm: 150, md: 180, lg: 220, land: 432 } as const;

type M = ReturnType<typeof useMetrics>;

// Heavy visual (image + badges + title). Memoised so a rail open/close — which
// re-renders the Pressable shell below to flip isTVSelectable — does NOT reflow
// the image. Only a real focus change (border/scale/title colour) re-renders it.
const PosterVisual = memo(function PosterVisual({
  item,
  width,
  variant,
  art,
  hideRating,
  titlePlacement,
  focused,
  active,
  progress,
  m,
  frameRef,
}: {
  item: CardItem;
  width: number;
  variant: PosterVariant;
  /** Resolved image url for the current variant (poster for portrait, backdrop for landscape). */
  art: string | null;
  /** Hide the IMDb rating badge (Home hides it on its landscape tiles). */
  hideRating?: boolean;
  /** Landscape title position (default `inside`). */
  titlePlacement?: TitlePlacement;
  focused: boolean;
  /** This card's action overlay is open — drop the ring + scale (the overlay
      draws its own accent border) so the measured frame matches the overlay. */
  active?: boolean;
  progress?: number;
  m: M;
  frameRef?: RefObject<View | null>;
}) {
  const isLandscape = variant === 'landscape';
  const h = width * (isLandscape ? LANDSCAPE_RATIO : POSTER_RATIO);
  const [loaded, setLoaded] = useState(false);
  // Only show the shimmer if the image is genuinely slow to load. A disk-cached
  // image (expo-image memory-disk) loads in a few ms, so the timer never fires
  // and there's no flash on re-mount (rail virtualization / navigating back).
  const [showSkeleton, setShowSkeleton] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setShowSkeleton(true), 180);
    return () => clearTimeout(t);
  }, [loaded]);

  // Landscape image zoom INSIDE the fixed frame (web/Home behaviour — the frame
  // keeps its footprint so the row doesn't reflow; only the art scales).
  const zoom = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isLandscape) return;
    Animated.timing(zoom, { toValue: focused && !active ? 1.08 : 1, duration: 220, useNativeDriver: true }).start();
  }, [isLandscape, focused, active, zoom]);

  const ratingBadge = hideRating ? null : (
    <Rating
      imdbId={IMDB_RE.test(item.id) ? item.id : null}
      initialRating={item.imdbRating}
      size="md"
      badge
      containerStyle={{ position: 'absolute', left: m.s(12), top: m.s(12) }}
    />
  );

  // Landscape (16:9): art fills a fixed frame; the IMDb badge is top-left. The title
  // is either INSIDE over a bottom scrim (Home) or BELOW the card left-aligned
  // (Discover/Library content grids), per `titlePlacement` (default `inside`).
  if (isLandscape) {
    const titleBelow = titlePlacement === 'below';
    const titleInside = !titleBelow && titlePlacement !== 'none';
    return (
      <>
        <View ref={frameRef} style={{ width, height: h, borderRadius: m.s(16), backgroundColor: colors.surface }}>
          <View style={{ width, height: h, borderRadius: m.s(16), overflow: 'hidden', backgroundColor: colors.surface }}>
            {art ? (
              <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: zoom }] }]}>
                <Img uri={art} style={StyleSheet.absoluteFill} contentFit="cover" onLoad={() => setLoaded(true)} />
              </Animated.View>
            ) : (
              <View style={[StyleSheet.absoluteFill, styles.posterEmpty]}>
                <Text style={{ fontFamily: font.body, color: colors.textDim, fontSize: m.s(22), textAlign: 'center' }} numberOfLines={2}>
                  {item.name}
                </Text>
              </View>
            )}
            {/* bottom legibility scrim — only when the title sits INSIDE over it */}
            {titleInside ? <LinearGradient colors={['transparent', 'rgba(5,7,11,0.85)']} locations={[0.45, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" /> : null}
            {ratingBadge}
            {progress != null && progress > 0 ? (
              <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: m.s(5), backgroundColor: 'rgba(0,0,0,0.45)' }}>
                <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${Math.min(100, progress)}%`, backgroundColor: colors.accent }} />
              </View>
            ) : null}
            {titleInside ? (
              <View style={{ position: 'absolute', left: m.s(18), right: m.s(18), bottom: m.s(18) }}>
                <Text numberOfLines={2} style={{ fontFamily: font.spectralSemi, fontSize: m.s(25), lineHeight: m.s(27), color: '#fff' }}>
                  {item.name}
                </Text>
              </View>
            ) : null}
            {art && !loaded && showSkeleton ? <Skeleton width={width} height={h} style={{ position: 'absolute', top: 0, left: 0 }} /> : null}
          </View>
          {/* accent focus ring — on the frame, above the clipped box (not clipped) */}
          {focused && !active ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: m.s(16), borderWidth: m.s(3), borderColor: colors.accent }]} /> : null}
        </View>
        {/* title BELOW the card, left-aligned (content-grid layout) */}
        {titleBelow ? (
          <Text numberOfLines={2} style={{ fontFamily: font.bodyMed, color: focused ? colors.accent : colors.textDim, fontSize: m.cardTitle, marginTop: m.s(12), textAlign: 'left' }}>
            {item.name}
          </Text>
        ) : null}
      </>
    );
  }

  // Portrait (2:3): poster art + IMDb badge + progress + title BELOW the card.
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
        {art ? (
          <Img uri={art} style={styles.poster} contentFit="cover" onLoad={() => setLoaded(true)} />
        ) : (
          <View style={[styles.poster, styles.posterEmpty]}>
            <Text style={{ fontFamily: font.body, color: colors.textDim, fontSize: m.s(22), textAlign: 'center' }} numberOfLines={3}>
              {item.name}
            </Text>
          </View>
        )}
        {ratingBadge}
        {progress != null && progress > 0 ? (
          <View style={{ position: 'absolute', bottom: m.s(12), left: m.s(12), right: m.s(12), height: m.s(6), borderRadius: radius.pill, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.35)' }}>
            <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${Math.min(100, progress)}%`, backgroundColor: colors.accent }} />
          </View>
        ) : null}
        {/* Shimmer placeholder only for genuinely-slow loads (cached posters skip
            it). The posterWrap's overflow:hidden clips it to the rounded shape. */}
        {art && !loaded && showSkeleton ? (
          <Skeleton width={width} height={h} style={{ position: 'absolute', top: 0, left: 0 }} />
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
  variant = 'portrait',
  hideRating,
  titlePlacement,
  autoFocus,
  atRowStart,
  nextFocusUp,
  progress,
  active,
  onSelect,
  onFocus,
  onBlur,
  onActiveRect,
}: {
  item: CardItem;
  width: number;
  /** Card shape — `portrait` (2:3 poster) or `landscape` (16:9 Home-style backdrop tile). */
  variant?: PosterVariant;
  /** Hide the IMDb rating badge (e.g. the Home landscape rows). */
  hideRating?: boolean;
  /** Landscape title position — `inside` (Home, default) / `below` (content grids) / `none`. */
  titlePlacement?: TitlePlacement;
  autoFocus?: boolean;
  atRowStart?: boolean;
  /** nextFocusUp node handle (the Home top row routes Up to the avatar). */
  nextFocusUp?: number;
  progress?: number;
  /** This card's hold-OK action overlay is open — drop the ring + report the rect. */
  active?: boolean;
  onSelect: (item: CardItem) => void;
  /** D-pad focus landed on this card (Home/Discover/Library use it to drive the ambient backdrop). */
  onFocus?: (item: CardItem) => void;
  onBlur?: () => void;
  /** Called with the card frame's window rect while this card is the active target. */
  onActiveRect?: (r: CardRect) => void;
}) {
  const m = useMetrics();
  const { token } = useAuth();
  const frameRef = useRef<View | null>(null);
  const isLandscape = variant === 'landscape';

  // Landscape art = the SAME source the immersive Home rows use: the server-keyed
  // TMDB 16:9 backdrop (cached in tmdbArt), falling back to the metahub backdrop
  // derived from the poster, then the poster itself. Portrait just uses the poster.
  const poster = normalizeStremioImage(item.poster);
  const [landscapeArt, setLandscapeArt] = useState<string | null>(null);
  useEffect(() => {
    if (!isLandscape) return;
    let cancelled = false;
    setLandscapeArt(null);
    fetchTmdbBackdrop(item.id, token)
      .then((u) => { if (!cancelled) setLandscapeArt(u); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isLandscape, item.id, token]);
  const art = (isLandscape ? (landscapeArt ?? metahubPosterToBackdrop(poster) ?? poster) : poster) ?? null;

  const { focused, focusProps } = useTvFocusable({
    atRowStart,
    autoFocus,
    onPress: () => onSelect(item),
    onFocus: onFocus ? () => onFocus(item) : undefined,
    onBlur,
  });

  // When this card becomes the action target, measure its frame rect (next tick,
  // after the un-scale settles) so the root overlay lands exactly on the card.
  // Gated on `focused` too — only the on-screen held card reports.
  useEffect(() => {
    if (!active || !focused) return;
    const id = setTimeout(() => {
      frameRef.current?.measureInWindow((x, y, ww, hh) => onActiveRect?.({ x, y, w: ww, h: hh }));
    }, 30);
    return () => clearTimeout(id);
  }, [active, focused, onActiveRect]);

  return (
    <Pressable {...focusProps} nextFocusUp={nextFocusUp} style={{ width }}>
      <PosterVisual item={item} width={width} variant={variant} art={art} hideRating={hideRating} titlePlacement={titlePlacement} focused={focused} active={active} progress={progress} m={m} frameRef={frameRef} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  posterWrap: { borderColor: 'transparent', overflow: 'hidden' },
  poster: { width: '100%', height: '100%', backgroundColor: colors.surface },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', padding: 8 },
});
