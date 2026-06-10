// In-player Episodes drawer — the TV port of the desktop/web NativeMpvPlayer/
// EpisodesDrawer "coverflow": a right-anchored stack of 16:9 episode cards where
// the focused card is full size (white ring, description, play chip, WATCHING
// badge) and the neighbours scale down + darken with distance, overlapping like
// the web's -space-y-16 stack. The panel is VERTICALLY CENTERED with a capped
// height (the web's `top-1/2 max-h-[800px]`), so the header pill cluster —
// Search field, season pill (S4 ▾, OK opens a dropdown), Auto play switch, X —
// sits at the centered panel's top, not the screen's. A "Season N" title +
// season overview block scrolls with the stack above the first card, and each
// card shows the episode runtime ("54m") — both from the backend's server-keyed
// /tmdb-find + /tmdb-season-info (the same per-season fetch the web player does).
//
// FOCUS MODEL — VIRTUAL, like the web (BlissfulPlayer owns focusIndex there; the
// drawer owns it here). The coverflow's scale/translate choreography fights the
// native focus engine, so the drawer handles the D-pad itself: Up/Down step the
// focused card (one Animated.Value drives the whole stack), Up past the first
// card enters the header (Left/Right walk its items), OK acts on the focused
// thing, and the season dropdown is its own zone while open. Left in the list
// closes (the SettingsDrawer dismiss gesture); Back closes via the PlayerScreen
// BackHandler.
//
// Selection is delegated: OK on a card calls onSelectEpisode(video) and the
// PlayerScreen decides (current → close, unaired → air-date toast, else resolve
// streams + replace the player) — mirrors the desktop where the drawer is a dumb
// view and BlissfulPlayer owns onSelectEpisode.

import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Keyboard,
  StyleSheet,
  Text,
  TextInput,
  useTVEventHandler,
  View,
} from 'react-native';
import { getStorageBaseUrl } from '@blissful/core';
import { font } from '../../theme/colors';
import { useMetrics } from '../../theme/metrics';
import { Img } from '../Img';

const ACCENT = '#95a2ff';
type M = ReturnType<typeof useMetrics>;

/** One episode — mapped from the show meta's videos by the PlayerScreen. */
export type DrawerEpisode = {
  id: string;
  title: string | null;
  season: number | null;
  episode: number | null;
  thumbnail: string | null;
  released: string | null;
  description: string | null;
};

export type EpisodesDrawerProps = {
  episodes: DrawerEpisode[];
  /** The currently-playing episode id (WATCHING badge + initial focus). */
  currentId: string | null;
  /** The show's imdb id — drives the TMDB season info (overview + runtimes). */
  imdbId?: string | null;
  /** Show backdrop/poster fallback when an episode has no thumbnail. */
  fallbackArt?: string | null;
  /** Watch progress (0..100) of the CURRENT episode — its card's bottom bar. */
  currentProgressPct: number;
  /** The web's Auto play switch (binge-watching auto-advance). */
  autoPlay: boolean;
  onToggleAutoPlay: () => void;
  onSelectEpisode: (video: DrawerEpisode) => void;
  onClose: () => void;
};

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
export function isUnaired(v: { released: string | null }): boolean {
  if (!v.released) return false;
  const t = Date.parse(v.released);
  return Number.isFinite(t) && t > Date.now();
}

// Web bucketed coverflow values (Videasy parity): scale + darken by distance.
const SCALES = [1.15, 1.0, 0.9, 0.8, 0.7];
const DARKEN = [0, 0.5, 0.75, 0.9, 1];
// Card opacity by distance — the RN stand-in for the web's maskImage edge fade:
// distant cards dissolve into the backdrop instead of stacking as visible slabs.
const FADE = [1, 1, 1, 0.45, 0];
const WINDOW = 5; // cards rendered each side of the focus

// Episode art with the Detail-page fallback chain: unaired episodes skip their
// (404-bound) Cinemeta thumbnail and use the show backdrop directly; aired ones
// try the thumbnail and fall back on load error.
function CardArt({ uri, fallback }: { uri: string | null; fallback: string | null }) {
  const [err, setErr] = useState(false);
  const src = !err && uri ? uri : fallback;
  if (!src) return null;
  return <Img uri={src} style={StyleSheet.absoluteFill} contentFit="cover" onError={() => setErr(true)} />;
}

type HeaderItem = 'search' | 'season' | 'autoplay' | 'close';
type Zone = 'header' | 'list' | 'seasonMenu';

// TMDB season info (overview + per-episode runtime/overview) via the backend's
// server-keyed proxy — the same `/tmdb-season-info?tmdbId&season` fetch the web
// player drawer does (direct per-season, no absolute mapping). Module caches so
// reopening the drawer is instant.
type SeasonInfo = { overview: string | null; eps: Record<number, { runtime: number | null; overview: string | null }> };
const tmdbIdCache = new Map<string, number | null>();
const seasonInfoCache = new Map<string, SeasonInfo>();
function backendBase(): string {
  return getStorageBaseUrl().replace(/\/storage\/?$/, '');
}

export function EpisodesDrawer({
  episodes,
  currentId,
  imdbId,
  fallbackArt,
  currentProgressPct,
  autoPlay,
  onToggleAutoPlay,
  onSelectEpisode,
  onClose,
}: EpisodesDrawerProps) {
  const m = useMetrics();
  const W = m.s(520);
  const offX = W + m.s(40);
  const tx = useRef(new Animated.Value(offX)).current;
  const dim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(tx, { toValue: 0, stiffness: 280, damping: 32, mass: 0.85, useNativeDriver: true }).start();
    Animated.timing(dim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [tx, dim]);

  // ── Season + search filtering (the web's inSeason + filtered) ──────────────
  const seasons = useMemo(() => {
    const set = new Set<number>();
    for (const v of episodes) if (typeof v.season === 'number' && v.season > 0) set.add(v.season);
    return [...set].sort((a, b) => a - b);
  }, [episodes]);
  const currentSeason = useMemo(() => {
    const cur = currentId ? episodes.find((v) => v.id === currentId) : null;
    return cur?.season && cur.season > 0 ? cur.season : seasons[0] ?? null;
  }, [episodes, currentId, seasons]);
  const [season, setSeason] = useState<number | null>(currentSeason);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const inSeason = episodes
      .filter((v) => v.season === season)
      .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
    const needle = query.trim().toLowerCase();
    if (!needle) return inSeason;
    // Numeric query matches the episode number exactly ("3" or "3." — mirrors
    // the web's useEpisodeSelection matching).
    const numeric = needle.replace(/\.$/, '');
    if (/^\d+$/.test(numeric)) {
      const n = Number.parseInt(numeric, 10);
      return inSeason.filter((v) => v.episode === n);
    }
    return inSeason.filter(
      (v) => (v.title?.toLowerCase().includes(needle) ?? false) || (v.description?.toLowerCase().includes(needle) ?? false),
    );
  }, [episodes, season, query]);

  // ── TMDB season info: overview for the title block + runtimes for the cards ─
  const [seasonInfo, setSeasonInfo] = useState<SeasonInfo | null>(null);
  useEffect(() => {
    if (!imdbId || season == null) { setSeasonInfo(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        let tid = tmdbIdCache.get(imdbId);
        if (tid === undefined) {
          const f = await fetch(`${backendBase()}/tmdb-find?imdbId=${encodeURIComponent(imdbId)}`)
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          tid = f && typeof f.tmdbId === 'number' ? (f.tmdbId as number) : null;
          tmdbIdCache.set(imdbId, tid);
        }
        if (!tid || cancelled) { if (!cancelled) setSeasonInfo(null); return; }
        const key = `${tid}:${season}`;
        const cached = seasonInfoCache.get(key);
        if (cached) { setSeasonInfo(cached); return; }
        const d = await fetch(`${backendBase()}/tmdb-season-info?tmdbId=${tid}&season=${season}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (cancelled) return;
        const eps: SeasonInfo['eps'] = {};
        for (const e of ((d?.episodes ?? []) as { episode_number?: number | null; runtime?: number | null; overview?: string | null }[])) {
          if (typeof e.episode_number !== 'number') continue;
          eps[e.episode_number] = { runtime: e.runtime ?? null, overview: e.overview ?? null };
        }
        const info: SeasonInfo = { overview: typeof d?.overview === 'string' && d.overview ? d.overview : null, eps };
        seasonInfoCache.set(key, info);
        setSeasonInfo(info);
      } catch {
        if (!cancelled) setSeasonInfo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [imdbId, season]);

  // ── Virtual focus: header / coverflow / season dropdown ─────────────────────
  const [zone, setZone] = useState<Zone>('list');
  const [hIdx, setHIdx] = useState(0);
  const [focusIdx, setFocusIdx] = useState(0);
  const [menuIdx, setMenuIdx] = useState(0);
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  const hIdxRef = useRef(hIdx);
  hIdxRef.current = hIdx;
  const focusRef = useRef(focusIdx);
  focusRef.current = focusIdx;
  const menuIdxRef = useRef(menuIdx);
  menuIdxRef.current = menuIdx;
  const seasonsRef = useRef(seasons);
  seasonsRef.current = seasons;
  const seasonRef = useRef(season);
  seasonRef.current = season;
  const focusAnim = useRef(new Animated.Value(0)).current;
  const listRef = useRef<DrawerEpisode[]>(filtered);
  listRef.current = filtered;

  const headerItems: HeaderItem[] = useMemo(() => {
    const items: HeaderItem[] = ['search'];
    if (seasons.length > 1) items.push('season');
    items.push('autoplay', 'close');
    return items;
  }, [seasons.length]);
  const headerItemsRef = useRef(headerItems);
  headerItemsRef.current = headerItems;

  // Land on the playing episode when the drawer opens / season or query change.
  useEffect(() => {
    const i = currentId ? filtered.findIndex((v) => v.id === currentId) : -1;
    const target = i >= 0 ? i : 0;
    setFocusIdx(target);
    focusRef.current = target;
    focusAnim.setValue(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, query, filtered.length, currentId]);

  const stepFocus = (next: number) => {
    const clamped = Math.max(0, Math.min(listRef.current.length - 1, next));
    if (clamped === focusRef.current) return;
    focusRef.current = clamped;
    setFocusIdx(clamped);
    Animated.timing(focusAnim, { toValue: clamped, duration: 250, useNativeDriver: true }).start();
  };

  // While the search keyboard is up, the IME owns the D-pad — stand down.
  const imeRef = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const lastOk = useRef(0);

  useTVEventHandler((evt) => {
    const t = evt?.eventType;
    if (!t || imeRef.current) return;
    const z = zoneRef.current;
    switch (t) {
      case 'select': {
        const now = Date.now();
        if (now - lastOk.current < 300) break;
        lastOk.current = now;
        if (z === 'seasonMenu') {
          const s = seasonsRef.current[menuIdxRef.current];
          if (s != null) setSeason(s);
          setZone('header');
        } else if (z === 'header') {
          const item = headerItemsRef.current[hIdxRef.current];
          if (item === 'search') inputRef.current?.focus();
          else if (item === 'season') {
            // Open the season dropdown (the web's Select popover).
            const i = Math.max(0, seasonsRef.current.indexOf(seasonRef.current ?? seasonsRef.current[0]));
            setMenuIdx(i);
            setZone('seasonMenu');
          } else if (item === 'autoplay') onToggleAutoPlay();
          else onClose();
        } else {
          const v = listRef.current[focusRef.current];
          if (v) onSelectEpisode(v);
        }
        break;
      }
      case 'up':
        if (z === 'seasonMenu') setMenuIdx(Math.max(0, menuIdxRef.current - 1));
        else if (z === 'list') {
          if (focusRef.current <= 0) { setZone('header'); setHIdx(0); }
          else stepFocus(focusRef.current - 1);
        }
        break;
      case 'down':
        if (z === 'seasonMenu') setMenuIdx(Math.min(seasonsRef.current.length - 1, menuIdxRef.current + 1));
        else if (z === 'header') setZone('list');
        else stepFocus(focusRef.current + 1);
        break;
      case 'left':
      case 'rewind':
        if (z === 'seasonMenu') setZone('header'); // dismiss the dropdown
        else if (z === 'header') setHIdx(Math.max(0, hIdxRef.current - 1));
        else onClose(); // the right-anchored drawer's dismiss gesture
        break;
      case 'right':
      case 'fastForward':
        if (z === 'header') setHIdx(Math.min(headerItemsRef.current.length - 1, hIdxRef.current + 1));
        break;
      default:
        break;
    }
  });

  // ── Coverflow geometry (the web's transform stack) ──────────────────────────
  const cardW = m.s(340);
  const cardH = (cardW * 9) / 16;
  const OVERLAP = m.s(64);
  const spacing = cardH - OVERLAP;
  // "Season N" + overview block above the first card (scrolls with the stack).
  const TITLE_H = m.s(170);
  const [containerH, setContainerH] = useState(0);
  // Stack translateY: the focused card's centre lands at the container centre.
  // Linear in focusAnim — inputRange [0,1] + extend extrapolation = c - f*spacing.
  const centerOffset = containerH / 2 - cardH / 2;
  const stackTY = focusAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [centerOffset, centerOffset - spacing],
  });

  const hFocused = (item: HeaderItem) => zone === 'header' && headerItems[hIdx] === item;
  const lo = Math.max(0, focusIdx - WINDOW);
  const hi = Math.min(filtered.length - 1, focusIdx + WINDOW);
  const slice = filtered.slice(lo, hi + 1);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        // justifyContent center + capped panel height = the web's vertically-
        // centered `max-h-[800px]` panel (header sits at the PANEL's top).
        { opacity: dim, zIndex: 200, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: m.s(32) },
      ]}
    >
      <Animated.View style={{ transform: [{ translateX: tx }], width: W, height: '100%', maxHeight: m.s(800) }}>
        {/* Header — the web pill cluster: [ search | S4 ▾ | Auto play ]  [ X ] */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: m.s(8), paddingVertical: m.s(8), zIndex: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8), borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(0,0,0,0.45)', padding: m.s(4) }}>
            {/* Search */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                height: m.s(32),
                borderRadius: 999,
                borderWidth: m.s(1.5),
                borderColor: hFocused('search') ? ACCENT : 'rgba(255,255,255,0.1)',
                paddingHorizontal: m.s(10),
                gap: m.s(6),
              }}
            >
              <Ionicons name="search" size={m.s(13)} color="#fff" />
              <TextInput
                ref={inputRef}
                // Out of the NATIVE focus walk — the drawer's virtual D-pad owns
                // navigation; OK on the (virtually focused) search calls .focus()
                // imperatively, which opens the IME.
                isTVSelectable={false}
                value={query}
                onChangeText={setQuery}
                onFocus={() => { imeRef.current = true; }}
                onBlur={() => { imeRef.current = false; }}
                onSubmitEditing={() => Keyboard.dismiss()}
                placeholder="Search"
                placeholderTextColor="rgba(255,255,255,0.8)"
                style={{ width: m.s(86), padding: 0, fontFamily: font.body, fontSize: m.s(13), color: '#fff' }}
              />
            </View>
            {/* Season pill — OK opens the dropdown (web Select popover) */}
            {seasons.length > 1 ? (
              <View style={{ zIndex: 20 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: m.s(4),
                    height: m.s(32),
                    borderRadius: 999,
                    borderWidth: m.s(1.5),
                    borderColor: hFocused('season') || zone === 'seasonMenu' ? ACCENT : 'rgba(255,255,255,0.1)',
                    backgroundColor: hFocused('season') ? 'rgba(255,255,255,0.1)' : 'transparent',
                    paddingHorizontal: m.s(10),
                  }}
                >
                  <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(13), color: '#fff' }}>{`S${season ?? '—'}`}</Text>
                  <Ionicons name="chevron-down" size={m.s(12)} color="rgba(255,255,255,0.6)" />
                </View>
                {/* Dropdown — dark menu under the pill, one row per season. */}
                {zone === 'seasonMenu' ? (
                  <View style={{ position: 'absolute', top: m.s(38), left: -m.s(8), minWidth: m.s(118), borderRadius: m.s(12), paddingVertical: m.s(6), backgroundColor: 'rgba(10,11,15,0.97)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                    {seasons.map((s, i) => (
                      <View key={s} style={{ paddingHorizontal: m.s(14), paddingVertical: m.s(8), backgroundColor: i === menuIdx ? 'rgba(149,162,255,0.22)' : 'transparent' }}>
                        <Text style={{ fontFamily: i === menuIdx ? font.bodySemi : font.bodyMed, fontSize: m.s(13), color: i === menuIdx ? ACCENT : '#fff' }}>{`Season ${s}`}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}
            {/* Auto play switch */}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: m.s(8),
                height: m.s(32),
                borderRadius: 999,
                borderWidth: m.s(1.5),
                borderColor: hFocused('autoplay') ? ACCENT : 'transparent',
                paddingHorizontal: m.s(8),
              }}
            >
              <Text style={{ fontFamily: font.bodyMed, fontSize: m.s(13), color: '#fff' }}>Auto play</Text>
              <View style={{ width: m.s(44), height: m.s(26), borderRadius: 999, backgroundColor: autoPlay ? ACCENT : 'rgba(255,255,255,0.2)', justifyContent: 'center', paddingHorizontal: m.s(3) }}>
                <View style={{ width: m.s(20), height: m.s(20), borderRadius: 999, backgroundColor: autoPlay ? '#000' : '#fff', alignSelf: autoPlay ? 'flex-end' : 'flex-start' }} />
              </View>
            </View>
          </View>
          {/* Close */}
          <View
            style={{
              width: m.s(38),
              height: m.s(38),
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: m.s(1.5),
              borderColor: hFocused('close') ? ACCENT : 'rgba(255,255,255,0.1)',
              backgroundColor: hFocused('close') ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.45)',
            }}
          >
            <Ionicons name="close" size={m.s(16)} color="rgba(255,255,255,0.9)" />
          </View>
        </View>

        {/* Coverflow stack — translateY-driven, no native scroll. */}
        <View style={{ flex: 1, overflow: 'hidden' }} onLayout={(e) => setContainerH(e.nativeEvent.layout.height)}>
          {filtered.length === 0 ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: font.body, fontSize: m.s(16), color: 'rgba(255,255,255,0.5)' }}>No episodes found</Text>
            </View>
          ) : containerH > 0 ? (
            <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, transform: [{ translateY: stackTY }] }}>
              {/* Season title + overview — scrolls with the cards (web title block):
                  visible above episode 1, off-screen at later episodes. */}
              <View style={{ position: 'absolute', top: -TITLE_H, right: m.s(30), width: cardW, height: TITLE_H, justifyContent: 'flex-end', paddingBottom: m.s(24), alignItems: 'center' }}>
                <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(22), color: '#fff' }}>{`Season ${season ?? '—'}`}</Text>
                {seasonInfo?.overview ? (
                  <Text numberOfLines={4} style={{ marginTop: m.s(8), fontFamily: font.body, fontSize: m.s(12.5), lineHeight: m.s(18), color: 'rgba(255,255,255,0.7)', textAlign: 'center' }}>
                    {seasonInfo.overview}
                  </Text>
                ) : null}
              </View>
              {slice.map((v, k) => {
                const idx = lo + k;
                const isFocusedCard = idx === focusIdx;
                const isCurrent = v.id === currentId;
                const ep = v.episode ?? 0;
                const unaired = isUnaired(v);
                const date = shortDate(v.released);
                const tmdbEp = ep ? seasonInfo?.eps?.[ep] : undefined;
                const runtime = tmdbEp?.runtime != null ? `${tmdbEp.runtime}m` : null;
                const desc = tmdbEp?.overview ?? v.description ?? null;
                // Bucketed scale/darken/fade by distance from the (animated) focus.
                const inputRange = [idx - 4, idx - 3, idx - 2, idx - 1, idx, idx + 1, idx + 2, idx + 3, idx + 4];
                const scale = focusAnim.interpolate({ inputRange, outputRange: [...SCALES].reverse().concat(SCALES.slice(1)), extrapolate: 'clamp' });
                const darken = focusAnim.interpolate({ inputRange, outputRange: [...DARKEN].reverse().concat(DARKEN.slice(1)), extrapolate: 'clamp' });
                const fade = focusAnim.interpolate({ inputRange, outputRange: [...FADE].reverse().concat(FADE.slice(1)), extrapolate: 'clamp' });
                return (
                  <Animated.View
                    key={v.id}
                    style={{
                      position: 'absolute',
                      top: idx * spacing,
                      // Inset > the 1.15 focus-scale's half-growth (≈ s(26)) so the
                      // focused card's right edge never clips on the container.
                      right: m.s(30),
                      width: cardW,
                      height: cardH,
                      zIndex: 100 - Math.abs(idx - focusIdx),
                      opacity: fade,
                      transform: [{ scale }],
                    }}
                  >
                    <View style={{ flex: 1, borderRadius: m.s(16), overflow: 'hidden', backgroundColor: '#15171d' }}>
                      <CardArt uri={unaired ? null : v.thumbnail} fallback={fallbackArt ?? null} />
                      {/* bottom legibility gradient */}
                      <LinearGradient colors={['transparent', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.92)']} locations={[0.35, 0.55, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
                      {/* title + runtime + (focused) description */}
                      <View style={{ position: 'absolute', left: m.s(14), right: m.s(14), bottom: m.s(12) }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
                          {isCurrent ? (
                            <View style={{ borderRadius: m.s(5), backgroundColor: '#dc2626', paddingHorizontal: m.s(7), paddingVertical: m.s(2) }}>
                              <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(10), letterSpacing: m.s(1), color: '#fff' }}>WATCHING</Text>
                            </View>
                          ) : null}
                          <Text numberOfLines={1} style={{ flex: 1, fontFamily: font.bodySemi, fontSize: m.s(17), color: '#fff' }}>
                            {ep ? `${ep}. ` : ''}{v.title ?? `Episode ${ep || '?'}`}
                          </Text>
                        </View>
                        {runtime ? (
                          <Text style={{ marginTop: m.s(1), fontFamily: font.body, fontSize: m.s(11.5), color: 'rgba(255,255,255,0.8)' }}>{runtime}</Text>
                        ) : null}
                        {isFocusedCard ? (
                          <Text numberOfLines={2} style={{ marginTop: m.s(4), fontFamily: font.body, fontSize: m.s(12.5), lineHeight: m.s(17), color: 'rgba(255,255,255,0.78)' }}>
                            {unaired && date ? `Airs ${date}` : desc ?? date ?? ''}
                          </Text>
                        ) : null}
                      </View>
                      {/* play chip — focused card, top-right (web parity; OK plays) */}
                      {isFocusedCard ? (
                        <View style={{ position: 'absolute', right: m.s(12), top: m.s(12), width: m.s(38), height: m.s(38), borderRadius: 999, borderWidth: m.s(2), borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="play" size={m.s(15)} color="#fff" style={{ marginLeft: m.s(2) }} />
                        </View>
                      ) : null}
                      {/* current-episode progress bar */}
                      {isCurrent && currentProgressPct > 0 ? (
                        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: m.s(5), backgroundColor: 'rgba(255,255,255,0.15)' }}>
                          <View style={{ height: '100%', width: `${Math.min(100, currentProgressPct)}%`, backgroundColor: ACCENT }} />
                        </View>
                      ) : null}
                      {/* distance darken overlay */}
                      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: darken }]} />
                      {/* focused white ring (web's 2.5px white/90) */}
                      {isFocusedCard ? (
                        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: m.s(16), borderWidth: m.s(2.5), borderColor: 'rgba(255,255,255,0.9)' }]} />
                      ) : null}
                    </View>
                  </Animated.View>
                );
              })}
            </Animated.View>
          ) : null}
        </View>
      </Animated.View>
    </Animated.View>
  );
}
