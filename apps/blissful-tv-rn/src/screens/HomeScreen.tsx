import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, useTVEventHandler, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { fetchBlissfulLibrary, fetchCatalog, fetchMeta, normalizeStremioImage, putBlissfulLibraryItem, type LibraryItem, type MediaType, type StremioMetaDetail } from '@blissful/core';
import { colors } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useAuth } from '../context/AuthContext';
import { fetchContinueWatching, type CwItem } from '../lib/continueWatching';
import { formatReleaseInfo } from '../lib/releaseInfo';
import { loadStreams } from '../lib/streamPicker';
import { NavRail } from '../components/NavRail';
import { ProfileMenu } from '../components/ProfileMenu';
import { ResumeModal } from '../components/ResumeModal';
import { BufferingVeil } from '../components/player/BufferingVeil';
import { Backdrop, InfoPanel } from '../components/home/HomeHero';
import { HomeActionOverlay } from '../components/home/HomeActionOverlay';
import { HomeTopRight } from '../components/home/HomeTopRight';
import { LandscapeRail } from '../components/home/LandscapeRail';
import type { TileRect } from '../components/home/LandscapeTile';
import { cwToHomeItem, metaToHomeItem, type HomeItem } from '../components/home/homeData';
import type { RootStackParamList } from '../navigation/types';

type Nav = StackNavigationProp<RootStackParamList, 'Home'>;
type Meta = StremioMetaDetail['meta'];
type RowDef = { key: string; title: string; items: HomeItem[]; seeAll?: () => void };

// Remembers each CW title's landscape logo across resumes so the black resolving
// veil can paint it instantly on a repeat resume (no black-without-logo gap).
const cwLogoCache = new Map<string, string | null>();

// Caches the featured meta per title (`type:id`) so moving focus back to a title
// repaints its InfoPanel instantly — no re-fetch, no blank.
const metaCache = new Map<string, Meta>();

// The immersive 10-foot home (design/home): a full-bleed backdrop + featured
// InfoPanel that follow the focused tile, over a lower band of landscape-tile
// rails that focus-scroll so the active row sits at the top. The real NavRail
// (live Friends panel + Search) is kept; the design's mock Sidebar isn't.
export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const m = useMetrics();
  const { token } = useAuth();

  const [cw, setCw] = useState<HomeItem[]>([]);
  const [cwReady, setCwReady] = useState(false); // CW fetch resolved → safe to mount rows
  const [popMovies, setPopMovies] = useState<HomeItem[]>([]);
  const [popSeries, setPopSeries] = useState<HomeItem[]>([]);
  // The focused item drives the Backdrop + InfoPanel; its full meta (blurb /
  // genres / runtime / hi-res backdrop) is fetched lazily on focus.
  const [focused, setFocused] = useState<HomeItem | null>(null);
  // Carries the meta WITH the title key it belongs to. The InfoPanel keeps showing
  // it across focus changes (no blank/flash); the Backdrop only trusts it when the
  // key matches the focused item (else it uses the item's own poster art — so the
  // big backdrop never shows a stale title).
  const [focusedMeta, setFocusedMeta] = useState<{ key: string; meta: Meta } | null>(null);
  const [resumeItem, setResumeItem] = useState<CwItem | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [avatarTag, setAvatarTag] = useState<number | null>(null);
  const [resolving, setResolving] = useState<{ logo: string | null } | null>(null);
  // The held tile → on-tile action overlay (add/remove library, remove progress).
  // `actionRect` is the tile's measured window rect so the root overlay lands on it.
  const [actionItem, setActionItem] = useState<HomeItem | null>(null);
  const [actionRect, setActionRect] = useState<TileRect | null>(null);
  // Full library, keyed by id — drives the action sheet's Add/Remove label + carries
  // the raw item for the library toggle / remove-progress writes. Refetched on bump.
  const [libById, setLibById] = useState<Map<string, LibraryItem>>(new Map());
  const [libVersion, setLibVersion] = useState(0);
  const resolveAbort = useRef<AbortController | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // The tile currently holding focus (null when focus is on a chip / rail / avatar)
  // — `longSelect` (hold OK) opens its action sheet. `focused` state stays sticky for
  // the hero; this ref is cleared on tile blur so a hold elsewhere doesn't fire it.
  const focusedTileRef = useRef<HomeItem | null>(null);
  // On Android TV, holding OK fires a `longSelect` TV event AND the focused view's
  // onPress on release. This flag (set by longSelect) makes the trailing onPress a
  // no-op so a hold doesn't ALSO open Detail. Safety-cleared after 1s.
  const longPressConsumedRef = useRef(false);
  const longPressClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // useTVEventHandler is global; gate it so a hold on Detail/Player (Home still
  // mounted underneath) doesn't fire Home's action sheet.
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;

  // Vertical pitch MUST equal the real rendered row height or scrollTo() mis-aligns
  // and the previous row peeks above. Row = header 40 + 18 + FlatList(padV 14 + tile
  // 243 + padV 14) + marginBottom 51 = 380.
  const ROW_STEP = m.s(380);
  const ROWS_TOP = m.s(600); // y where the rows band starts
  // Band frame sits 20px LEFT of the tiles (which align at 150 with the InfoPanel).
  const CONTENT_LEFT = m.s(130);

  // Continue Watching — the user's in-progress library (needs login). `cwReady`
  // gates the rows band: until the CW fetch resolves we don't know if CW is row 0,
  // so we hold off mounting/focusing the rows. Otherwise the catalog rows mount
  // first, focus + the backdrop land on a Popular Movies title, then CW resolves,
  // inserts at the top, steals focus and FLASHES the backdrop to the CW title.
  useEffect(() => {
    if (!token) { setCw([]); setCwReady(true); return; }
    let cancelled = false;
    fetchContinueWatching(token)
      .then((items) => { if (!cancelled) setCw(items.map(cwToHomeItem)); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCwReady(true); });
    return () => { cancelled = true; };
  }, [token]);
  // Fallback: never hold the rows hostage to a slow/hung library fetch.
  useEffect(() => {
    const t = setTimeout(() => setCwReady(true), 2500);
    return () => clearTimeout(t);
  }, []);

  // Full library (membership for the action sheet + raw items for its writes).
  useEffect(() => {
    if (!token) { setLibById(new Map()); return; }
    let cancelled = false;
    fetchBlissfulLibrary<LibraryItem>(token)
      .then((items) => { if (!cancelled) setLibById(new Map(items.map((it) => [it._id, it]))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [token, libVersion]);

  // Popular catalogs.
  useEffect(() => {
    let cancelled = false;
    fetchCatalog({ type: 'movie', id: 'top' })
      .then((r) => !cancelled && setPopMovies(r.metas.slice(0, 24).map(metaToHomeItem)))
      .catch(() => {});
    fetchCatalog({ type: 'series', id: 'top' })
      .then((r) => !cancelled && setPopSeries(r.metas.slice(0, 24).map(metaToHomeItem)))
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const rows: RowDef[] = useMemo(() => [
    ...(cw.length ? [{ key: 'cw', title: 'Continue Watching', items: cw }] : []),
    { key: 'pm', title: 'Popular Movies', items: popMovies, seeAll: () => navigation.navigate('Discover', { type: 'movie' as MediaType }) },
    { key: 'ps', title: 'Popular Series', items: popSeries, seeAll: () => navigation.navigate('Discover', { type: 'series' as MediaType }) },
  ], [cw, popMovies, popSeries, navigation]);

  // Seed the featured item once the first row has data so the backdrop / InfoPanel
  // aren't blank before the user moves focus. Gated on cwReady so it seeds from the
  // FINAL row 0 (CW if present) — never from Popular Movies before CW resolves.
  useEffect(() => {
    if (cwReady && !focused && rows.length && rows[0].items.length) setFocused(rows[0].items[0]);
  }, [cwReady, rows, focused]);

  // Featured meta for the focused item. NEVER blank it on focus change (that made
  // the rating/genres/blurb section flash + collapse every time the title changed):
  // a cached title repaints instantly; an uncached one keeps the CURRENT meta on
  // screen until its own meta arrives (the in-flight fetch is aborted if focus moves
  // on, so a stale title's meta can't land). Debounced so a fast scrub doesn't spam.
  useEffect(() => {
    if (!focused) return;
    const { id, type } = focused;
    const key = `${type}:${id}`;
    const cached = metaCache.get(key);
    if (cached) { setFocusedMeta({ key, meta: cached }); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetchMeta({ type, id, signal: ctrl.signal })
        .then((r) => { metaCache.set(key, r.meta); setFocusedMeta({ key, meta: r.meta }); })
        .catch(() => {});
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [focused?.id, focused?.type]);

  const onFocusItem = useCallback((it: HomeItem, rowIndex: number) => {
    setFocused(it);
    focusedTileRef.current = it;
    // Bring the focused row to the top of the band (design BlissfulTVHome.jsx).
    scrollRef.current?.scrollTo({ y: rowIndex * ROW_STEP, animated: true });
  }, [ROW_STEP]);
  const onBlurItem = useCallback(() => { focusedTileRef.current = null; }, []);

  // OK on a tile → Detail (CW items go through the Resume modal first). A trailing
  // onPress after a hold (Android TV fires both) is swallowed by the consumed flag.
  const onPressItem = useCallback((it: HomeItem) => {
    if (longPressConsumedRef.current) {
      longPressConsumedRef.current = false;
      if (longPressClearTimer.current) clearTimeout(longPressClearTimer.current);
      return;
    }
    if (it.cw) { setResumeItem(it.cw); return; }
    navigation.navigate('Detail', { id: it.id, type: it.type, name: it.name, poster: it.poster ?? undefined });
  }, [navigation]);

  // Hold OK → quick-action sheet. On Android TV the reliable hold signal is the
  // `longSelect` TV event (Pressable.onLongPress doesn't fire for the OK button);
  // we open the sheet for the focused tile and arm the consumed flag so the trailing
  // onPress doesn't also navigate to Detail.
  useTVEventHandler((evt) => {
    if (evt?.eventType !== 'longSelect') return;
    if (!isFocusedRef.current) return; // Home not the active route
    const it = focusedTileRef.current;
    if (!it) return; // focus is on a chip / rail / avatar, not a tile
    longPressConsumedRef.current = true;
    if (longPressClearTimer.current) clearTimeout(longPressClearTimer.current);
    longPressClearTimer.current = setTimeout(() => { longPressConsumedRef.current = false; }, 1000);
    setActionItem(it);
  });
  const inLibrary = useCallback((id: string) => {
    const it = libById.get(id);
    return !!it && !it.removed;
  }, [libById]);
  const closeActions = useCallback(() => { setActionItem(null); setActionRect(null); }, []);

  // Add/Remove from library — flips removed/temp (mirrors the Detail page toggle).
  // Closes the on-tile action overlay after acting.
  const toggleLibrary = useCallback((it: HomeItem) => {
    closeActions();
    if (!token) return;
    const existing = libById.get(it.id);
    const next = !(existing && !existing.removed);
    const base: Record<string, unknown> = existing
      ? { ...(existing as object) }
      : { _id: it.id, type: it.type, name: it.name, poster: it.poster ?? null, posterShape: 'poster', state: {} };
    base._id = it.id;
    base.removed = !next; // temp keeps the row alive when removed from library
    base.temp = !next;
    void putBlissfulLibraryItem(token, it.id, base).then(() => setLibVersion((v) => v + 1)).catch(() => {});
  }, [token, libById, closeActions]);

  // Remove progress — zero the watch state so it drops out of Continue Watching but
  // stays in the library (canonical OpenCode useContinueWatchingActions semantics).
  const removeProgress = useCallback((it: HomeItem) => {
    closeActions();
    setCw((prev) => prev.filter((x) => x.id !== it.id)); // optimistic
    if (!token) return;
    const existing = libById.get(it.id);
    const base: Record<string, unknown> = existing
      ? { ...(existing as object) }
      : { _id: it.id, type: it.type, name: it.name, poster: it.poster ?? null, state: {} };
    base._id = it.id;
    base.state = { ...((existing?.state as object) ?? {}), timeOffset: 0, duration: 0, timeWatched: 0, lastWatched: '' };
    void putBlissfulLibraryItem(token, it.id, base).then(() => setLibVersion((v) => v + 1)).catch(() => {});
  }, [token, libById, closeActions]);

  // Back closes the on-tile action overlay (it's not a separate modal, so wire Back here).
  useEffect(() => {
    if (!actionItem) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { closeActions(); return true; });
    return () => sub.remove();
  }, [actionItem, closeActions]);

  // Resolve a REAL stream for a CW title, show the black+logo veil, then jump to
  // the player. `startSeconds` = resume pos (0 for Start-over). Ported 1:1 from the
  // previous HomeScreen (the seamless logo-merge resume).
  const playCw = useCallback(async (item: CwItem, startSeconds: number) => {
    setResumeItem(null);
    setResolving({ logo: cwLogoCache.get(item.id) ?? null });
    resolveAbort.current?.abort();
    const ctrl = new AbortController();
    resolveAbort.current = ctrl;
    const type = (item.type === 'series' ? 'series' : 'movie') as MediaType;
    const streamId = item.type === 'series' ? (item.videoId ?? item.id) : item.id;
    try {
      const metaP = fetchMeta({ type: item.type as MediaType, id: item.id, signal: ctrl.signal }).then((r) => r.meta).catch(() => null);
      const streamsP = item.streamUrl ? Promise.resolve([]) : loadStreams(token, type, streamId, { signal: ctrl.signal });
      void metaP.then((mta) => {
        if (ctrl.signal.aborted) return;
        const early = normalizeStremioImage(mta?.logo) ?? null;
        cwLogoCache.set(item.id, early);
        setResolving({ logo: early });
      });
      const [meta, streams] = await Promise.all([metaP, streamsP]);
      if (ctrl.signal.aborted) return;
      const logo = normalizeStremioImage(meta?.logo) ?? null;
      setResolving({ logo });
      const playable = item.streamUrl
        ? [{ url: item.streamUrl, title: item.streamTitle ?? item.name }]
        : streams.filter((s) => s.url).map((s) => ({ url: s.url as string, title: s.title }));
      if (playable.length === 0) {
        setResolving(null);
        navigation.navigate('Detail', { id: item.id, type: item.type as MediaType, name: item.name, poster: item.poster });
        return;
      }
      navigation.navigate('Player', {
        url: playable[0].url,
        title: item.name,
        playlist: playable,
        startIndex: 0,
        logo,
        background: normalizeStremioImage(meta?.background),
        poster: normalizeStremioImage(meta?.poster) ?? item.poster ?? null,
        startSeconds,
        description: meta?.description ?? null,
        releaseInfo: formatReleaseInfo(meta?.releaseInfo) || (meta?.year != null ? String(meta.year) : null),
        imdbId: meta?.imdb_id ?? null,
        rating: meta?.imdbRating != null ? String(meta.imdbRating) : null,
        streamTarget: { type, id: streamId, title: item.name },
        detailId: item.id,
      });
      setTimeout(() => setResolving(null), 600);
    } catch {
      setResolving(null);
    }
  }, [navigation, token]);

  return (
    <View style={styles.root}>
      <Backdrop item={focused} meta={focused && focusedMeta?.key === `${focused.type}:${focused.id}` ? focusedMeta.meta : null} />
      <InfoPanel item={focused} meta={focusedMeta?.meta ?? null} m={m} avatarUpTag={avatarTag ?? undefined} />

      {/* rows band — lower portion, vertical focus-scroll (touch disabled). */}
      <View style={{ position: 'absolute', left: CONTENT_LEFT, right: 0, top: ROWS_TOP, bottom: 0, overflow: 'hidden' }} pointerEvents="box-none">
        <ScrollView ref={scrollRef} scrollEnabled={false} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: m.height }}>
          {/* Hold the rows until the CW fetch resolves so the row order (and thus
              the autofocused row-0 + its backdrop) is final before anything mounts
              — prevents the Popular-Movies→CW backdrop flash. */}
          {cwReady ? rows.map((row, ri) => (
            <LandscapeRail
              key={row.key}
              title={row.title}
              items={row.items}
              rowIndex={ri}
              m={m}
              firstFocus={ri === 0}
              activeActionId={actionItem?.id}
              onFocusItem={onFocusItem}
              onBlurItem={onBlurItem}
              onPress={onPressItem}
              onActiveRect={setActionRect}
              onSeeAll={row.seeAll}
            />
          )) : null}
        </ScrollView>
      </View>

      {/* Bottom-peek fade — shadows the partially-visible next row into the background. */}
      <LinearGradient colors={['transparent', colors.bg]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: m.s(130) }} pointerEvents="none" />

      <NavRail active="Home" />
      <HomeTopRight m={m} onOpenProfile={() => setProfileOpen(true)} onAvatarTag={setAvatarTag} />

      <ResumeModal
        item={resumeItem}
        onResume={(i) => playCw(i, i.resumeSeconds)}
        onStartOver={(i) => playCw(i, 0)}
        onGoToDetail={(i) => navigation.navigate('Detail', { id: i.id, type: i.type as MediaType, name: i.name, poster: i.poster })}
        onClose={() => setResumeItem(null)}
      />
      {resolving ? <BufferingVeil visible black logo={resolving.logo} /> : null}
      <ProfileMenu visible={profileOpen} onClose={() => setProfileOpen(false)} />
      <HomeActionOverlay
        item={actionItem}
        rect={actionRect}
        inLibrary={actionItem ? inLibrary(actionItem.id) : false}
        m={m}
        onToggleLibrary={toggleLibrary}
        onRemoveProgress={removeProgress}
        onClose={closeActions}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
