import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { fetchCatalog, type StremioMetaPreview } from '@blissful/core';
import { colors } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { Hero } from '../components/Hero';
import { NavRail } from '../components/NavRail';
import { Rail } from '../components/Rail';
import { TopBar } from '../components/TopBar';
import type { RootStackParamList } from '../navigation/types';

type Nav = StackNavigationProp<RootStackParamList, 'Home'>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const m = useMetrics();
  const [featured, setFeatured] = useState<StremioMetaPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog({ type: 'movie', id: 'top' })
      .then((r) => !cancelled && setFeatured(r.metas[0] ?? null))
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
      <NavRail active="Home" />
      <TopBar />
      <ScrollView
        style={{ position: 'absolute', left: m.contentLeft, top: m.contentTop, right: 0, bottom: 0 }}
        contentContainerStyle={{ paddingRight: m.safeX, paddingBottom: m.s(60) }}
        showsVerticalScrollIndicator={false}
      >
        <Hero item={featured} />
        <Rail title="Popular Movies" type="movie" catalogId="top" onSelect={onSelect} />
        <Rail title="Popular Series" type="series" catalogId="top" onSelect={onSelect} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
