import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchCatalog, type StremioMetaPreview } from '@blissful/core';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { PosterCard, type CardItem } from '../components/PosterCard';

export function SearchScreen() {
  const navigation = useNavigation<any>();
  const m = useMetrics();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StremioMetaPreview[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      Promise.allSettled([
        fetchCatalog({ type: 'movie', id: 'top', extra: { search: q } }),
        fetchCatalog({ type: 'series', id: 'top', extra: { search: q } }),
      ]).then((rs) => {
        if (cancelled) return;
        const metas = rs.flatMap((r) => (r.status === 'fulfilled' ? r.value.metas : []));
        const seen = new Set<string>();
        setResults(metas.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))));
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

  const posterW = m.s(180);
  const cols = Math.max(2, Math.floor((m.width - m.safeX * 2) / (posterW + m.s(24))));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: m.safeX, paddingTop: m.safeY }}>
      <TextInput
        autoFocus
        value={query}
        onChangeText={setQuery}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Search movies, series, actors..."
        placeholderTextColor={colors.textGhost}
        returnKeyType="search"
        style={{
          fontFamily: font.body,
          fontSize: m.s(30),
          color: colors.text,
          backgroundColor: colors.surface10,
          borderRadius: radius.pill,
          paddingHorizontal: m.s(28),
          paddingVertical: m.s(16),
          borderWidth: m.s(3),
          borderColor: focused ? colors.accent : 'transparent',
        }}
      />
      {loading ? (
        <ActivityIndicator color={colors.brand} size="large" style={{ marginTop: m.s(60) }} />
      ) : results.length ? (
        <FlatList
          data={results}
          key={cols}
          numColumns={cols}
          keyExtractor={(it) => it.id}
          contentContainerStyle={{ paddingTop: m.s(24), paddingBottom: m.s(40), gap: m.s(20) }}
          columnWrapperStyle={{ gap: m.s(24) }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => <PosterCard item={item} width={posterW} onSelect={onSelect} />}
        />
      ) : query.trim().length >= 2 ? (
        <Text style={{ fontFamily: font.body, fontSize: m.s(26), color: colors.textFaint, marginTop: m.s(40) }}>No results for “{query.trim()}”.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({});
