import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { fetchCatalog, type StremioMetaPreview } from '@blissful/core';
import { colors, layout } from '../theme/colors';
import { Hero } from '../components/Hero';
import { Rail } from '../components/Rail';
import { TopBar } from '../components/TopBar';
import type { RootStackParamList } from '../navigation/types';

type Nav = StackNavigationProp<RootStackParamList, 'Home'>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const [featured, setFeatured] = useState<StremioMetaPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog({ type: 'movie', id: 'top' })
      .then((r) => {
        if (!cancelled) setFeatured(r.metas[0] ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const onSelect = (item: StremioMetaPreview) => {
    navigation.navigate('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster });
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TopBar />
        {featured ? <Hero item={featured} /> : <View style={styles.heroPlaceholder} />}
        <Rail title="Popular Movies" type="movie" catalogId="top" onSelect={onSelect} />
        <Rail title="Popular Series" type="series" catalogId="top" onSelect={onSelect} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingTop: 28, paddingHorizontal: layout.safeX, paddingBottom: 60 },
  heroPlaceholder: { height: 420, borderRadius: 36, backgroundColor: colors.surface, marginBottom: 36, marginTop: 18 },
});
