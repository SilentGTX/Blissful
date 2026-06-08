import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  fetchBlissfulLibrary,
  normalizeStremioImage,
  putBlissfulLibraryItem,
  type LibraryItem,
  type MediaType,
} from '@blissful/core';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useRailOpen } from '../lib/railStore';
import { useAuth } from '../context/AuthContext';
import { markContentFocus } from '../lib/focusBus';
import { NavRail } from '../components/NavRail';
import { TopBar } from '../components/TopBar';
import { type CardItem } from '../components/PosterCard';
import { LibraryPosterCard } from '../components/LibraryPosterCard';
import { TvSelect, TvSelectOverlay, type DropdownAnchor, type SelectOption } from '../components/TvSelect';

// 1:1 with apps/blissful-mvs/src/pages/LibraryPage.tsx — same filters, sort
// chips, watched chips, type dropdown, progress bars + the soft-remove write.
// On TV removal is hold-OK on the card (onLongPress), mirroring the web TV
// build (the X overlay is desktop-mouse only there).

type SortMode = 'last_watched' | 'az' | 'za' | 'most_watched';
type WatchedFilter = 'all' | 'watched' | 'not_watched';

const SORT_CHIPS: { key: SortMode; label: string }[] = [
  { key: 'last_watched', label: 'Last watched' },
  { key: 'az', label: 'A-Z' },
  { key: 'za', label: 'Z-A' },
  { key: 'most_watched', label: 'Most watched' },
];
const WATCHED_CHIPS: { key: Exclude<WatchedFilter, 'all'>; label: string }[] = [
  { key: 'watched', label: 'Watched' },
  { key: 'not_watched', label: 'Not watched' },
];

function typeLabel(type: string): string {
  const raw = type.trim();
  if (!raw) return 'Other';
  if (raw === 'movie') return 'Movies';
  if (raw === 'series') return 'Series';
  if (raw === 'channel') return 'TV Channels';
  if (raw === 'tv') return 'TV';
  return raw.slice(0, 1).toUpperCase() + raw.slice(1);
}

// percentProgress — same as LibraryPage: a 2% sentinel when duration is unknown.
function percentProgress(item: LibraryItem): number | null {
  const offset = typeof item.state?.timeOffset === 'number' ? item.state.timeOffset : null;
  const duration = typeof item.state?.duration === 'number' ? item.state.duration : null;
  if (offset === null) return null;
  if (!Number.isFinite(offset) || offset <= 0) return null;
  if (duration === null || !Number.isFinite(duration) || duration <= 0) return 2;
  return Math.min(100, Math.max(0, (offset / duration) * 100));
}

function isWatched(it: LibraryItem): boolean {
  const times = typeof it.state?.timesWatched === 'number' ? it.state.timesWatched : 0;
  const flagged = typeof it.state?.flaggedWatched === 'number' ? it.state.flaggedWatched : 0;
  const watchedRaw = typeof it.state?.watched === 'string' ? it.state.watched.trim() : '';
  return times > 0 || flagged > 0 || watchedRaw.length > 0;
}

function withMtime(it: LibraryItem): number {
  if (typeof it._mtime === 'number') return it._mtime;
  const n = Date.parse(String(it._mtime ?? ''));
  return Number.isFinite(n) ? n : 0;
}

// A focusable pill chip with the lavender ring on focus. Matches the web TV
// rounded-full chip (white when active, white/10 otherwise).
function Chip({
  label,
  active,
  atRowStart,
  m,
  onPress,
}: {
  label: string;
  active: boolean;
  atRowStart?: boolean;
  m: ReturnType<typeof useMetrics>;
  onPress: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      onFocus={() => { setFocused(true); markContentFocus(Boolean(atRowStart)); }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        height: m.s(52),
        paddingHorizontal: m.s(22),
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 999,
        backgroundColor: active ? colors.text : 'rgba(255,255,255,0.10)',
        borderWidth: 1,
        borderColor: focused ? colors.accent : 'transparent',
      }}
    >
      <Text
        numberOfLines={1}
        style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: active ? colors.ink : 'rgba(255,255,255,0.9)' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function LibraryScreen() {
  const navigation = useNavigation<any>();
  const m = useMetrics();
  const railOpen = useRailOpen();
  const { token } = useAuth();

  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('last_watched');
  const [watchedFilter, setWatchedFilter] = useState<WatchedFilter>('all');
  const [dropdown, setDropdown] = useState<DropdownAnchor | null>(null);
  const hasLoadedOnceRef = useRef(false);

  // Load + 30s refresh, exactly like LibraryPage. There is no window 'focus'
  // event on RN; the interval covers the same staleness window.
  useEffect(() => {
    if (!token) {
      setItems([]);
      setLoading(false);
      setError(null);
      hasLoadedOnceRef.current = false;
      return;
    }
    let cancelled = false;
    const refresh = () => {
      const showLoading = !hasLoadedOnceRef.current;
      if (showLoading) setLoading(true);
      setError(null);
      fetchBlissfulLibrary<LibraryItem>(token)
        .then((result) => {
          if (cancelled) return;
          hasLoadedOnceRef.current = true;
          setItems(result.filter((it) => !it.removed));
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : 'Failed to load library');
          if (showLoading) setItems([]);
        })
        .finally(() => {
          if (cancelled) return;
          if (showLoading) setLoading(false);
        });
    };
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token]);

  const filtered = useMemo(() => {
    const byType = typeFilter === 'all' ? items : items.filter((it) => it.type === typeFilter);
    const byWatched =
      watchedFilter === 'all'
        ? byType
        : watchedFilter === 'watched'
          ? byType.filter(isWatched)
          : byType.filter((it) => !isWatched(it));

    const withTimesWatched = (it: LibraryItem) => (typeof it.state?.timesWatched === 'number' ? it.state.timesWatched : 0);
    const withTimeWatched = (it: LibraryItem) => (typeof it.state?.timeWatched === 'number' ? it.state.timeWatched : 0);

    return byWatched.slice().sort((a, b) => {
      if (sortMode === 'az') return a.name.localeCompare(b.name);
      if (sortMode === 'za') return b.name.localeCompare(a.name);
      if (sortMode === 'most_watched') {
        const dt = withTimesWatched(b) - withTimesWatched(a);
        if (dt !== 0) return dt;
        const d2 = withTimeWatched(b) - withTimeWatched(a);
        if (d2 !== 0) return d2;
        return withMtime(b) - withMtime(a);
      }
      return withMtime(b) - withMtime(a);
    });
  }, [items, sortMode, typeFilter, watchedFilter]);

  // type dropdown options (All + each distinct type, known types first).
  const typeOptions = useMemo<SelectOption[]>(() => {
    const seen = new Set<string>();
    for (const it of items) {
      const t = String(it.type ?? '').trim();
      if (t) seen.add(t);
    }
    const known = ['movie', 'series', 'channel'];
    const list = Array.from(seen).sort((a, b) => {
      const ia = known.indexOf(a);
      const ib = known.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.localeCompare(b);
    });
    return [{ key: 'all', label: 'All' }, ...list.map((t) => ({ key: t, label: typeLabel(t) }))];
  }, [items]);

  // Per-item card data (stable identity so memoised PosterCards don't reflow on
  // a library poll / focus move). Carries the progress bar + the videoId used
  // for series deep-links.
  const cells = useMemo(
    () =>
      filtered.map((item) => ({
        item,
        videoId: item.type === 'series' ? item.state?.video_id ?? null : null,
        progress: percentProgress(item) ?? undefined,
        card: {
          id: item._id,
          type: item.type,
          name: item.name,
          poster: normalizeStremioImage(item.poster) ?? null,
        } as CardItem,
      })),
    [filtered]
  );
  const byId = useMemo(() => new Map(cells.map((c) => [c.item._id, c])), [cells]);

  const onSelect = useCallback(
    (card: CardItem) => {
      const cell = byId.get(card.id);
      if (!cell) return;
      const type = (cell.item.type === 'series' ? 'series' : cell.item.type === 'channel' ? 'channel' : 'movie') as MediaType;
      navigation.navigate('Detail', {
        id: cell.item._id,
        type,
        name: cell.item.name,
        poster: cell.card.poster ?? undefined,
      });
    },
    [byId, navigation]
  );

  // Soft-remove (upsert removed:true), optimistically dropping it from the grid.
  // Same backend write as the detail page; the 30s refresh reconciles failures.
  const removeItem = useCallback(
    (card: CardItem) => {
      if (!token) return;
      const cell = byId.get(card.id);
      if (!cell) return;
      setItems((prev) => prev.filter((x) => x._id !== card.id));
      void putBlissfulLibraryItem(token, card.id, { ...cell.item, removed: true }).catch(() => {});
    },
    [byId, token]
  );

  const posterW = m.s(180);
  const padL = m.s(20); // clears the focused first-column card's 1.06 scale (no left clip)
  const gap = m.s(24);
  const cols = Math.max(2, Math.floor((m.width - m.contentLeft - m.safeX - padL + gap) / (posterW + gap)));

  // Not logged in: a login prompt panel (web shows the same copy + Login CTA).
  if (!token) {
    return (
      <View style={styles.root}>
        <NavRail active="Library" />
        <TopBar />
        <View
          isTVSelectable={!railOpen}
          style={{ position: 'absolute', left: m.contentLeft, top: m.contentTop, right: m.safeX, bottom: 0 }}
        >
          <View style={[styles.panel, { borderRadius: m.s(28), padding: m.s(28) }]}>
            <Text style={{ fontFamily: font.serif, fontSize: m.s(40), color: colors.text }}>Library</Text>
            <Text style={{ fontFamily: font.body, fontSize: m.s(22), color: colors.textFaint, marginTop: m.s(6) }}>
              Login to see your Stremio library.
            </Text>
            <View style={{ marginTop: m.s(22), flexDirection: 'row' }}>
              <Chip label="Login" active atRowStart m={m} onPress={() => navigation.navigate('Login')} />
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <NavRail active="Library" />
      <TopBar />
      {/* One isTVSelectable flip cascades to the dropdown + chips + grid so an
          open rail traps focus (per-card flips stall the tvos focus engine). */}
      <View
        isTVSelectable={!railOpen}
        style={{ position: 'absolute', left: m.contentLeft, top: m.contentTop, right: m.safeX, bottom: 0 }}
      >
        <Text style={{ fontFamily: font.serif, fontSize: m.s(40), color: colors.text, marginLeft: padL, marginBottom: m.s(14) }}>
          Library
        </Text>

        {/* Filters row: Type dropdown + sort chips + watched chips. Horizontal
            scroll so the chip row never clips on a narrow panel; the type
            dropdown is the left-edge focusable (atRowStart -> opens the rail). */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginBottom: m.s(18) }}
          contentContainerStyle={{ alignItems: 'center', gap: m.s(12), paddingLeft: padL, paddingRight: m.safeX, paddingVertical: m.s(6) }}
        >
          <TvSelect
            iconName="albums-outline"
            options={typeOptions}
            value={typeFilter}
            onChange={setTypeFilter}
            m={m}
            minWidth={m.s(184)}
            atRowStart
            onOpen={setDropdown}
          />
          {SORT_CHIPS.map((chip) => (
            <Chip
              key={chip.key}
              label={chip.label}
              active={sortMode === chip.key}
              m={m}
              onPress={() => setSortMode(chip.key)}
            />
          ))}
          {WATCHED_CHIPS.map((chip) => (
            <Chip
              key={chip.key}
              label={chip.label}
              active={watchedFilter === chip.key}
              m={m}
              onPress={() => setWatchedFilter((prev) => (prev === chip.key ? 'all' : chip.key))}
            />
          ))}
        </ScrollView>

        {loading ? (
          <ActivityIndicator color={colors.accent} size="large" style={{ marginTop: m.s(60), alignSelf: 'flex-start', marginLeft: padL }} />
        ) : error ? (
          <Text style={{ fontFamily: font.body, fontSize: m.s(22), color: colors.danger, marginLeft: padL, marginTop: m.s(20) }}>
            {error}
          </Text>
        ) : cells.length === 0 ? (
          <Text style={{ fontFamily: font.body, fontSize: m.s(22), color: colors.textFaint, marginLeft: padL, marginTop: m.s(20) }}>
            No library items found.
          </Text>
        ) : (
          <FlatList
            data={cells}
            key={cols}
            numColumns={cols}
            style={{ height: m.height - m.contentTop - m.s(120) }}
            removeClippedSubviews={false}
            initialNumToRender={cols * 3}
            maxToRenderPerBatch={cols * 2}
            windowSize={5}
            keyExtractor={(c) => c.item._id}
            contentContainerStyle={{ gap: m.s(20), paddingTop: m.s(8), paddingBottom: m.s(40), paddingLeft: padL }}
            columnWrapperStyle={{ gap: m.s(24) }}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => (
              <LibraryPosterCard
                item={item.card}
                width={posterW}
                progress={item.progress}
                autoFocus={index === 0}
                atRowStart={index % cols === 0}
                onSelect={onSelect}
                onLongSelect={removeItem}
              />
            )}
          />
        )}
      </View>

      {dropdown ? <TvSelectOverlay anchor={dropdown} onClose={() => setDropdown(null)} m={m} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  panel: { backgroundColor: 'rgba(28,33,46,0.97)', borderWidth: 1, borderColor: colors.hairline, alignSelf: 'flex-start' },
});
