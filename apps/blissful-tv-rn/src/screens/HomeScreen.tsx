import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { findNodeHandle, ScrollView, StyleSheet, View } from 'react-native';
import { fetchCatalog, fetchMeta, normalizeStremioImage, type MediaType, type StremioMetaPreview } from '@blissful/core';
import { colors } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useRailOpen } from '../lib/railStore';
import { useAuth } from '../context/AuthContext';
import { fetchContinueWatching, type CwItem } from '../lib/continueWatching';
import { loadStreams } from '../lib/streamPicker';
import { Hero } from '../components/Hero';
import { ItemsRail } from '../components/ItemsRail';
import { NavRail } from '../components/NavRail';
import { Rail } from '../components/Rail';
import { ResumeModal } from '../components/ResumeModal';
import { BufferingVeil } from '../components/player/BufferingVeil';
import { TopBar } from '../components/TopBar';
import type { CardItem } from '../components/PosterCard';
import type { RootStackParamList } from '../navigation/types';

type Nav = StackNavigationProp<RootStackParamList, 'Home'>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const m = useMetrics();
  const railOpen = useRailOpen();
  const { token } = useAuth();
  const [featured, setFeatured] = useState<StremioMetaPreview | null>(null);
  const [cw, setCw] = useState<CwItem[]>([]);
  const [resumeItem, setResumeItem] = useState<CwItem | null>(null);
  // Black + pulsing-logo veil shown while a CW Resume/Start-over resolves a real
  // stream — it carries the SAME title logo the player's veil shows, so the
  // hand-off into the player is a seamless logo merge (no black gap, no swap).
  const [resolving, setResolving] = useState<{ logo: string | null } | null>(null);
  const resolveAbort = useRef<AbortController | null>(null);
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
  // Resolve a REAL stream for the CW title (not the old test sample): show the
  // black+logo veil, fetch the meta logo + the user's addon streams, then jump
  // straight to the player with the playable list. `startSeconds` = resume pos
  // (0 for Start-over). No playable stream → fall back to the title's Detail.
  const playCw = useCallback(async (item: CwItem, startSeconds: number) => {
    setResumeItem(null);
    setResolving({ logo: null }); // black immediately; logo fades in once meta lands
    resolveAbort.current?.abort();
    const ctrl = new AbortController();
    resolveAbort.current = ctrl;
    const type = (item.type === 'series' ? 'series' : 'movie') as MediaType;
    const streamId = item.type === 'series' ? (item.videoId ?? item.id) : item.id;
    try {
      const [meta, streams] = await Promise.all([
        fetchMeta({ type: item.type as MediaType, id: item.id, signal: ctrl.signal }).then((r) => r.meta).catch(() => null),
        loadStreams(token, type, streamId, { signal: ctrl.signal }),
      ]);
      if (ctrl.signal.aborted) return;
      const logo = normalizeStremioImage(meta?.logo) ?? null;
      setResolving({ logo });
      const playable = streams.filter((s) => s.url).map((s) => ({ url: s.url as string, title: s.title }));
      if (playable.length === 0) {
        setResolving(null);
        navigation.navigate('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster });
        return;
      }
      navigation.navigate('Player', {
        url: playable[0].url,
        title: item.name,
        playlist: playable,
        startIndex: 0,
        logo,
        background: normalizeStremioImage(meta?.background),
        startSeconds,
        description: meta?.description ?? null,
        releaseInfo: meta?.releaseInfo ?? (meta?.year != null ? String(meta.year) : null),
        imdbId: meta?.imdb_id ?? null,
        rating: meta?.imdbRating != null ? String(meta.imdbRating) : null,
      });
      setTimeout(() => setResolving(null), 600); // player now covers the veil
    } catch {
      setResolving(null);
    }
  }, [navigation, token]);

  return (
    <View style={styles.root}>
      <NavRail active="Home" />
      <TopBar searchRef={searchRef} />
      <ScrollView
        // While the rail is open, the whole content area is non-focusable so the
        // D-pad can't reach a card behind the rail. ONE view flips, not 40 — the
        // per-card flip stalled the native tvos focus engine (~1.3s).
        isTVSelectable={!railOpen}
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
        onResume={(i) => playCw(i, i.resumeSeconds)}
        onStartOver={(i) => playCw(i, 0)}
        onGoToDetail={(i) => navigation.navigate('Detail', { id: i.id, type: i.type, name: i.name, poster: i.poster })}
        onClose={() => setResumeItem(null)}
      />

      {/* Pre-navigation black + logo veil while a Resume resolves a stream. */}
      {resolving ? <BufferingVeil visible black logo={resolving.logo} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
});
