import { useNavigation } from '@react-navigation/native';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { normalizeStremioImage, type StremioMetaDetail } from '@blissful/core';
import { useTvFocusable } from '../../lib/useTvFocusable';
import { useContentInert } from '../../lib/contentFocus';
import { formatFullDate, formatReleaseInfo } from '../../lib/releaseInfo';
import { Img } from '../Img';
import { Rating } from '../Rating';
import { colors, font, radius } from '../../theme/colors';
import type { useMetrics } from '../../theme/metrics';
import { landscapeArt, type HomeItem } from './homeData';

type Meta = StremioMetaDetail['meta'];
type M = ReturnType<typeof useMetrics>;
const IMDB_RE = /^tt\d{5,}$/;

// Full-bleed art of the focused item + legibility scrims (design Hero.jsx Backdrop).
// Paints the derived landscape art instantly, then swaps to the hi-res meta.background
// (byte-identical for metahub titles, so no flash).
export const Backdrop = memo(function Backdrop({ item, meta }: { item: HomeItem | null; meta: Meta | null }) {
  // Backdrop sources, best first (matches the Windows detail page): meta.background
  // then meta.poster. Some fanart.tv backgrounds 404 / block a direct fetch, so we
  // ADVANCE to the next source on load error instead of leaving a black frame.
  const candidates = useMemo(
    () => Array.from(new Set([normalizeStremioImage(meta?.background), normalizeStremioImage(meta?.poster)].filter((u): u is string => !!u))),
    [meta?.background, meta?.poster],
  );
  const candKey = candidates.join('|');
  const [idx, setIdx] = useState(0);
  useEffect(() => setIdx(0), [candKey]);
  const real = candidates[idx];
  // Keep the PREVIOUS real backdrop while a newly-focused item's meta is still
  // resolving (no low-q poster flash); the catalog poster is only the first paint.
  const lastRealRef = useRef<string | undefined>(undefined);
  if (real) lastRealRef.current = real;
  const art = real ?? lastRealRef.current ?? landscapeArt(item?.poster);
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.bg }]}>
      {art ? <Img uri={art} style={StyleSheet.absoluteFill} contentFit="cover" transition={350} onError={() => setIdx((i) => i + 1)} /> : null}
      {/* subtle brand-accent (lavender) wash over the backdrop art — below the
          scrims so text legibility is unaffected. Tied to the themed accent. */}
      {art ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.accent, opacity: 0.12 }]} /> : null}
      {/* top scrim — pronounced shadow at the very top blending down, so the clock /
          avatar + hero title stay legible even over a LIGHT backdrop (e.g. anime). */}
      <LinearGradient colors={['rgba(6,8,12,0.85)', 'rgba(6,8,12,0.3)', 'transparent']} locations={[0, 0.2, 0.45]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
      {/* left scrim — legibility for the InfoPanel */}
      <LinearGradient colors={['rgba(6,8,12,0.96)', 'rgba(6,8,12,0.55)', 'transparent']} locations={[0.12, 0.42, 0.74]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
      {/* bottom scrim — under the rows band */}
      <LinearGradient colors={['transparent', 'rgba(6,8,12,0.72)', 'rgba(6,8,12,0.98)']} locations={[0.32, 0.64, 1]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
    </View>
  );
});

// Focusable genre pill → opens Discover pre-filtered to that genre (the old Hero's
// GenreChip behaviour, restored after the redesign). nextUp routes D-pad Up to the
// avatar so it stays reachable above the InfoPanel.
function GenreChip({ label, m, nextUp, atRowStart, onPress }: { label: string; m: M; nextUp?: number; atRowStart?: boolean; onPress: () => void }) {
  // Inert (non-focusable) while the rail or login modal is open, so the D-pad can't
  // escape into a genre chip behind the overlay.
  const inert = useContentInert();
  const { focused, focusProps } = useTvFocusable({ atRowStart, onPress });
  return (
    <Pressable
      {...focusProps}
      isTVSelectable={!inert}
      nextFocusUp={nextUp}
      style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.pill, paddingHorizontal: m.s(20), paddingVertical: m.s(9), borderWidth: 1.5, borderColor: focused ? colors.accent : 'rgba(255,255,255,0.16)' }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: '#fff' }}>{label}</Text>
    </Pressable>
  );
}

// Large featured metadata for the focused item (design Hero.jsx InfoPanel). The
// only focusables are the genre chips (→ Discover). OK on a tile opens Detail;
// holding OK opens the quick-action sheet.
export const InfoPanel = memo(function InfoPanel({ item, meta, m, avatarUpTag }: { item: HomeItem | null; meta: Meta | null; m: M; avatarUpTag?: number }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigation = useNavigation<any>();
  if (!item) return null;
  const runtime = meta?.runtime ?? '';
  // Match the Detail page: runtime · full release date · rating IMDb.
  const released = formatFullDate(meta?.released) ?? (formatReleaseInfo(meta?.releaseInfo) || (meta?.year != null ? String(meta.year) : ''));
  const genres = (meta?.genres ?? meta?.genre ?? []).slice(0, 4);
  const blurb = meta?.description ?? '';
  const rating = meta?.imdbRating ?? item.imdbRating;
  const imdbId = IMDB_RE.test(item.id) ? item.id : (meta as { imdb_id?: string } | null)?.imdb_id ?? null;
  const metaText = { fontFamily: font.bodyMed, color: 'rgba(255,255,255,0.85)', fontSize: m.s(24) } as const;
  const dot = { color: 'rgba(255,255,255,0.4)', fontSize: m.s(24) } as const;
  const bits = [runtime, released].filter(Boolean) as string[];
  return (
    <View style={{ position: 'absolute', left: m.s(150), top: m.s(120), width: m.s(1000) }} pointerEvents="box-none">
      <Text numberOfLines={2} style={{ fontFamily: font.spectralBold, fontSize: m.s(80), lineHeight: m.s(84), color: '#fff', marginBottom: m.s(22), maxWidth: m.s(920) }}>{item.name}</Text>
      {/* meta line — runtime · date · rating IMDb (same layout as the Detail page) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: m.s(14), marginBottom: m.s(22) }}>
        {bits.map((b, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
            {i > 0 ? <Text style={[dot, { marginRight: m.s(14) }]}>·</Text> : null}
            <Text style={metaText}>{b}</Text>
          </View>
        ))}
        <Rating
          imdbId={imdbId}
          initialRating={rating ?? undefined}
          size="lg"
          leading={bits.length ? <Text style={[dot, { marginRight: m.s(8) }]}>·</Text> : null}
        />
      </View>
      {/* genre chips — focusable, each opens Discover pre-filtered to that genre.
          Sits above the summary (per design). */}
      {genres.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(12), marginBottom: m.s(24) }}>
          {genres.map((g, i) => (
            <GenreChip key={g} label={g} m={m} nextUp={avatarUpTag} atRowStart={i === 0} onPress={() => navigation.navigate('Discover', { type: item.type, genre: g })} />
          ))}
        </View>
      ) : null}
      {blurb ? (
        <Text numberOfLines={2} style={{ fontFamily: font.body, fontSize: m.s(27), lineHeight: m.s(40), color: 'rgba(255,255,255,0.78)', maxWidth: m.s(820) }}>{blurb}</Text>
      ) : null}
    </View>
  );
});
