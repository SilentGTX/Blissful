import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchMeta, normalizeStremioImage, type StremioMetaDetail } from '@blissful/core';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import type { RootStackParamList } from '../navigation/types';

type DetailRoute = RouteProp<RootStackParamList, 'Detail'>;
type Nav = StackNavigationProp<RootStackParamList, 'Detail'>;
type Meta = StremioMetaDetail['meta'];
type Video = NonNullable<Meta['videos']>[number];

// Placeholder until the addon stream picker (user's addons) is wired.
const SAMPLE_STREAM = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

function PillBtn({
  label,
  icon,
  primary,
  ghost,
  autoFocus,
  m,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  primary?: boolean;
  ghost?: boolean;
  autoFocus?: boolean;
  m: ReturnType<typeof useMetrics>;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const h = m.s(58); // .action-button height clamp(2.5..3.1rem)
  const fg = primary ? colors.accentInk : colors.text;
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: m.s(15),
        height: h,
        paddingHorizontal: m.s(26),
        borderRadius: radius.pill,
        borderWidth: m.s(3),
        borderColor: focused ? (primary ? colors.text : colors.accent) : ghost ? colors.hairline : 'transparent',
        backgroundColor: primary ? colors.accent : colors.surface08,
      }}
    >
      {icon ? <Ionicons name={icon} size={m.s(34)} color={fg} /> : null}
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(28), color: fg }}>{label}</Text>
    </Pressable>
  );
}

function Section({ label, m, children }: { label: string; m: ReturnType<typeof useMetrics>; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: m.s(24) }}>
      <Text
        style={{ fontFamily: font.bodySemi, fontSize: m.s(24), letterSpacing: m.s(4), color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', marginBottom: m.s(12) }}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

function Chips({ items, m }: { items: string[]; m: ReturnType<typeof useMetrics> }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(12) }}>
      {items.map((g) => (
        <View key={g} style={{ backgroundColor: colors.surface10, borderRadius: radius.pill, paddingHorizontal: m.s(22), paddingVertical: m.s(11) }}>
          <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(22), color: 'rgba(255,255,255,0.92)' }}>{g}</Text>
        </View>
      ))}
    </View>
  );
}

function EpisodeCard({ video, m, onPress }: { video: Video; m: ReturnType<typeof useMetrics>; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  const w = m.s(290); // clamp(13..18rem)
  const thumb = normalizeStremioImage(video.thumbnail);
  const sub = [video.released ? new Date(video.released).getFullYear() : null].filter(Boolean).join('  ·  ');
  return (
    <Pressable onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress} style={{ width: w }}>
      <View
        style={{
          width: w,
          aspectRatio: 16 / 9,
          borderRadius: m.s(14),
          overflow: 'hidden',
          backgroundColor: colors.surface,
          borderWidth: m.s(3),
          borderColor: focused ? colors.accent : 'transparent',
        }}
      >
        {thumb ? <Image source={{ uri: thumb }} style={styles.fill} resizeMode="cover" /> : null}
        {focused ? (
          <View style={{ position: 'absolute', left: m.s(12), bottom: m.s(12), width: m.s(48), height: m.s(48), borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="play" size={m.s(24)} color="#fff" />
          </View>
        ) : null}
      </View>
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(24), color: focused ? colors.accent : colors.text, marginTop: m.s(9) }} numberOfLines={1}>
        {video.episode != null ? `${video.episode}. ` : ''}
        {video.title || video.name || `Episode ${video.episode ?? ''}`}
      </Text>
      {sub ? <Text style={{ fontFamily: font.body, fontSize: m.s(20), color: 'rgba(255,255,255,0.6)', marginTop: m.s(3) }}>{sub}</Text> : null}
    </Pressable>
  );
}

export function DetailScreen() {
  const { params } = useRoute<DetailRoute>();
  const navigation = useNavigation<Nav>();
  const m = useMetrics();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMeta({ type: params.type, id: params.id })
      .then((r) => !cancelled && setMeta(r.meta))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [params.type, params.id]);

  const videos = meta?.videos ?? [];
  const seasons = useMemo(() => {
    const set = new Set<number>();
    videos.forEach((v) => typeof v.season === 'number' && v.season > 0 && set.add(v.season));
    return [...set].sort((a, b) => a - b);
  }, [videos]);
  useEffect(() => {
    if (seasons.length && season == null) setSeason(seasons[0]);
  }, [seasons, season]);
  const episodes = useMemo(
    () => videos.filter((v) => v.season === season).sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
    [videos, season],
  );

  const background = normalizeStremioImage(meta?.background) ?? normalizeStremioImage(params.poster);
  const genres = (meta?.genres ?? meta?.genre ?? []).slice(0, 6);
  const cast = (meta?.cast ?? []).slice(0, 5);
  const metaBits = [meta?.runtime, meta?.releaseInfo ?? meta?.released?.slice(0, 4) ?? (meta?.year != null ? String(meta.year) : undefined)].filter(Boolean) as string[];
  const rating = meta?.imdbRating;
  const isSeries = params.type === 'series';

  const playSample = () => navigation.navigate('Player', { url: SAMPLE_STREAM, title: meta?.name ?? params.name });

  return (
    <View style={styles.root}>
      {background ? (
        <Image source={{ uri: background }} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '72%' }} resizeMode="cover" />
      ) : null}
      {/* .tv-detail-scrim — left->right + bottom->top */}
      <LinearGradient
        colors={['#07090d', 'rgba(7,9,13,0.55)', 'transparent']}
        locations={[0.32, 0.52, 0.76]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['#07090d', 'rgba(7,9,13,0.4)', 'transparent']}
        locations={[0.06, 0.32, 0.6]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView contentContainerStyle={{ paddingHorizontal: m.safeX, paddingTop: m.safeY, paddingBottom: m.s(50) }} showsVerticalScrollIndicator={false}>
        <View style={{ maxWidth: '52%' }}>
          {meta?.logo ? (
            <Image source={{ uri: normalizeStremioImage(meta.logo) }} style={{ height: m.s(120), width: '70%', marginBottom: m.s(12) }} resizeMode="contain" />
          ) : (
            <Text style={{ fontFamily: font.serif, fontSize: m.s(72), lineHeight: m.s(74), color: colors.text }} numberOfLines={2}>
              {meta?.name ?? params.name}
            </Text>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: m.s(18), marginTop: m.s(16) }}>
            {metaBits.map((b, i) => (
              <Text key={i} style={{ fontFamily: font.bodySemi, fontSize: m.s(26), color: 'rgba(255,255,255,0.85)' }}>
                {b}
              </Text>
            ))}
            {rating ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(6) }}>
                <Ionicons name="star" size={m.s(28)} color={colors.imdbGold} />
                <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(26), color: colors.text }}>{rating}</Text>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(14), marginTop: m.s(26) }}>
            <PillBtn label={isSeries ? 'Play' : 'Watch now'} icon="play" primary autoFocus m={m} onPress={playSample} />
            <PillBtn label="Add to library" icon="bookmark-outline" m={m} onPress={() => { /* needs auth */ }} />
            {meta?.trailerStreams?.length ? (
              <PillBtn label="Trailer" icon="film-outline" m={m} onPress={() => { /* trailer modal next */ }} />
            ) : null}
            <PillBtn label="Back" icon="chevron-back" ghost m={m} onPress={() => navigation.goBack()} />
          </View>

          {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: m.s(24), alignSelf: 'flex-start' }} /> : null}

          {genres.length ? (
            <Section label="Genres" m={m}>
              <Chips items={genres} m={m} />
            </Section>
          ) : null}
          {cast.length ? (
            <Section label="Cast" m={m}>
              <Chips items={cast} m={m} />
            </Section>
          ) : null}
          {meta?.description ? (
            <Section label="Summary" m={m}>
              <Text style={{ fontFamily: font.body, fontSize: m.s(24), lineHeight: m.s(36), color: 'rgba(255,255,255,0.82)', maxWidth: m.s(640) }} numberOfLines={6}>
                {meta.description}
              </Text>
            </Section>
          ) : null}
        </View>

        {isSeries && seasons.length ? (
          <View style={{ marginTop: m.s(34) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(20), marginBottom: m.s(14) }}>
              <Text style={{ fontFamily: font.serif, fontSize: m.s(36), color: colors.text }}>Episodes</Text>
              {seasons.length > 1 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10) }}>
                  {seasons.map((s) => {
                    const active = s === season;
                    return <SeasonPill key={s} label={`Season ${s}`} active={active} m={m} onPress={() => setSeason(s)} />;
                  })}
                </View>
              ) : null}
            </View>
            <FlatList
              horizontal
              data={episodes}
              keyExtractor={(v) => v.id}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: m.s(22), paddingVertical: m.s(10), paddingRight: m.safeX }}
              renderItem={({ item }) => <EpisodeCard video={item} m={m} onPress={playSample} />}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SeasonPill({ label, active, m, onPress }: { label: string; active: boolean; m: ReturnType<typeof useMetrics>; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        paddingHorizontal: m.s(20),
        paddingVertical: m.s(9),
        borderRadius: radius.pill,
        borderWidth: m.s(2),
        borderColor: focused ? colors.accent : 'transparent',
        backgroundColor: active ? colors.surface18 : colors.surface08,
      }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(22), color: active ? colors.text : colors.textDim }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
