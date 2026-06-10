import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchMeta, normalizeStremioImage, type StremioMetaDetail, type StremioMetaPreview } from '@blissful/core';
import { useTvFocusable } from '../lib/useTvFocusable';
import { formatReleaseInfo } from '../lib/releaseInfo';
import { Img } from './Img';
import { Rating } from './Rating';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import type { RootStackParamList } from '../navigation/types';

type Nav = StackNavigationProp<RootStackParamList, 'Home'>;

function HeroBtn({
  label,
  icon,
  primary,
  autoFocus,
  atRowStart,
  h,
  upTag,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary?: boolean;
  autoFocus?: boolean;
  atRowStart?: boolean;
  h: number;
  upTag?: number;
  onPress: () => void;
}) {
  const { focused, focusProps } = useTvFocusable({ atRowStart, autoFocus, onPress });
  return (
    <Pressable
      {...focusProps}
      nextFocusUp={upTag}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: h * 0.18,
        height: h,
        paddingHorizontal: h * 0.5,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: focused ? (primary ? colors.text : colors.accent) : 'transparent',
        backgroundColor: primary ? colors.accent : colors.surface08,
      }}
    >
      <Ionicons name={icon} size={h * 0.4} color={primary ? colors.accentInk : colors.text} />
      <Text style={{ fontFamily: font.bodySemi, fontSize: h * 0.34, color: primary ? colors.accentInk : colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

function GenreChip({ label, m, atRowStart, onPress }: { label: string; m: ReturnType<typeof useMetrics>; atRowStart?: boolean; onPress: () => void }) {
  const { focused: f, focusProps } = useTvFocusable({ atRowStart, onPress });
  return (
    <Pressable
      {...focusProps}
      style={{ backgroundColor: colors.surface12, borderRadius: radius.pill, paddingHorizontal: m.s(24), paddingVertical: m.s(10), borderWidth: 1, borderColor: f ? colors.accent : 'transparent' }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(22), color: 'rgba(255,255,255,0.9)' }}>{label}</Text>
    </Pressable>
  );
}

export const Hero = memo(function Hero({ item, upTag }: { item: StremioMetaPreview | null; upTag?: number }) {
  const navigation = useNavigation<Nav>();
  const m = useMetrics();
  const [meta, setMeta] = useState<StremioMetaDetail['meta'] | null>(null);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setMeta(null);
    fetchMeta({ type: item.type, id: item.id })
      .then((r) => !cancelled && setMeta(r.meta))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item?.id, item?.type]);

  const bg = normalizeStremioImage(meta?.background) ?? normalizeStremioImage(item?.poster);
  const genres = (meta?.genres ?? meta?.genre ?? item?.genres ?? []).slice(0, 3);
  const year = formatReleaseInfo(meta?.releaseInfo ?? item?.releaseInfo) || (meta?.year != null ? String(meta.year) : '');
  const rating = meta?.imdbRating ?? item?.imdbRating;
  const runtime = meta?.runtime;
  const desc = meta?.description ?? item?.description ?? '';
  const metaLine = [year, runtime].filter(Boolean).join('   ·   ');
  const imdbId = item?.id && /^tt\d{5,}$/.test(item.id) ? item.id : (meta as { imdb_id?: string } | null)?.imdb_id ?? null;
  const btnH = m.s(56); // TV action button h-14

  return (
    <View style={[styles.hero, { height: m.heroMinH, borderRadius: m.s(36), marginBottom: m.s(24) }]}>
      {bg ? <Img uri={bg} style={styles.bg} contentFit="cover" /> : null}
      {/* .now-popular-scrim — bottom-up dark + left-to-right dark */}
      <LinearGradient
        colors={['rgba(0,0,0,0.92)', 'rgba(0,0,0,0.5)', 'transparent']}
        locations={[0, 0.38, 0.68]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(0,0,0,0.7)', 'transparent']}
        locations={[0, 0.55]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={{ flex: 1, paddingLeft: m.safeX, paddingRight: m.s(24), paddingTop: m.s(20), paddingBottom: m.safeY }}>
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(20), letterSpacing: m.s(7), color: colors.textDim }}>
          🔥  NOW POPULAR
        </Text>
        <View style={{ flex: 1 }} />
        {genres.length ? (
          <View style={{ flexDirection: 'row', gap: m.s(14), marginBottom: m.s(18) }}>
            {genres.map((g, i) => (
              <GenreChip key={g} label={g} m={m} atRowStart={i === 0} onPress={() => navigation.navigate('Discover', { type: item?.type ?? 'movie', genre: g })} />
            ))}
          </View>
        ) : null}
        <Text
          style={{ fontFamily: font.serif, fontSize: m.heroTitle, color: colors.text, lineHeight: m.heroTitle * 1.05, maxWidth: '60%' }}
          numberOfLines={2}
        >
          {item?.name ?? ' '}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(16), marginTop: m.s(16) }}>
          {metaLine ? (
            <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(26), color: 'rgba(255,255,255,0.8)' }}>{metaLine}</Text>
          ) : null}
          <Rating imdbId={imdbId} initialRating={rating} numberSize={m.s(26)} iconSize={m.s(28)} gap={m.s(7)} />
        </View>
        {desc ? (
          <Text
            style={{ fontFamily: font.body, fontSize: m.s(26), color: colors.textDim, marginTop: m.s(14), maxWidth: '58%', lineHeight: m.s(38) }}
            numberOfLines={2}
          >
            {desc}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: m.s(24), marginTop: m.s(28) }}>
          <HeroBtn
            label="Watch now"
            icon="play"
            primary
            autoFocus
            atRowStart
            h={btnH}
            upTag={upTag}
            onPress={() =>
              item && navigation.navigate('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster })
            }
          />
          <HeroBtn label="Add to library" icon="bookmark-outline" h={btnH} upTag={upTag} onPress={() => { /* library — needs auth */ }} />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  hero: { overflow: 'hidden', backgroundColor: '#0f1115' },
  bg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
