import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { fetchCatalog, type MediaType, type StremioMetaPreview } from '@blissful/core';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { PosterCard, type CardItem } from './PosterCard';

export const Rail = memo(function Rail({
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
  onSelect: (item: CardItem) => void;
}) {
  const m = useMetrics();
  const [metas, setMetas] = useState<StremioMetaPreview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const posterW = m.s(200);

  useEffect(() => {
    let cancelled = false;
    fetchCatalog({ type, id: catalogId })
      .then((res) => !cancelled && setMetas(res.metas.slice(0, 30)))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load'));
    return () => {
      cancelled = true;
    };
  }, [type, catalogId]);

  return (
    <View style={{ marginBottom: m.s(34) }}>
      <Text style={{ fontFamily: font.bodySemi, color: colors.text, fontSize: m.railTitle, marginBottom: m.s(14), marginLeft: m.s(20) }}>
        {title}
      </Text>
      {error ? (
        <Text style={{ fontFamily: font.body, color: colors.danger, fontSize: m.s(24) }}>{error}</Text>
      ) : metas ? (
        <FlatList
          horizontal
          data={metas}
          keyExtractor={(it) => it.id}
          showsHorizontalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={5}
          // No getItemLayout — it makes Android ignore paddingLeft and clip the
          // focused first card's scale (see ItemsRail). Flexbox honours paddingLeft.
          contentContainerStyle={{ gap: m.s(24), paddingTop: m.s(20), paddingBottom: m.s(12), paddingLeft: m.s(20), paddingRight: m.safeX }}
          renderItem={({ item, index }) => (
            <PosterCard item={item} width={posterW} autoFocus={autoFocusFirst && index === 0} atRowStart={index === 0} onSelect={onSelect} />
          )}
        />
      ) : (
        <ActivityIndicator color={colors.brand} style={styles.loading} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  loading: { alignSelf: 'flex-start', marginVertical: 40 },
});
