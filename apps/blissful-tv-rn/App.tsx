import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
// The shared brain — same TypeScript the web/desktop app runs. On RN there is
// no CORS, so fetchCatalog hits Cinemeta DIRECTLY (the core's default identity
// resolver); the web app injects the /addon-proxy wrap via configureCore().
import { fetchCatalog, normalizeStremioImage, type StremioMetaPreview } from '@blissful/core';

const BRAND = '#19f7d2';
const ACCENT = '#95a2ff';
const POSTER_W = 150;
const POSTER_H = 225;

function PosterCard({ item, autoFocus }: { item: StremioMetaPreview; autoFocus?: boolean }) {
  const [focused, setFocused] = useState(false);
  const poster = normalizeStremioImage(item.poster);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => {}}
      style={styles.card}
    >
      <View style={[styles.posterWrap, focused && styles.posterWrapFocused]}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" />
        ) : (
          <View style={[styles.poster, styles.posterEmpty]}>
            <Text style={styles.posterEmptyText} numberOfLines={3}>
              {item.name}
            </Text>
          </View>
        )}
      </View>
      <Text style={[styles.cardTitle, focused && styles.cardTitleFocused]} numberOfLines={1}>
        {item.name}
      </Text>
    </Pressable>
  );
}

function Rail({
  title,
  type,
  catalogId,
  autoFocusFirst,
}: {
  title: string;
  type: string;
  catalogId: string;
  autoFocusFirst?: boolean;
}) {
  const [metas, setMetas] = useState<StremioMetaPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog({ type, id: catalogId })
      .then((res) => {
        if (!cancelled) setMetas(res.metas.slice(0, 30));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [type, catalogId]);

  return (
    <View style={styles.rail}>
      <Text style={styles.railTitle}>{title}</Text>
      {error ? (
        <Text style={styles.railError}>{error}</Text>
      ) : metas ? (
        <FlatList
          horizontal
          data={metas}
          keyExtractor={(m) => m.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.railInner}
          renderItem={({ item, index }) => (
            <PosterCard item={item} autoFocus={autoFocusFirst && index === 0} />
          )}
        />
      ) : (
        <ActivityIndicator color={BRAND} style={styles.railLoading} />
      )}
    </View>
  );
}

export default function App() {
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.brand}>Blissful</Text>
        <Text style={styles.subtitle}>React Native · Android TV · live Cinemeta via @blissful/core</Text>
        <Rail title="Popular Movies" type="movie" catalogId="top" autoFocusFirst />
        <Rail title="Popular Series" type="series" catalogId="top" />
      </ScrollView>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07090d' },
  scroll: { paddingTop: 44, paddingLeft: 48, paddingBottom: 60 },
  brand: { color: '#fff', fontSize: 40, fontWeight: '700' },
  subtitle: { color: BRAND, fontSize: 15, marginTop: 4, marginBottom: 28 },
  rail: { marginBottom: 34 },
  railTitle: { color: '#fff', fontSize: 22, fontWeight: '600', marginBottom: 14 },
  railInner: { gap: 16, paddingRight: 48, paddingVertical: 6 },
  railLoading: { alignSelf: 'flex-start', marginVertical: 40 },
  railError: { color: '#ff8a8a', fontSize: 14 },
  card: { width: POSTER_W },
  posterWrap: {
    width: POSTER_W,
    height: POSTER_H,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  posterWrapFocused: { borderColor: ACCENT, transform: [{ scale: 1.06 }] },
  poster: { width: '100%', height: '100%', backgroundColor: 'rgba(255,255,255,0.06)' },
  posterEmpty: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  posterEmptyText: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center' },
  cardTitle: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 8 },
  cardTitleFocused: { color: '#fff' },
});
