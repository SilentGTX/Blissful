import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTvFocusable } from '../../lib/useTvFocusable';
import { useContentInert } from '../../lib/contentFocus';
import { useAuth } from '../../context/AuthContext';
import { fetchTmdbBackdrop } from '../../lib/tmdbArt';
import { Img } from '../Img';
import { colors, font } from '../../theme/colors';
import type { useMetrics } from '../../theme/metrics';
import { landscapeArt, type HomeItem } from './homeData';

type M = ReturnType<typeof useMetrics>;
export type TileRect = { x: number; y: number; w: number; h: number };

// Landscape 16:9 card in a horizontal rail. Native focus engine moves between
// tiles; onFocus lifts the item up to drive the full-bleed Backdrop + InfoPanel.
// On focus the FRAME stays the same size (accent border kept) and only the image
// zooms inside it (animated). Holding OK reports the frame rect up so HomeScreen
// lays the action overlay directly on it (a root-level overlay).
export const LandscapeTile = memo(function LandscapeTile({
  item,
  m,
  autoFocus,
  atRowStart,
  upTag,
  active,
  onFocusItem,
  onBlurItem,
  onPress,
  onActiveRect,
}: {
  item: HomeItem;
  m: M;
  autoFocus?: boolean;
  atRowStart?: boolean;
  /** nextFocusUp target (used by the top row to reach the avatar). */
  upTag?: number;
  /** This tile's hold-OK action overlay is open — report the rect to place it. */
  active?: boolean;
  onFocusItem: (it: HomeItem) => void;
  /** Cleared the screen's focused-tile ref so a hold elsewhere doesn't act on this. */
  onBlurItem: () => void;
  onPress: (it: HomeItem) => void;
  onActiveRect?: (r: TileRect) => void;
}) {
  const { focused, focusProps } = useTvFocusable({
    atRowStart,
    autoFocus,
    onFocus: () => onFocusItem(item),
    onBlur: onBlurItem,
    onPress: () => onPress(item),
  });
  // While the nav rail is open ALL home tiles go non-focusable so D-pad focus is
  // trapped inside the rail (it can only leave via Right, which closes the rail) —
  // otherwise focus escapes into the tiles behind the rail when navigating Friends.
  const railOpen = useContentInert();
  const w = m.s(432);
  const h = m.s(243);
  // EXPERIMENT: prefer the TMDB 16:9 backdrop; fall back to the metahub backdrop.
  const { token } = useAuth();
  const [tmdbArt, setTmdbArt] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTmdbArt(null);
    fetchTmdbBackdrop(item.id, token).then((u) => { if (!cancelled) setTmdbArt(u); }).catch(() => {});
    return () => { cancelled = true; };
  }, [item.id, token]);
  const art = tmdbArt ?? landscapeArt(item.poster);
  // Animated image zoom inside the fixed frame (web-style transition, not instant).
  const zoom = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(zoom, { toValue: focused ? 1.08 : 1, duration: 220, useNativeDriver: true }).start();
  }, [focused, zoom]);
  // When this tile becomes the action target, measure its window rect (next tick,
  // after the focus-scroll settles) so the root overlay lands exactly on it. Gate on
  // `focused` too: the same title can appear in two rows (CW + a Popular row), so
  // `active` (matched by id) turns on BOTH tiles — only the focused (held, on-screen)
  // one should report its rect, else the off-screen twin clobbers the position.
  const frameRef = useRef<View>(null);
  useEffect(() => {
    if (!active || !focused) return;
    const id = setTimeout(() => {
      frameRef.current?.measureInWindow((x, y, ww, hh) => onActiveRect?.({ x, y, w: ww, h: hh }));
    }, 30);
    return () => clearTimeout(id);
  }, [active, focused, onActiveRect]);
  return (
    <Pressable {...focusProps} isTVSelectable={!railOpen} nextFocusUp={upTag} style={{ width: w, height: h }}>
      {/* OUTER wrapper = the fixed-size frame + accent ring (never scales, so the
          tile keeps its footprint and the border stays put). */}
      <View ref={frameRef} style={{ width: w, height: h, borderRadius: m.s(16), backgroundColor: colors.surface }}>
        {/* INNER box clips the art/scrim/overlays to the rounded shape. */}
        <View style={{ width: w, height: h, borderRadius: m.s(16), overflow: 'hidden', backgroundColor: colors.surface }}>
          {/* On focus the FRAME stays the same size (border kept) and only the IMAGE
              zooms inside it (clipped by this box), with a smooth transition — matches
              the web / old android app, instead of scaling the whole tile bigger. */}
          {art ? (
            <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: zoom }] }]}>
              <Img uri={art} style={StyleSheet.absoluteFill} contentFit="cover" />
            </Animated.View>
          ) : null}
          {/* bottom legibility scrim for the title */}
          <LinearGradient colors={['transparent', 'rgba(5,7,11,0.85)']} locations={[0.45, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          {/* title bottom-left */}
          <View style={{ position: 'absolute', left: m.s(18), right: m.s(18), bottom: m.s(18) }}>
            <Text numberOfLines={2} style={{ fontFamily: font.spectralSemi, fontSize: m.s(25), lineHeight: m.s(27), color: '#fff' }}>{item.name}</Text>
          </View>
        </View>
        {/* Accent focus ring — drawn on the frame (above the clipped box, not clipped). */}
        {focused && !active ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: m.s(16), borderWidth: m.s(3), borderColor: colors.accent }]} /> : null}
      </View>
    </Pressable>
  );
});
