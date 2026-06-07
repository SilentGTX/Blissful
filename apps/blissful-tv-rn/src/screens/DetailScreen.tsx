import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchCatalog, fetchMeta, normalizeStremioImage, type StremioMetaDetail, type StremioMetaPreview } from '@blissful/core';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { PosterCard, type CardItem } from '../components/PosterCard';
import { Rating } from '../components/Rating';
import { StreamPicker, type StreamPickerTarget } from '../components/StreamPicker';
import { metahubPosterToBackdrop } from '../lib/images';

const IMDB_RE = /^tt\d{5,}$/;
import type { RootStackParamList } from '../navigation/types';

type DetailRoute = RouteProp<RootStackParamList, 'Detail'>;
type Nav = StackNavigationProp<RootStackParamList, 'Detail'>;
type Meta = StremioMetaDetail['meta'];
type Video = NonNullable<Meta['videos']>[number];
type M = ReturnType<typeof useMetrics>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// .tv-detail-back — glass pill, top-left.
function BackPill({ m, onPress }: { m: M; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: m.s(8), height: m.s(42), paddingLeft: m.s(16), paddingRight: m.s(20), borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: f ? colors.accent : 'transparent' }}
    >
      <Ionicons name="chevron-back" size={m.s(22)} color="#fff" />
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(19), color: '#fff' }}>Back</Text>
    </Pressable>
  );
}

// .tv-detail-actions .action-button — height ~40, accent for Watch.
function ActionBtn({ label, icon, primary, autoFocus, m, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; primary?: boolean; autoFocus?: boolean; m: M; onPress: () => void }) {
  const [f, setF] = useState(false);
  const fg = primary ? colors.accentInk : colors.text;
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10), height: m.s(40), paddingHorizontal: m.s(24), borderRadius: radius.pill, backgroundColor: primary ? colors.accent : colors.surface10, borderWidth: 1, borderColor: f ? (primary ? colors.text : colors.accent) : 'transparent' }}
    >
      <Ionicons name={icon} size={m.s(22)} color={fg} />
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: fg }}>{label}</Text>
    </Pressable>
  );
}

// .tv-detail-label — uppercase, 0.14em, 50% white.
function Label({ children, m }: { children: string; m: M }) {
  return <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), fontWeight: '700', letterSpacing: m.s(2), textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: m.s(10) }}>{children}</Text>;
}

function Chip({ label, m, onPress }: { label: string; m: M; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.pill, paddingHorizontal: m.s(19), paddingVertical: m.s(10), borderWidth: 1, borderColor: f ? colors.accent : 'transparent' }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: 'rgba(255,255,255,0.92)' }}>{label}</Text>
    </Pressable>
  );
}
function Chips({ items, m, onPress }: { items: string[]; m: M; onPress: (item: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(10) }}>
      {items.map((g) => (
        <Chip key={g} label={g} m={m} onPress={() => onPress(g)} />
      ))}
    </View>
  );
}

function EpisodeCard({ video, m, onPress }: { video: Video; m: M; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  const w = m.s(260);
  const thumb = normalizeStremioImage(video.thumbnail);
  const sub = video.released ? String(new Date(video.released).getFullYear()) : '';
  return (
    <Pressable onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress} style={{ width: w }}>
      <View style={{ width: w, aspectRatio: 16 / 9, borderRadius: m.s(12), overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: focused ? colors.accent : 'transparent' }}>
        {thumb ? <Image source={{ uri: thumb }} style={styles.fill} resizeMode="cover" /> : null}
        {focused ? (
          <View style={{ position: 'absolute', left: m.s(10), bottom: m.s(10), width: m.s(42), height: m.s(42), borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="play" size={m.s(22)} color="#fff" />
          </View>
        ) : null}
      </View>
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: focused ? colors.accent : colors.text, marginTop: m.s(8) }} numberOfLines={1}>
        {video.episode != null ? `${video.episode}. ` : ''}
        {video.title || video.name || `Episode ${video.episode ?? ''}`}
      </Text>
      {sub ? <Text style={{ fontFamily: font.body, fontSize: m.s(18), color: 'rgba(255,255,255,0.6)', marginTop: m.s(2) }}>{sub}</Text> : null}
    </Pressable>
  );
}

function SeasonPill({ label, active, m, onPress }: { label: string; active: boolean; m: M; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress} style={{ paddingHorizontal: m.s(18), paddingVertical: m.s(8), borderRadius: radius.pill, borderWidth: 1, borderColor: focused ? colors.accent : 'transparent', backgroundColor: active ? colors.surface18 : colors.surface08 }}>
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: active ? colors.text : colors.textDim }}>{label}</Text>
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
  const [similar, setSimilar] = useState<StremioMetaPreview[]>([]);
  const [picker, setPicker] = useState<StreamPickerTarget | null>(null);

  const isSeries = params.type === 'series';

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
  const episodes = useMemo(() => videos.filter((v) => v.season === season).sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)), [videos, season]);

  const genres = (meta?.genres ?? meta?.genre ?? []).slice(0, 5);

  // "You may also like" (movies): catalog by the first genre, minus this title.
  useEffect(() => {
    if (isSeries || !genres.length) return;
    let cancelled = false;
    fetchCatalog({ type: params.type, id: 'top', extra: { genre: genres[0] } })
      .then((r) => !cancelled && setSimilar(r.metas.filter((x) => x.id !== params.id).slice(0, 14)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSeries, genres[0], params.id, params.type]);

  // Backdrop with no flash: before meta loads, derive the landscape backdrop
  // from the poster we already have (metahub poster -> background/medium), which
  // is byte-identical to meta.background once it arrives, so the <Image> source
  // never swaps. Falls back to the raw poster (hidden under the scrim) otherwise.
  const background =
    normalizeStremioImage(meta?.background) ??
    normalizeStremioImage(meta?.poster) ??
    metahubPosterToBackdrop(normalizeStremioImage(params.poster)) ??
    normalizeStremioImage(params.poster);
  const cast = (meta?.cast ?? []).slice(0, 5);
  const released = fmtDate(meta?.released) ?? meta?.releaseInfo ?? (meta?.year != null ? String(meta.year) : null);
  const metaBits = [meta?.runtime, released].filter(Boolean) as string[];
  const rating = meta?.imdbRating;

  const name = meta?.name ?? params.name;
  // Movie: pick a stream for the title. Series: pick for the episode's videoId
  // (imdb:S:E — what addons key torrent streams on, not the show id).
  const openMoviePicker = () => setPicker({ type: 'movie', id: params.id, title: name });
  const openEpisodePicker = (video: Video) =>
    setPicker({
      type: 'series',
      id: video.id,
      title: name,
      episodeLabel: `S${video.season ?? '?'}E${video.episode ?? '?'}${video.title || video.name ? ` · ${video.title || video.name}` : ''}`,
    });
  const onSimilar = (item: CardItem) => navigation.push('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster ?? undefined });

  return (
    <View style={styles.root}>
      {background ? <Image source={{ uri: background }} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '72%' }} resizeMode="cover" /> : null}
      {/* .tv-detail-scrim — left->right + bottom->top */}
      <LinearGradient colors={['#07090d', 'rgba(7,9,13,0.55)', 'transparent']} locations={[0.32, 0.52, 0.76]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['#07090d', 'rgba(7,9,13,0.4)', 'transparent']} locations={[0.06, 0.32, 0.6]} start={{ x: 0, y: 1 }} end={{ x: 0, y: 0 }} style={StyleSheet.absoluteFill} />

      <View style={{ flex: 1, paddingHorizontal: m.safeX, paddingVertical: m.safeY }}>
        <BackPill m={m} onPress={() => navigation.goBack()} />

        <View style={{ maxWidth: '48%', marginTop: m.s(13), gap: m.s(10) }}>
          {meta?.logo ? (
            <Image source={{ uri: normalizeStremioImage(meta.logo) }} style={{ height: m.s(80), width: '60%', alignSelf: 'flex-start' }} resizeMode="contain" />
          ) : (
            <Text style={{ fontFamily: font.serif, fontSize: m.s(64), lineHeight: m.s(66), color: colors.text }} numberOfLines={2}>
              {meta?.name ?? params.name}
            </Text>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: m.s(14) }}>
            {metaBits.map((b, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
                {i > 0 ? <Text style={{ fontSize: m.s(20), color: 'rgba(255,255,255,0.4)', marginRight: m.s(14) }}>·</Text> : null}
                <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: 'rgba(255,255,255,0.85)' }}>{b}</Text>
              </View>
            ))}
            <Rating
              imdbId={meta?.imdb_id ?? (IMDB_RE.test(params.id) ? params.id : null)}
              initialRating={rating}
              numberSize={m.s(20)}
              iconSize={m.s(22)}
              gap={m.s(6)}
              leading={metaBits.length ? <Text style={{ fontSize: m.s(20), color: 'rgba(255,255,255,0.4)', marginRight: m.s(8) }}>·</Text> : null}
            />
          </View>

          <View style={{ gap: m.s(16) }}>
            {genres.length ? (
              <View>
                <Label m={m}>Genres</Label>
                <Chips items={genres} m={m} onPress={(g) => navigation.navigate('Discover', { type: params.type, genre: g })} />
              </View>
            ) : null}
            {cast.length ? (
              <View>
                <Label m={m}>Cast</Label>
                <Chips items={cast} m={m} onPress={(c) => navigation.navigate('Search', { query: c })} />
              </View>
            ) : null}
          </View>

          {meta?.description ? (
            <View>
              <Label m={m}>Summary</Label>
              <Text style={{ fontFamily: font.body, fontSize: m.s(18), lineHeight: m.s(27), color: 'rgba(255,255,255,0.82)', maxWidth: m.s(640) }} numberOfLines={6}>
                {meta.description}
              </Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(11), marginTop: m.s(8) }}>
            {!isSeries ? <ActionBtn label="Watch" icon="play" primary autoFocus m={m} onPress={openMoviePicker} /> : null}
            <ActionBtn label="Add to library" icon="bookmark-outline" autoFocus={isSeries} m={m} onPress={() => { /* needs auth */ }} />
            {meta?.trailerStreams?.length ? <ActionBtn label="Trailer" icon="film-outline" m={m} onPress={() => { /* trailer modal next */ }} /> : null}
          </View>

          {loading ? <ActivityIndicator color={colors.brand} style={{ marginTop: m.s(12), alignSelf: 'flex-start' }} /> : null}
        </View>

        <View style={{ flex: 1 }} />

        {/* .tv-detail-bottom — episodes (series) or similar (movie). */}
        {isSeries && seasons.length ? (
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(20), marginBottom: m.s(12) }}>
              <Text style={{ fontFamily: font.serif, fontSize: m.s(36), color: colors.text }}>Episodes</Text>
              {seasons.length > 1 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10) }}>
                  {seasons.map((s) => (
                    <SeasonPill key={s} label={`Season ${s}`} active={s === season} m={m} onPress={() => setSeason(s)} />
                  ))}
                </View>
              ) : null}
            </View>
            <FlatList horizontal data={episodes} keyExtractor={(v) => v.id} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: m.s(20), paddingVertical: m.s(10), paddingLeft: m.s(2), paddingRight: m.safeX }} renderItem={({ item }) => <EpisodeCard video={item} m={m} onPress={() => openEpisodePicker(item)} />} />
          </View>
        ) : !isSeries && similar.length ? (
          <View>
            <Text style={{ fontFamily: font.serif, fontSize: m.s(36), color: colors.text, marginBottom: m.s(12) }}>You may also like</Text>
            <FlatList horizontal data={similar} keyExtractor={(it) => it.id} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: m.s(20), paddingTop: m.s(14), paddingBottom: m.s(8), paddingLeft: m.s(8), paddingRight: m.safeX }} renderItem={({ item }) => <PosterCard item={item} width={m.s(180)} onSelect={onSimilar} />} />
          </View>
        ) : null}
      </View>

      <StreamPicker
        target={picker}
        onClose={() => setPicker(null)}
        onPlay={(streams, index) => {
          setPicker(null);
          navigation.navigate('Player', {
            url: streams[index].url,
            title: streams[index].title,
            playlist: streams,
            startIndex: index,
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
