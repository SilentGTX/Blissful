import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetchMeta, normalizeStremioImage, type StremioMetaDetail } from '@blissful/core';
import { colors, layout } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';

type DetailRoute = RouteProp<RootStackParamList, 'Detail'>;
type Nav = StackNavigationProp<RootStackParamList, 'Detail'>;

// Placeholder stream until the addon stream picker (needs auth + the user's
// addons) is wired. Proves the player path end-to-end on the emulator.
// (HLS — ExoPlayer plays it natively; also exercises the adaptive path.)
const SAMPLE_STREAM = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

function FocusButton({
  label,
  autoFocus,
  onPress,
}: {
  label: string;
  autoFocus?: boolean;
  onPress?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[styles.btn, focused && styles.btnFocused]}
    >
      <Text style={[styles.btnText, focused && styles.btnTextFocused]}>{label}</Text>
    </Pressable>
  );
}

export function DetailScreen() {
  const { params } = useRoute<DetailRoute>();
  const navigation = useNavigation<Nav>();
  const [meta, setMeta] = useState<StremioMetaDetail['meta'] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMeta({ type: params.type, id: params.id })
      .then((res) => {
        if (!cancelled) setMeta(res.meta);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [params.type, params.id]);

  const background = normalizeStremioImage(meta?.background) ?? normalizeStremioImage(params.poster);
  const metaLine = [
    meta?.releaseInfo ?? (meta?.year != null ? String(meta.year) : undefined),
    meta?.imdbRating ? `IMDb ${meta.imdbRating}` : undefined,
    meta?.runtime,
  ]
    .filter(Boolean)
    .join('  ·  ');
  const genres = meta?.genres ?? meta?.genre ?? [];
  const episodeCount = meta?.videos?.length ?? 0;

  return (
    <View style={styles.root}>
      {background ? (
        <Image source={{ uri: background }} style={styles.backdrop} resizeMode="cover" blurRadius={2} />
      ) : null}
      <View style={styles.scrim} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{meta?.name ?? params.name}</Text>
        {metaLine ? <Text style={styles.metaLine}>{metaLine}</Text> : null}
        {genres.length ? <Text style={styles.genres}>{genres.slice(0, 4).join(' · ')}</Text> : null}

        <View style={styles.actions}>
          <FocusButton
            label="Play"
            autoFocus
            onPress={() =>
              navigation.navigate('Player', { url: SAMPLE_STREAM, title: meta?.name ?? params.name })
            }
          />
          <FocusButton label="Back" onPress={() => navigation.goBack()} />
        </View>

        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 24, alignSelf: 'flex-start' }} />
        ) : (
          <>
            {meta?.description ? (
              <Text style={styles.description} numberOfLines={6}>
                {meta.description}
              </Text>
            ) : null}
            {params.type === 'series' && episodeCount > 0 ? (
              <Text style={styles.episodes}>{episodeCount} episodes</Text>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.5 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(7,9,13,0.62)' },
  scroll: { paddingTop: 56, paddingHorizontal: layout.safeX, paddingBottom: 60, maxWidth: 900 },
  title: { color: colors.text, fontSize: 44, fontWeight: '700' },
  metaLine: { color: colors.brand, fontSize: 16, marginTop: 10 },
  genres: { color: colors.textDim, fontSize: 15, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 16, marginTop: 26 },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 999,
    backgroundColor: colors.surface12,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  btnFocused: { borderColor: colors.accent, backgroundColor: 'rgba(149,162,255,0.22)' },
  btnText: { color: colors.textDim, fontSize: 17, fontWeight: '600' },
  btnTextFocused: { color: colors.text },
  description: { color: colors.textDim, fontSize: 16, lineHeight: 24, marginTop: 28 },
  episodes: { color: colors.textFaint, fontSize: 15, marginTop: 18 },
});
