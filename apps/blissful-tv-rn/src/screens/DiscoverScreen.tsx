import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { fetchCatalog, type MediaType, type StremioMetaPreview } from '@blissful/core';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { NavRail } from '../components/NavRail';
import { PosterCard, type CardItem } from '../components/PosterCard';
import { TvSelect, TvSelectOverlay, type DropdownAnchor, type SelectOption } from '../components/TvSelect';
import type { RootStackParamList } from '../navigation/types';

type DiscoverRoute = RouteProp<RootStackParamList, 'Discover'>;

const GENRES = ['Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Music', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'];
const TYPE_OPTS: SelectOption[] = [{ key: 'movie', label: 'Movie' }, { key: 'series', label: 'Series' }];
const CATALOG_OPTS: SelectOption[] = [{ key: 'top', label: 'Popular' }];

export function DiscoverScreen() {
  const { params } = useRoute<DiscoverRoute>();
  const navigation = useNavigation<any>();
  const m = useMetrics();
  const [type, setType] = useState<MediaType>(params?.type ?? 'movie');
  const [genre, setGenre] = useState<string | null>(params?.genre ?? null);
  const [results, setResults] = useState<StremioMetaPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [dropdown, setDropdown] = useState<DropdownAnchor | null>(null);

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

  const genreOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ key: 'all', label: 'All Genres' }];
    if (genre && !GENRES.includes(genre)) opts.push({ key: genre, label: genre });
    GENRES.forEach((g) => opts.push({ key: g, label: g }));
    return opts;
  }, [genre]);

  const onSelect = (item: CardItem) => navigation.navigate('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster ?? undefined });

  const posterW = m.s(180);
  // Leave room on the left so the focused card's 1.06 scale + border isn't
  // clipped by the FlatList's edge; align the header to the same inset.
  const padL = m.s(12);
  const gap = m.s(24);
  // +gap because N columns have only N-1 gaps — without it the last column is
  // wrongly dropped (showed 7 with room for an 8th).
  const cols = Math.max(2, Math.floor((m.width - m.contentLeft - m.safeX - padL + gap) / (posterW + gap)));

  return (
    <View style={styles.root}>
      <NavRail active="Discover" />
      <View style={{ position: 'absolute', left: m.contentLeft, top: m.safeY, right: m.safeX, bottom: 0 }}>
        <Text style={{ fontFamily: font.serif, fontSize: m.s(40), color: colors.text, marginLeft: padL, marginBottom: m.s(14) }}>Discover</Text>

        <View style={{ flexDirection: 'row', gap: m.s(12), marginLeft: padL, marginBottom: m.s(18) }}>
          <TvSelect iconName="film-outline" options={TYPE_OPTS} value={type} onChange={(k) => setType(k as MediaType)} m={m} minWidth={m.s(184)} atRowStart onOpen={setDropdown} />
          <TvSelect iconName="trending-up-outline" options={CATALOG_OPTS} value="top" onChange={() => {}} m={m} minWidth={m.s(200)} onOpen={setDropdown} />
          <TvSelect iconName="pricetags-outline" options={genreOptions} value={genre ?? 'all'} onChange={(k) => setGenre(k === 'all' ? null : k)} m={m} minWidth={m.s(200)} onOpen={setDropdown} />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.brand} size="large" style={{ marginTop: m.s(60), alignSelf: 'flex-start' }} />
        ) : results.length ? (
          <FlatList
            data={results}
            key={cols}
            numColumns={cols}
            style={{ height: m.height - m.safeY - m.s(140) }}
            removeClippedSubviews={false}
            keyExtractor={(it) => it.id}
            contentContainerStyle={{ gap: m.s(20), paddingTop: m.s(8), paddingBottom: m.s(40), paddingLeft: padL }}
            columnWrapperStyle={{ gap: m.s(24) }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => <PosterCard item={item} width={posterW} atRowStart={index % cols === 0} onSelect={onSelect} />}
          />
        ) : (
          <Text style={{ fontFamily: font.body, fontSize: m.s(24), color: colors.textFaint, marginTop: m.s(40) }}>Nothing here.</Text>
        )}
      </View>

      {dropdown ? <TvSelectOverlay anchor={dropdown} onClose={() => setDropdown(null)} m={m} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
