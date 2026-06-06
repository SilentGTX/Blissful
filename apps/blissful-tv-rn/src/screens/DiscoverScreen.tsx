import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchCatalog, type MediaType, type StremioMetaPreview } from '@blissful/core';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { NavRail } from '../components/NavRail';
import { PosterCard, type CardItem } from '../components/PosterCard';
import type { RootStackParamList } from '../navigation/types';

type DiscoverRoute = RouteProp<RootStackParamList, 'Discover'>;
type M = ReturnType<typeof useMetrics>;

// Cinemeta's standard genre set (the 'top' catalog's `genre` extra options).
const GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'];

function FilterPill({ label, active, m, onPress }: { label: string; active: boolean; m: M; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ paddingHorizontal: m.s(20), paddingVertical: m.s(10), borderRadius: radius.pill, backgroundColor: active ? colors.surface18 : 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: f ? colors.accent : 'transparent' }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: active ? colors.text : colors.textDim }}>{label}</Text>
    </Pressable>
  );
}

export function DiscoverScreen() {
  const { params } = useRoute<DiscoverRoute>();
  const navigation = useNavigation<any>();
  const m = useMetrics();
  const [type, setType] = useState<MediaType>(params?.type ?? 'movie');
  const [genre, setGenre] = useState<string | null>(params?.genre ?? null);
  const [results, setResults] = useState<StremioMetaPreview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCatalog({ type, id: 'top', extra: genre ? { genre } : {} })
      .then((r) => !cancelled && setResults(r.metas))
      .catch(() => !cancelled && setResults([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [type, genre]);

  // Keep the clicked genre visible even if it isn't in the standard set.
  const genreOptions = useMemo(() => (genre && !GENRES.includes(genre) ? [genre, ...GENRES] : GENRES), [genre]);

  const onSelect = (item: CardItem) => navigation.navigate('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster ?? undefined });

  const posterW = m.s(180);
  const cols = Math.max(2, Math.floor((m.width - m.contentLeft - m.safeX) / (posterW + m.s(24))));

  return (
    <View style={styles.root}>
      <NavRail active="Discover" />
      <View style={{ position: 'absolute', left: m.contentLeft, top: m.safeY, right: m.safeX, bottom: 0 }}>
        <Text style={{ fontFamily: font.serif, fontSize: m.s(40), color: colors.text, marginBottom: m.s(14) }}>Discover</Text>

        {/* Type pills */}
        <View style={{ flexDirection: 'row', gap: m.s(10), marginBottom: m.s(12) }}>
          {(['movie', 'series'] as MediaType[]).map((t) => (
            <FilterPill key={t} label={t === 'movie' ? 'Movies' : 'Series'} active={type === t} m={m} onPress={() => setType(t)} />
          ))}
        </View>

        {/* Genre chips (pre-selected genre highlighted) */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: m.s(10), alignItems: 'center', paddingRight: m.safeX }} style={{ height: m.s(56), flexGrow: 0, flexShrink: 0, marginBottom: m.s(16) }}>
          <FilterPill label="All" active={genre == null} m={m} onPress={() => setGenre(null)} />
          {genreOptions.map((g) => (
            <FilterPill key={g} label={g} active={genre === g} m={m} onPress={() => setGenre(g)} />
          ))}
        </ScrollView>

        {loading ? (
          <ActivityIndicator color={colors.brand} size="large" style={{ marginTop: m.s(60), alignSelf: 'flex-start' }} />
        ) : results.length ? (
          <FlatList
            data={results}
            key={cols}
            numColumns={cols}
            style={{ flex: 1 }}
            keyExtractor={(it) => it.id}
            contentContainerStyle={{ gap: m.s(20), paddingTop: m.s(8), paddingBottom: m.s(40) }}
            columnWrapperStyle={{ gap: m.s(24) }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => <PosterCard item={item} width={posterW} onSelect={onSelect} />}
          />
        ) : (
          <Text style={{ fontFamily: font.body, fontSize: m.s(24), color: colors.textFaint, marginTop: m.s(40) }}>Nothing here.</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
