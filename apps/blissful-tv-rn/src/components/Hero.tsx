import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchMeta, normalizeStremioImage, type StremioMetaDetail, type StremioMetaPreview } from '@blissful/core';
import { colors, font, radius } from '../theme/colors';
import type { RootStackParamList } from '../navigation/types';

type Nav = StackNavigationProp<RootStackParamList, 'Home'>;

function HeroBtn({
  label,
  icon,
  primary,
  autoFocus,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  primary?: boolean;
  autoFocus?: boolean;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={[
        styles.btn,
        primary ? styles.btnPrimary : styles.btnGlass,
        focused && (primary ? styles.btnPrimaryFocused : styles.btnGlassFocused),
      ]}
    >
      <Ionicons name={icon} size={20} color={primary ? colors.accentInk : colors.text} />
      <Text style={[styles.btnText, { color: primary ? colors.accentInk : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Hero({ item }: { item: StremioMetaPreview }) {
  const navigation = useNavigation<Nav>();
  const [meta, setMeta] = useState<StremioMetaDetail['meta'] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMeta({ type: item.type, id: item.id })
      .then((r) => {
        if (!cancelled) setMeta(r.meta);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [item.id, item.type]);

  const bg = normalizeStremioImage(meta?.background) ?? normalizeStremioImage(item.poster);
  const genres = (meta?.genres ?? meta?.genre ?? item.genres ?? []).slice(0, 3);
  const year = meta?.releaseInfo ?? item.releaseInfo ?? (meta?.year != null ? String(meta.year) : '');
  const rating = meta?.imdbRating ?? item.imdbRating;
  const runtime = meta?.runtime;
  const desc = meta?.description ?? item.description ?? '';
  const metaLine = [year, rating ? `${rating} IMDb` : null, runtime].filter(Boolean).join('   ·   ');

  return (
    <View style={styles.hero}>
      {bg ? <Image source={{ uri: bg }} style={styles.bg} resizeMode="cover" /> : null}
      <LinearGradient
        colors={['rgba(0,0,0,0.10)', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.72)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.content}>
        <Text style={styles.eyebrow}>🔥  NOW POPULAR</Text>
        <View style={styles.spacer} />
        {genres.length ? (
          <View style={styles.chips}>
            {genres.map((g) => (
              <View key={g} style={styles.chip}>
                <Text style={styles.chipText}>{g}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <Text style={styles.title} numberOfLines={2}>
          {item.name}
        </Text>
        {metaLine ? <Text style={styles.meta}>{metaLine}</Text> : null}
        {desc ? (
          <Text style={styles.desc} numberOfLines={2}>
            {desc}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <HeroBtn
            label="Watch now"
            icon="play"
            primary
            autoFocus
            onPress={() =>
              navigation.navigate('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster })
            }
          />
          <HeroBtn label="Add to library" icon="bookmark-outline" onPress={() => { /* library — needs auth */ }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 420,
    borderRadius: radius.hero,
    overflow: 'hidden',
    backgroundColor: '#0f1115',
    marginBottom: 36,
  },
  bg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  content: { flex: 1, padding: 34 },
  eyebrow: {
    fontFamily: font.bodySemi,
    fontSize: 13,
    letterSpacing: 4,
    color: colors.textDim,
  },
  spacer: { flex: 1 },
  chips: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  chip: {
    backgroundColor: colors.surface12,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  chipText: { fontFamily: font.bodySemi, fontSize: 12, color: 'rgba(255,255,255,0.9)' },
  title: { fontFamily: font.serif, fontSize: 44, color: colors.text, lineHeight: 48 },
  meta: { fontFamily: font.bodyMed, fontSize: 15, color: 'rgba(255,255,255,0.8)', marginTop: 12 },
  desc: { fontFamily: font.body, fontSize: 15, color: colors.textDim, marginTop: 12, maxWidth: '60%', lineHeight: 22 },
  actions: { flexDirection: 'row', gap: 14, marginTop: 22 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 52,
    paddingHorizontal: 26,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryFocused: { borderColor: colors.text },
  btnGlass: { backgroundColor: colors.surface08, borderColor: colors.hairline },
  btnGlassFocused: { borderColor: colors.accent },
  btnText: { fontFamily: font.bodySemi, fontSize: 16 },
});
