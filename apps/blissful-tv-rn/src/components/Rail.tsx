import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { fetchCatalog, type MediaType, type StremioMetaPreview } from '@blissful/core';
import { colors, font, layout } from '../theme/colors';
import { PosterCard } from './PosterCard';

export function Rail({
  title,
  type,
  catalogId,
  autoFocusFirst,
  onSelect,
}: {
  title: string;
  type: MediaType;
  catalogId: string;
  autoFocusFirst?: boolean;
  onSelect: (item: StremioMetaPreview) => void;
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
            <PosterCard
              item={item}
              autoFocus={autoFocusFirst && index === 0}
              onSelect={onSelect}
            />
          )}
        />
      ) : (
        <ActivityIndicator color={colors.brand} style={styles.railLoading} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { marginBottom: 34 },
  railTitle: { fontFamily: font.bodySemi, color: colors.text, fontSize: 22, marginBottom: 14 },
  railInner: { gap: 16, paddingRight: layout.safeX, paddingVertical: 6 },
  railLoading: { alignSelf: 'flex-start', marginVertical: 40 },
  railError: { color: colors.danger, fontSize: 14 },
});
