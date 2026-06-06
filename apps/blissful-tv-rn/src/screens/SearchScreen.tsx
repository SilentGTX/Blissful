import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchCatalog, type StremioMetaPreview } from '@blissful/core';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { NavRail } from '../components/NavRail';
import { TopBar } from '../components/TopBar';
import { PosterCard, type CardItem } from '../components/PosterCard';

function ResultRail({
  m,
  title,
  items,
  onSelect,
}: {
  m: ReturnType<typeof useMetrics>;
  title: string;
  items: StremioMetaPreview[];
  onSelect: (item: CardItem) => void;
}) {
  const posterW = m.s(200);
  if (!items.length) return null;
  return (
    <View style={{ marginBottom: m.s(34) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: m.s(12), paddingRight: m.safeX }}>
        <Text style={{ fontFamily: font.bodySemi, fontSize: m.railTitle, color: colors.text }}>{title}</Text>
        <Text style={{ fontFamily: font.body, fontSize: m.s(22), color: colors.textFaint }}>See All</Text>
      </View>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(it) => it.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: m.s(24), paddingTop: m.s(20), paddingBottom: m.s(12), paddingLeft: m.s(12), paddingRight: m.safeX }}
        renderItem={({ item }) => <PosterCard item={item} width={posterW} onSelect={onSelect} />}
      />
    </View>
  );
}

export function SearchScreen() {
  const navigation = useNavigation<any>();
  const m = useMetrics();
  const [query, setQuery] = useState('');
  const [movies, setMovies] = useState<StremioMetaPreview[]>([]);
  const [series, setSeries] = useState<StremioMetaPreview[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setMovies([]);
      setSeries([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      Promise.allSettled([
        fetchCatalog({ type: 'movie', id: 'top', extra: { search: q } }),
        fetchCatalog({ type: 'series', id: 'top', extra: { search: q } }),
      ]).then(([mv, sr]) => {
        if (cancelled) return;
        setMovies(mv.status === 'fulfilled' ? mv.value.metas.slice(0, 12) : []);
        setSeries(sr.status === 'fulfilled' ? sr.value.metas.slice(0, 12) : []);
        setLoading(false);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const onSelect = (item: CardItem) =>
    navigation.navigate('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster ?? undefined });

  const hasResults = movies.length > 0 || series.length > 0;

  return (
    <View style={styles.root}>
      <NavRail active="Home" />
      <TopBar searchValue={query} onSearchChange={setQuery} searchAutoFocus />
      <ScrollView
        style={{ position: 'absolute', left: m.contentLeft, top: m.contentTop, right: 0, bottom: 0 }}
        contentContainerStyle={{ paddingTop: m.s(8), paddingBottom: m.s(40) }}
        showsVerticalScrollIndicator={false}
      >
        {loading && !hasResults ? <ActivityIndicator color={colors.brand} size="large" style={{ marginTop: m.s(60), alignSelf: 'flex-start' }} /> : null}
        <ResultRail m={m} title="Popular - Movie" items={movies} onSelect={onSelect} />
        <ResultRail m={m} title="Popular - Series" items={series} onSelect={onSelect} />
        {query.trim().length >= 2 && !loading && !hasResults ? (
          <Text style={{ fontFamily: font.body, fontSize: m.s(26), color: colors.textFaint, marginTop: m.s(40) }}>No results for “{query.trim()}”.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
