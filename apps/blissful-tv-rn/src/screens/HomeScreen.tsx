import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { findNodeHandle, ScrollView, StyleSheet, View } from 'react-native';
import { fetchCatalog, type StremioMetaPreview } from '@blissful/core';
import { colors } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useAuth } from '../context/AuthContext';
import { fetchContinueWatching, type CwItem } from '../lib/continueWatching';
import { Hero } from '../components/Hero';
import { ItemsRail } from '../components/ItemsRail';
import { NavRail } from '../components/NavRail';
import { Rail } from '../components/Rail';
import { ResumeModal } from '../components/ResumeModal';
import { TopBar } from '../components/TopBar';
import type { CardItem } from '../components/PosterCard';
import type { RootStackParamList } from '../navigation/types';

type Nav = StackNavigationProp<RootStackParamList, 'Home'>;
const SAMPLE_STREAM = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const m = useMetrics();
  const { token } = useAuth();
  const [featured, setFeatured] = useState<StremioMetaPreview | null>(null);
  const [cw, setCw] = useState<CwItem[]>([]);
  const [resumeItem, setResumeItem] = useState<CwItem | null>(null);
  // Route Up from the hero to the top-bar search (otherwise the native engine
  // sends it into the nav rail). Resolve the search node handle after mount.
  const searchRef = useRef<View>(null);
  const [searchTag, setSearchTag] = useState<number | undefined>(undefined);
  useEffect(() => {
    const id = setTimeout(() => {
      const tag = searchRef.current ? findNodeHandle(searchRef.current) : null;
      if (tag) setSearchTag(tag);
    }, 400);
    return () => clearTimeout(id);
  }, []);

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

  // Stable callbacks so a cw/resumeItem state change doesn't re-render every
  // rail (the memoised Rail/ItemsRail skip when their props are referentially
  // equal). onSelect has only `navigation` as a dep; CW reads from a ref so its
  // callback stays stable even as the list loads.
  const cwRef = useRef<CwItem[]>([]);
  cwRef.current = cw;
  const onSelect = useCallback((item: CardItem) => {
    navigation.navigate('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster ?? undefined });
  }, [navigation]);
  const onCwSelect = useCallback((item: CardItem) => {
    const cwi = cwRef.current.find((c) => c.id === item.id);
    if (cwi) setResumeItem(cwi);
  }, []);
  const playCw = useCallback((i: CwItem) => navigation.navigate('Player', { url: SAMPLE_STREAM, title: i.name }), [navigation]);

  return (
    <View style={styles.root}>
      <NavRail active="Home" />
      <TopBar searchRef={searchRef} />
      <ScrollView
        style={{ position: 'absolute', left: m.contentLeft, top: m.contentTop, right: 0, bottom: 0 }}
        contentContainerStyle={{ paddingRight: m.safeX, paddingBottom: m.s(60) }}
        showsVerticalScrollIndicator={false}
      >
        <Hero item={featured} upTag={searchTag} />
        <ItemsRail title="Continue Watching" items={cw} onSelect={onCwSelect} />
        <Rail title="Popular Movies" type="movie" catalogId="top" onSelect={onSelect} />
        <Rail title="Popular Series" type="series" catalogId="top" onSelect={onSelect} />
      </ScrollView>

      <ResumeModal
        item={resumeItem}
        onResume={playCw}
        onStartOver={playCw}
        onGoToDetail={(i) => navigation.navigate('Detail', { id: i.id, type: i.type, name: i.name, poster: i.poster })}
        onClose={() => setResumeItem(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
