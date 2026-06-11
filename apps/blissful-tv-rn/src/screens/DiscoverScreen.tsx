import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { PosterGridSkeleton } from '../components/Skeleton';
import { fetchCatalog, type MediaType, type StremioMetaPreview } from '@blissful/core';
import { colors, font } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useAuth } from '../context/AuthContext';
import { useContentInert } from '../lib/contentFocus';
import { loadAllAddonCatalogs, type AddonCatalogEntry } from '../lib/addons';
import { NavRail } from '../components/NavRail';
import { Backdrop } from '../components/home/HomeHero';
import { metaToHomeItem, type HomeItem } from '../components/home/homeData';
import { useFocusedMeta } from '../components/home/useFocusedMeta';
import { PosterCard, type CardItem } from '../components/PosterCard';
import { TvSelect, TvSelectOverlay, type DropdownAnchor, type SelectOption } from '../components/TvSelect';
import type { RootStackParamList } from '../navigation/types';

type DiscoverRoute = RouteProp<RootStackParamList, 'Discover'>;

// Preferred order for the Type selector (extra types fall to the end), matching
// the Windows Discover (Movie / Series / Channel / Anime / …).
const TYPE_ORDER = ['movie', 'series', 'channel', 'anime', 'tv', 'other'];
function typeLabel(t: string): string {
  if (t === 'tv') return 'TV';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function baseFromTransport(t?: string): string | undefined {
  if (!t) return undefined;
  return t.replace(/\/manifest\.json$/i, '').replace(/\/$/, '');
}
const keyOf = (c: { transportUrl: string; id: string }) => `${c.transportUrl}::${c.id}`;

// The Windows app's unified Discover (every addon's catalogs aggregated behind
// Type / Catalog / Genre selectors + a dense, paginated poster grid), restyled
// with the immersive Home's visual language: an ambient full-bleed backdrop of
// the FOCUSED card behind a heavy dim (the grid stays the star), the Spectral
// display serif for the heading, and no topbar (Search lives in the NavRail).
export function DiscoverScreen() {
  const { params } = useRoute<DiscoverRoute>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const navigation = useNavigation<any>();
  const m = useMetrics();
  const { token } = useAuth();

  // Every installed addon's catalogs feed the Type + Catalog selectors. A "See All"
  // pre-selects a specific catalog via params; the bare NavRail entry defaults to
  // the first catalog of the default type.
  const [allCats, setAllCats] = useState<AddonCatalogEntry[]>([]);
  const [type, setType] = useState<MediaType>(params?.type ?? 'movie');
  const [catKey, setCatKey] = useState<string>(params?.transportUrl && params?.catalogId ? `${params.transportUrl}::${params.catalogId}` : '');
  const [genre, setGenre] = useState<string | null>(params?.genre ?? null);
  const [items, setItems] = useState<StremioMetaPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [dropdown, setDropdown] = useState<DropdownAnchor | null>(null);
  // The focused card drives the ambient backdrop (the immersive Home model, dimmed
  // way down here). Seeded from item 0 of every page-0 load so it follows a filter
  // change while D-pad focus sits on the pills; never null-cleared (nulling = flash).
  const [focused, setFocused] = useState<HomeItem | null>(null);
  const focusedMeta = useFocusedMeta(focused, token);
  const railOpen = useContentInert();
  const reqRef = useRef(0);
  const typeRef = useRef(type);
  typeRef.current = type;

  // Aggregate all addons' catalogs (Cinemeta movie/series, Anime Kitsu's anime
  // catalogs, channels, …) so the selectors browse them all, like Windows.
  useEffect(() => {
    let cancelled = false;
    loadAllAddonCatalogs(token).then((cats) => {
      if (cancelled) return;
      setAllCats(cats);
      setCatKey((prev) => {
        if (prev && cats.some((c) => keyOf(c) === prev)) return prev; // keep See All / current
        const first = cats.find((c) => c.type === typeRef.current) ?? cats[0];
        return first ? keyOf(first) : prev;
      });
    });
    return () => { cancelled = true; };
  }, [token]);

  // NOTE: params are consumed by the useState initializers only. That is enough:
  // react-navigation 7's navigate() PUSHES a fresh Discover instance even when one
  // is already in the stack (verified on-device — a Detail genre chip stacks a new
  // Discover on top), so a mounted instance never receives new params.
  const selectedCat = allCats.find((c) => keyOf(c) === catKey);
  const baseUrl = selectedCat ? baseFromTransport(selectedCat.transportUrl) : baseFromTransport(params?.transportUrl);
  const catalogId = selectedCat?.id ?? params?.catalogId ?? 'top';
  const fetchType = selectedCat?.type ?? params?.type ?? type;

  // (Re)load page 0 on catalog/genre change. Genre is a real Stremio filter
  // (`/catalog/{type}/{id}/genre=X.json`), so it re-fetches.
  useEffect(() => {
    // Fetch only once the catalog selection is RESOLVED: a bare nav entry waits for
    // the addon catalog list to load (which sets `catKey`), a See-All carries params.
    // Without this we'd fetch Cinemeta-top immediately and then re-fetch when catKey
    // resolves — the load → flash → reload the grid showed.
    if (!allCats.length && !params?.transportUrl) return;
    const req = ++reqRef.current;
    setLoading(true);
    setItems([]);
    setHasMore(false);
    fetchCatalog({ type: fetchType, id: catalogId, baseUrl, extra: genre ? { genre } : {} })
      .then((r) => {
        if (reqRef.current !== req) return;
        setItems(r.metas);
        setHasMore(Boolean(r.hasMore));
        if (r.metas.length) setFocused(metaToHomeItem(r.metas[0])); // ambient backdrop follows the new catalog
      })
      .catch(() => { if (reqRef.current === req) setItems([]); })
      .finally(() => { if (reqRef.current === req) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchType, catalogId, baseUrl, genre]);

  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    const req = reqRef.current;
    setLoadingMore(true);
    fetchCatalog({ type: fetchType, id: catalogId, baseUrl, extra: { ...(genre ? { genre } : null), skip: String(items.length) } })
      .then((r) => {
        if (reqRef.current !== req) return;
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id));
          return [...prev, ...r.metas.filter((mt) => !seen.has(mt.id))];
        });
        setHasMore(Boolean(r.hasMore) && r.metas.length > 0);
      })
      .catch(() => {})
      .finally(() => { if (reqRef.current === req) setLoadingMore(false); });
  }, [loadingMore, loading, hasMore, fetchType, catalogId, baseUrl, genre, items.length]);

  const typeOptions = useMemo<SelectOption[]>(() => {
    const present = Array.from(new Set(allCats.map((c) => c.type)));
    present.sort((a, b) => {
      const ia = TYPE_ORDER.indexOf(a); const ib = TYPE_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return present.length ? present.map((t) => ({ key: t, label: typeLabel(t) })) : [{ key: 'movie', label: 'Movie' }, { key: 'series', label: 'Series' }];
  }, [allCats]);

  const catalogOptions = useMemo<SelectOption[]>(() => allCats.filter((c) => c.type === type).map((c) => ({ key: keyOf(c), label: c.name })), [allCats, type]);
  const genreSource = selectedCat?.genres ?? [];
  const genreOptions = useMemo<SelectOption[]>(() => [{ key: 'all', label: 'All Genres' }, ...genreSource.map((g) => ({ key: g, label: g }))], [genreSource]);

  const onSelect = useCallback((item: CardItem) => {
    navigation.navigate('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster ?? undefined });
  }, [navigation]);
  const onFocusCard = useCallback((it: CardItem) => {
    setFocused({ id: it.id, type: it.type as MediaType, name: it.name, poster: it.poster, imdbRating: it.imdbRating });
  }, []);

  const padL = m.s(20);
  const gap = m.s(24);
  const cols = 4; // landscape cards, 4 per row
  // Width that fits `cols` landscape cards + (cols-1) gaps across the content area.
  const posterW = Math.floor((m.width - m.contentLeft - m.safeX - padL - gap * (cols - 1)) / cols);

  // Stable renderItem so the per-focus screen re-render (the ambient backdrop
  // following the focused card) doesn't re-render every visible cell — the heavy
  // poster visuals are memo'd inside PosterCard, the shells are cheap.
  const renderItem = useCallback(
    ({ item, index }: { item: StremioMetaPreview; index: number }) => (
      <PosterCard item={item} variant="landscape" width={posterW} atRowStart={index % cols === 0} onSelect={onSelect} onFocus={onFocusCard} />
    ),
    [posterW, cols, onSelect, onFocusCard],
  );

  const heroMeta = focused && focusedMeta?.key === `${focused.type}:${focused.id}` ? focusedMeta.meta : null;

  return (
    <View style={styles.root}>
      {/* Ambient art of the focused card behind a heavy dim — the immersive Home's
          backdrop as mood lighting, not a hero. The grid stays fully legible. */}
      <Backdrop item={focused} meta={heroMeta} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(7,9,13,0.60)' }]} pointerEvents="none" />

      <NavRail active="Discover" />
      <View isTVSelectable={!railOpen} style={{ position: 'absolute', left: m.contentLeft, top: m.safeY + m.s(14), right: m.safeX, bottom: 0 }}>
        {/* Filter pills row — the screen heading was removed (the NavRail marks the
            active page); the grid gets the full height. */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: m.s(12), marginLeft: padL, marginBottom: m.s(20) }}>
          <TvSelect
            iconName="film-outline"
            options={typeOptions}
            value={type}
            onChange={(k) => {
              const t = String(k);
              setType(t);
              const first = allCats.find((c) => c.type === t);
              setCatKey(first ? keyOf(first) : '');
              setGenre(null);
            }}
            m={m}
            minWidth={m.s(184)}
            atRowStart
            onOpen={setDropdown}
          />
          <TvSelect
            iconName="albums-outline"
            options={catalogOptions.length ? catalogOptions : [{ key: catKey || 'top', label: selectedCat?.name ?? 'Popular' }]}
            value={catKey}
            onChange={(k) => { setCatKey(String(k)); setGenre(null); }}
            m={m}
            minWidth={m.s(220)}
            onOpen={setDropdown}
          />
          {genreSource.length ? (
            <TvSelect iconName="pricetags-outline" options={genreOptions} value={genre ?? 'all'} onChange={(k) => setGenre(k === 'all' ? null : String(k))} m={m} minWidth={m.s(200)} onOpen={setDropdown} />
          ) : null}
        </View>

        {loading ? (
          <View style={{ paddingLeft: padL }}>
            <PosterGridSkeleton width={posterW} cols={cols} gap={gap} rows={3} m={m} variant="landscape" />
          </View>
        ) : items.length ? (
          <FlatList
            data={items}
            key={cols}
            numColumns={cols}
            // Explicit height, NOT flex:1 — a flex-sized VirtualizedList inside this
            // absolutely-positioned parent lays out at zero height (the pre-redesign
            // screen hit the same thing; the shipped fix is the same explicit height).
            style={{ height: m.height - m.safeY - m.s(120) }}
            removeClippedSubviews={false}
            initialNumToRender={cols * 3}
            maxToRenderPerBatch={cols * 2}
            windowSize={5}
            keyExtractor={(it) => it.id}
            contentContainerStyle={{ gap: m.s(20), paddingTop: m.s(8), paddingBottom: m.s(40), paddingLeft: padL }}
            columnWrapperStyle={{ gap: m.s(24) }}
            showsVerticalScrollIndicator={false}
            onEndReached={loadMore}
            onEndReachedThreshold={0.6}
            renderItem={renderItem}
          />
        ) : (
          <Text style={{ fontFamily: font.body, fontSize: m.s(24), color: colors.textFaint, marginLeft: padL, marginTop: m.s(40) }}>Nothing here.</Text>
        )}
      </View>

      {dropdown ? <TvSelectOverlay anchor={dropdown} onClose={() => { const r = dropdown.requestFocus; setDropdown(null); setTimeout(() => r(), 50); }} m={m} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
