import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { fetchCatalog, type StremioMetaPreview } from '@blissful/core';
import { colors } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useAuth } from '../context/AuthContext';
import { fetchContinueWatching, type CwItem } from '../lib/continueWatching';
import { Hero } from '../components/Hero';
import { ItemsRail } from '../components/ItemsRail';
import { NavRail } from '../components/NavRail';
import { Rail } from '../components/Rail';
import { TopBar } from '../components/TopBar';
import type { CardItem } from '../components/PosterCard';
import type { RootStackParamList } from '../navigation/types';

type Nav = StackNavigationProp<RootStackParamList, 'Home'>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const m = useMetrics();
  const { token } = useAuth();
  const [featured, setFeatured] = useState<StremioMetaPreview | null>(null);
  const [cw, setCw] = useState<CwItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog({ type: 'movie', id: 'top' })
      .then((r) => !cancelled && setFeatured(r.metas[0] ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Continue Watching — the user's in-progress library (needs login).
  useEffect(() => {
    if (!token) {
      setCw([]);
      return;
    }
    let cancelled = false;
    fetchContinueWatching(token)
      .then((items) => !cancelled && setCw(items))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSelect = (item: CardItem) => {
    navigation.navigate('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster ?? undefined });
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
        <ItemsRail title="Continue Watching" items={cw} onSelect={onSelect} />
        <Rail title="Popular Movies" type="movie" catalogId="top" onSelect={onSelect} />
        <Rail title="Popular Series" type="series" catalogId="top" onSelect={onSelect} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
