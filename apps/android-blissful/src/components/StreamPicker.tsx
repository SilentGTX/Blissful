import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { MediaType } from '@blissful/core';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { FocusTrap } from './FocusTrap';
import { useAuth } from '../context/AuthContext';
import { BUCKET_ORDER, loadStreams, orderForPick, type PickerStream, type ResolutionBucket } from '../lib/streamPicker';

type M = ReturnType<typeof useMetrics>;

export type StreamPickerTarget = {
  type: MediaType;
  id: string; // imdb id (movie) or imdb:S:E (series episode)
  title: string;
  episodeLabel?: string | null;
};

// A flattened list item: a section eyebrow, a collapsible bucket header, or a row.
type Item =
  | { kind: 'eyebrow'; key: string; label: string }
  | { kind: 'bucket'; key: string; bucket: ResolutionBucket; count: number }
  | { kind: 'row'; key: string; row: PickerStream; autoFocus: boolean };

function StreamRow({ row, m, autoFocus, onPlay }: { row: PickerStream; m: M; autoFocus: boolean; onPlay: (row: PickerStream) => void }) {
  const [focused, setFocused] = useState(false);
  const playable = row.url != null;
  const meta = [row.metaSeeders, row.metaSize, row.metaProvider].filter(Boolean) as string[];
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => playable && onPlay(row)}
      style={{ borderRadius: m.s(18), paddingHorizontal: m.s(16), paddingVertical: m.s(12), borderWidth: 1, borderColor: focused ? colors.accent : 'transparent', backgroundColor: focused ? 'rgba(255,255,255,0.10)' : 'transparent', opacity: playable ? 1 : 0.5 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: m.s(16) }}>
        <Text numberOfLines={2} style={{ width: m.s(132), fontFamily: font.bodySemi, fontSize: m.s(18), lineHeight: m.s(22), color: 'rgba(255,255,255,0.9)' }}>{row.leftLabel}</Text>
        <Text numberOfLines={2} style={{ flex: 1, fontFamily: font.bodySemi, fontSize: m.s(18), lineHeight: m.s(24), color: colors.text }}>{row.title}</Text>
        <View style={{ width: m.s(40), height: m.s(40), borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)', opacity: focused && playable ? 1 : 0 }}>
          <Ionicons name="play" size={m.s(22)} color={colors.text} />
        </View>
      </View>
      {meta.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(12), marginTop: m.s(6) }}>
          {meta.map((part) => (
            <Text key={part} style={{ fontFamily: font.body, fontSize: m.s(15), color: 'rgba(255,255,255,0.6)' }}>{part}</Text>
          ))}
        </View>
      ) : null}
      {row.cacheRank === 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(5), marginTop: m.s(6) }}>
          <Ionicons name="flash" size={m.s(14)} color={colors.brand} />
          <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(14), color: colors.brand }}>Cached · instant</Text>
        </View>
      ) : null}
      {!playable ? (
        <Text style={{ fontFamily: font.body, fontSize: m.s(14), color: colors.imdbGold, marginTop: m.s(4) }}>Real-Debrid required</Text>
      ) : null}
    </Pressable>
  );
}

function BucketHeader({ bucket, count, expanded, m, onPress }: { bucket: ResolutionBucket; count: number; expanded: boolean; m: M; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10), borderRadius: m.s(18), paddingHorizontal: m.s(14), paddingVertical: m.s(12), borderWidth: 1, borderColor: focused ? colors.accent : 'transparent', backgroundColor: focused ? 'rgba(255,255,255,0.08)' : 'transparent' }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(19), color: 'rgba(255,255,255,0.9)' }}>{bucket}</Text>
      <View style={{ borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: m.s(8), paddingVertical: m.s(1) }}>
        <Text style={{ fontFamily: font.body, fontSize: m.s(13), color: 'rgba(255,255,255,0.6)' }}>{count}</Text>
      </View>
      <View style={{ flex: 1 }} />
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={m.s(20)} color="rgba(255,255,255,0.7)" />
    </Pressable>
  );
}

function Eyebrow({ label, m }: { label: string; m: M }) {
  return (
    <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(14), letterSpacing: m.s(1.5), textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', paddingHorizontal: m.s(14), paddingTop: m.s(12), paddingBottom: m.s(4) }}>
      {label}
    </Text>
  );
}

export type PlayableStream = { url: string; title: string };

export function StreamPicker({
  target,
  onClose,
  onPlay,
}: {
  target: StreamPickerTarget | null;
  onClose: () => void;
  // The full ranked playable list + the chosen index, so the player can
  // auto-skip a stream that resolves to the ~30s debrid DMCA placeholder.
  onPlay: (streams: PlayableStream[], index: number) => void;
}) {
  const m = useMetrics();
  const { token } = useAuth();
  const [rows, setRows] = useState<PickerStream[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<ResolutionBucket>>(new Set());

  useEffect(() => {
    if (!target) return;
    const ctrl = new AbortController();
    setLoading(true);
    setRows([]);
    setExpanded(new Set());
    loadStreams(token, target.type, target.id, { signal: ctrl.signal, onRows: setRows, title: target.title })
      .then(setRows)
      .catch(() => { /* keep whatever arrived progressively */ })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [target, token]);

  useEffect(() => {
    if (!target) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [target, onClose]);

  // TOP PICKS = best 4K + best 1080p. Rows are rank-sorted cached-first, so the
  // first of each bucket is the best instantly-streamable ([RD+]) release when
  // one exists, else the best overall. Buckets below exclude the pinned rows and
  // start collapsed.
  const { items } = useMemo(() => {
    const byBucket: Record<ResolutionBucket, PickerStream[]> = { '4K': [], '1080p': [], '720p': [], SD: [], Other: [] };
    rows.forEach((r) => byBucket[r.bucket].push(r));
    // Hide confirmed-not-cached ([RD download], cacheRank 2) per bucket unless
    // that empties it — mirrors the web BananasPicker. No-op for non-RD profiles
    // (no markers → everything is cacheRank 1, kept).
    BUCKET_ORDER.forEach((b) => {
      const cached = byBucket[b].filter((r) => r.cacheRank < 2);
      if (cached.length > 0) byBucket[b] = cached;
    });
    const pinned = [byBucket['4K'][0], byBucket['1080p'][0]].filter(Boolean) as PickerStream[];
    const pinnedKeys = new Set(pinned.map((p) => p.key));

    const list: Item[] = [];
    let autoFocusUsed = false;
    const pushRow = (row: PickerStream) => {
      list.push({ kind: 'row', key: row.key, row, autoFocus: !autoFocusUsed });
      autoFocusUsed = true;
    };
    if (pinned.length) {
      list.push({ kind: 'eyebrow', key: 'eb-top', label: 'Top picks' });
      pinned.forEach(pushRow);
    }
    BUCKET_ORDER.forEach((b) => {
      const bucketRows = byBucket[b].filter((r) => !pinnedKeys.has(r.key));
      if (bucketRows.length === 0) return;
      list.push({ kind: 'bucket', key: `bk-${b}`, bucket: b, count: bucketRows.length });
      if (expanded.has(b)) bucketRows.forEach(pushRow);
    });
    return { items: list };
  }, [rows, expanded]);

  if (!target) return null;

  const playRow = (row: PickerStream) => {
    if (!row.url) return;
    // Order the playlist so the chosen QUALITY is preferred on auto-advance: the
    // pick first, then other same-bucket streams, then the rest (rank order) — so
    // a not-cached 4K pick falls to another 4K before dropping to 1080p.
    onPlay(orderForPick(rows, row.url), 0);
  };

  const panelW = Math.min(m.s(900), m.width * 0.72);
  const toggle = (b: ResolutionBucket) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b); else next.add(b);
      return next;
    });

  return (
    <View style={styles.backdrop}>
      <Pressable style={StyleSheet.absoluteFill} focusable={false} onPress={onClose} />
      <FocusTrap style={{ width: panelW, maxHeight: m.height * 0.86, borderRadius: m.s(28), overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
        <LinearGradient colors={['rgba(22,27,38,0.99)', 'rgba(10,13,20,0.995)']} start={{ x: 0.85, y: 0 }} end={{ x: 0.15, y: 1 }} style={StyleSheet.absoluteFill} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(14), paddingHorizontal: m.s(22), paddingTop: m.s(20), paddingBottom: m.s(12) }}>
          <IconBtn m={m} icon="chevron-back" onPress={onClose} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ textAlign: 'center', fontFamily: font.bodySemi, fontSize: m.s(26), color: colors.text }}>{target.title}</Text>
            {target.episodeLabel ? (
              <Text numberOfLines={1} style={{ textAlign: 'center', fontFamily: font.body, fontSize: m.s(18), color: colors.textDim }}>{target.episodeLabel}</Text>
            ) : null}
          </View>
          <IconBtn m={m} icon="close" onPress={onClose} />
        </View>

        <View style={{ flexGrow: 1, flexShrink: 1, paddingHorizontal: m.s(18), paddingBottom: m.s(20) }}>
          {loading && rows.length === 0 ? (
            <View style={{ paddingVertical: m.s(50), alignItems: 'center' }}>
              <ActivityIndicator color={colors.accent} size="large" />
            </View>
          ) : rows.length === 0 ? (
            <View style={{ borderRadius: m.s(16), borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)', padding: m.s(16) }}>
              <Text style={{ fontFamily: font.body, fontSize: m.s(18), color: 'rgba(255,255,255,0.7)' }}>No streams found.</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(it) => it.key}
              removeClippedSubviews={false}
              showsVerticalScrollIndicator={false}
              ListFooterComponent={loading ? <ActivityIndicator color={colors.accent} style={{ marginVertical: m.s(14) }} /> : null}
              renderItem={({ item }) => {
                if (item.kind === 'eyebrow') return <Eyebrow label={item.label} m={m} />;
                if (item.kind === 'bucket') return <BucketHeader bucket={item.bucket} count={item.count} expanded={expanded.has(item.bucket)} m={m} onPress={() => toggle(item.bucket)} />;
                return <StreamRow row={item.row} m={m} autoFocus={item.autoFocus} onPlay={playRow} />;
              }}
            />
          )}
        </View>
      </FocusTrap>
    </View>
  );
}

function IconBtn({ m, icon, onPress, autoFocus }: { m: M; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; autoFocus?: boolean }) {
  const [f, setF] = useState(false);
  const sz = m.s(44);
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ width: sz, height: sz, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: f ? colors.accent : 'transparent' }}
    >
      <Ionicons name={icon} size={m.s(22)} color="rgba(255,255,255,0.85)" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 250, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(3,5,10,0.66)' },
});
