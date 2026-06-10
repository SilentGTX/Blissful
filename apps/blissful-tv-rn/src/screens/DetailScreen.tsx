import { Ionicons } from '@expo/vector-icons';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { fetchBlissfulLibrary, fetchCatalog, getStorageBaseUrl, normalizeStremioImage, putBlissfulLibraryItem, type LibraryItem, type StremioMetaDetail, type StremioMetaPreview } from '@blissful/core';
import { colors, font, radius } from '../theme/colors';
import { useMetrics } from '../theme/metrics';
import { useAuth } from '../context/AuthContext';
import { Img } from '../components/Img';
import { PosterCard, type CardItem } from '../components/PosterCard';
import { Rating } from '../components/Rating';
import { ResumeModal } from '../components/ResumeModal';
import { StreamPicker, type StreamPickerTarget } from '../components/StreamPicker';
import { TvSelect, TvSelectOverlay, type DropdownAnchor, type SelectOption } from '../components/TvSelect';
import { metahubPosterToBackdrop } from '../lib/images';
import { resolveMeta } from '../lib/metaResolver';
import { formatReleaseInfo } from '../lib/releaseInfo';
import type { CwItem } from '../lib/continueWatching';
import type { RootStackParamList } from '../navigation/types';

const IMDB_RE = /^tt\d{5,}$/;

type DetailRoute = RouteProp<RootStackParamList, 'Detail'>;
type Nav = StackNavigationProp<RootStackParamList, 'Detail'>;
type Meta = StremioMetaDetail['meta'];
type Video = NonNullable<Meta['videos']>[number];
type M = ReturnType<typeof useMetrics>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fmtDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// .tv-detail-back — glass pill, top-left.
function BackPill({ m, onPress }: { m: M; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: m.s(8), height: m.s(42), paddingLeft: m.s(16), paddingRight: m.s(20), borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: f ? colors.accent : 'transparent' }}
    >
      <Ionicons name="chevron-back" size={m.s(22)} color="#fff" />
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(19), color: '#fff' }}>Back</Text>
    </Pressable>
  );
}

// .tv-detail-actions .action-button — height ~40, accent for Watch.
function ActionBtn({ label, icon, primary, autoFocus, m, onPress }: { label: string; icon: keyof typeof Ionicons.glyphMap; primary?: boolean; autoFocus?: boolean; m: M; onPress: () => void }) {
  const [f, setF] = useState(false);
  const fg = primary ? colors.accentInk : colors.text;
  return (
    <Pressable
      hasTVPreferredFocus={autoFocus}
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(10), height: m.s(40), paddingHorizontal: m.s(24), borderRadius: radius.pill, backgroundColor: primary ? colors.accent : colors.surface10, borderWidth: 1, borderColor: f ? (primary ? colors.text : colors.accent) : 'transparent' }}
    >
      <Ionicons name={icon} size={m.s(22)} color={fg} />
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: fg }}>{label}</Text>
    </Pressable>
  );
}

// .tv-detail-label — uppercase, 0.14em, 50% white.
function Label({ children, m }: { children: string; m: M }) {
  return <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(16), fontWeight: '700', letterSpacing: m.s(2), textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginBottom: m.s(10) }}>{children}</Text>;
}

function Chip({ label, m, onPress }: { label: string; m: M; onPress: () => void }) {
  const [f, setF] = useState(false);
  return (
    <Pressable
      onFocus={() => setF(true)}
      onBlur={() => setF(false)}
      onPress={onPress}
      style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.pill, paddingHorizontal: m.s(19), paddingVertical: m.s(10), borderWidth: 1, borderColor: f ? colors.accent : 'transparent' }}
    >
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(18), color: 'rgba(255,255,255,0.92)' }}>{label}</Text>
    </Pressable>
  );
}
function Chips({ items, m, onPress }: { items: string[]; m: M; onPress: (item: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(10) }}>
      {items.map((g) => (
        <Chip key={g} label={g} m={m} onPress={() => onPress(g)} />
      ))}
    </View>
  );
}

function EpisodeCard({ video, m, runtime, imgs, poster, watched, rating, progress, autoFocus, onPress }: { video: Video; m: M; runtime?: string | null; imgs?: (string | null | undefined)[]; poster?: string | null; watched?: boolean; rating?: string | number | null; progress?: number; autoFocus?: boolean; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  const w = m.s(260);
  // EXACT desktop EpisodeThumb logic: cycle the episode images (metahub still →
  // TMDB still) on load error; once exhausted, fall back to the show poster as a
  // SEPARATE element (it never errors out). Cinemeta hands broken metahub urls for
  // unreleased episodes → they 404 → we advance → the show poster shows.
  const imgList = (imgs ?? []).filter((u): u is string => !!u);
  const [imgIdx, setImgIdx] = useState(0);
  useEffect(() => { setImgIdx(0); }, [video.id]);
  const current = imgIdx < imgList.length ? imgList[imgIdx] : null;
  const exhausted = imgIdx >= imgList.length;
  const date = shortDate(video.released);
  const sub = [runtime, date].filter(Boolean).join('   ');
  return (
    <Pressable hasTVPreferredFocus={autoFocus} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={onPress} style={{ width: w }}>
      <View style={{ width: w, aspectRatio: 16 / 9, borderRadius: m.s(12), overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: focused ? colors.accent : 'transparent' }}>
        {current ? <Img key={current} uri={current} style={styles.fill} contentFit="cover" onError={() => setImgIdx((i) => i + 1)} /> : null}
        {exhausted && poster ? <Img uri={poster} style={styles.fill} contentFit="cover" /> : null}
        {/* IMDb rating badge, top-left (shared Rating component). */}
        <Rating size="sm" badge initialRating={rating} containerStyle={{ position: 'absolute', left: m.s(8), top: m.s(8) }} />
        {/* WATCHED pill (amber), top-right. */}
        {watched ? (
          <View style={{ position: 'absolute', right: m.s(8), top: m.s(8), borderRadius: m.s(6), backgroundColor: colors.imdbGold, paddingHorizontal: m.s(8), paddingVertical: m.s(2) }}>
            <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(12), letterSpacing: m.s(0.5), color: '#1a1205' }}>WATCHED</Text>
          </View>
        ) : null}
        {focused ? (
          <View style={{ position: 'absolute', left: m.s(10), bottom: m.s(10), width: m.s(42), height: m.s(42), borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="play" size={m.s(22)} color="#fff" style={{ marginLeft: m.s(3) }} />
          </View>
        ) : null}
        {/* Watch-progress bar along the bottom of the still. */}
        {progress != null && progress > 0 ? (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: m.s(5), backgroundColor: 'rgba(0,0,0,0.45)' }}>
            <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, progress)}%`, backgroundColor: colors.accent }} />
          </View>
        ) : null}
      </View>
      <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: focused ? colors.accent : colors.text, marginTop: m.s(8) }} numberOfLines={1}>
        {video.episode != null ? `${video.episode}. ` : ''}
        {video.title || video.name || `Episode ${video.episode ?? ''}`}
      </Text>
      {sub ? <Text style={{ fontFamily: font.body, fontSize: m.s(18), color: 'rgba(255,255,255,0.6)', marginTop: m.s(2) }}>{sub}</Text> : null}
    </Pressable>
  );
}

// ‹ / › season step buttons flanking the season Select.
function SeasonChevron({ icon, disabled, m, onPress }: { icon: keyof typeof Ionicons.glyphMap; disabled?: boolean; m: M; onPress: () => void }) {
  const [focused, setFocused] = useState(false);
  const sz = m.s(46);
  return (
    <Pressable
      focusable={!disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={() => { if (!disabled) onPress(); }}
      style={{ width: sz, height: sz, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: focused ? colors.accent : 'transparent', opacity: disabled ? 0.35 : 1 }}
    >
      <Ionicons name={icon} size={m.s(22)} color="#fff" />
    </Pressable>
  );
}

export function DetailScreen() {
  const { params } = useRoute<DetailRoute>();
  const navigation = useNavigation<Nav>();
  const m = useMetrics();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [season, setSeason] = useState<number | null>(params.season ?? null);
  const [similar, setSimilar] = useState<StremioMetaPreview[]>([]);
  const [picker, setPicker] = useState<StreamPickerTarget | null>(null);
  const [dropdown, setDropdown] = useState<DropdownAnchor | null>(null);
  const epListRef = useRef<FlatList<Video>>(null);
  const { token } = useAuth();

  // Library membership + per-episode watched/progress (ported from the web
  // useLibraryState hook). `state.watched` is a space/comma list of watched
  // video ids; `state.{video_id,timeOffset,duration}` carries the last position.
  const [libItem, setLibItem] = useState<LibraryItem | null>(null);
  const [libVersion, setLibVersion] = useState(0);
  const [resumeEp, setResumeEp] = useState<Video | null>(null);
  const startSecondsRef = useRef(0);
  useEffect(() => {
    if (!token) { setLibItem(null); return; }
    let cancelled = false;
    const load = () => fetchBlissfulLibrary<LibraryItem>(token)
      .then((all) => { if (!cancelled) setLibItem(all.find((it) => it._id === params.id) ?? null); })
      .catch(() => {});
    load();
    // The player writes progress async on exit, so the first fetch can race it —
    // refetch once shortly after so a just-watched episode shows up.
    const t = setTimeout(load, 1500);
    return () => { cancelled = true; clearTimeout(t); };
  }, [token, params.id, libVersion]);

  const inLibrary = Boolean(libItem && !(libItem as { removed?: boolean }).removed);
  // The library item's poster is exactly the one the Continue Watching modal
  // shows — use it as the most-reliable episode-card fallback.
  const libPoster = normalizeStremioImage((libItem as { poster?: string | null } | null)?.poster);
  const libState = (libItem as { state?: { video_id?: string; timeOffset?: number; duration?: number } } | null)?.state;
  // Watched = the episode has saved progress (the library tracks the current
  // episode's position). Same signal the progress bar / Continue Watching use.
  const episodeWatched = (video: Video): boolean => episodeResumeSeconds(video.id) > 0;
  const episodeResumeSeconds = (videoId: string): number => {
    if (libState?.video_id === videoId && libState.timeOffset) {
      let off = libState.timeOffset;
      if (off >= 10000) off /= 1000; // ms -> s
      return Math.max(0, off);
    }
    return 0;
  };
  const episodeProgressPct = (videoId: string): number => {
    if (libState?.video_id === videoId && libState.timeOffset && libState.duration) {
      return Math.min(100, Math.max(0, (libState.timeOffset / libState.duration) * 100));
    }
    return 0;
  };

  const handleToggleLibrary = useCallback(() => {
    if (!token) return;
    const next = !inLibrary;
    const poster = normalizeStremioImage(meta?.poster) ?? params.poster ?? null;
    const base: Record<string, unknown> = libItem
      ? { ...(libItem as object) }
      : { _id: params.id, type: params.type, name: meta?.name ?? params.name, poster, posterShape: 'poster', state: {} };
    base._id = params.id;
    base.removed = !next; // temp keeps the CW row alive when removed from library
    base.temp = !next;
    setLibItem((prev) => ({ ...(prev ?? { _id: params.id, state: {} }), removed: !next, temp: !next } as LibraryItem));
    void putBlissfulLibraryItem(token, params.id, base).then(() => setLibVersion((v) => v + 1)).catch(() => {});
  }, [token, inLibrary, libItem, meta?.poster, meta?.name, params.id, params.type, params.name, params.poster]);

  // Anime (Kitsu) is series-like: it has seasons/episodes, no standalone Watch button.
  const isSeries = params.type === 'series' || params.type === 'anime';

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setLoading(true);
    // Route through the owning addon (Cinemeta has no kitsu: ids) so the page
    // actually populates — title, background, genres, cast, episodes.
    resolveMeta(params.type, params.id, token, ctrl.signal)
      .then((r) => { if (!cancelled && r) setMeta(r.meta); })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [params.type, params.id, token]);

  const videos = meta?.videos ?? [];
  const seasons = useMemo(() => {
    const set = new Set<number>();
    videos.forEach((v) => typeof v.season === 'number' && v.season > 0 && set.add(v.season));
    return [...set].sort((a, b) => a - b);
  }, [videos]);
  useEffect(() => {
    if (seasons.length && season == null) setSeason(seasons[0]);
  }, [seasons, season]);
  const episodes = useMemo(() => videos.filter((v) => v.season === season).sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)), [videos, season]);

  // Huge single seasons (Kitsu lists e.g. One Piece's 1000+ episodes all as
  // "Season 1") are paginated into RANGES of 50 with their own Select + chevrons,
  // so you never scroll past hundreds of cards (ported from the Windows TvEpisodesRow).
  const EP_CHUNK = 50;
  const needsRanges = episodes.length > EP_CHUNK;
  const chunkCount = Math.max(1, Math.ceil(episodes.length / EP_CHUNK));
  // Index of the pre-selected (returning-from-player) episode in this season.
  const preEpIdx = useMemo(
    () => (params.episode != null && season === params.season ? episodes.findIndex((v) => v.episode === params.episode) : -1),
    [episodes, params.episode, params.season, season],
  );
  const [epChunk, setEpChunk] = useState(0);
  // Re-default the range to the chunk holding the pre-selected episode when the
  // season (or its episode set) changes.
  useEffect(() => {
    setEpChunk(preEpIdx >= 0 ? Math.floor(preEpIdx / EP_CHUNK) : 0);
  }, [season, episodes.length, preEpIdx]);
  const safeChunk = Math.min(epChunk, chunkCount - 1);
  const visibleEpisodes = needsRanges ? episodes.slice(safeChunk * EP_CHUNK, safeChunk * EP_CHUNK + EP_CHUNK) : episodes;
  const rangeOptions: SelectOption[] = useMemo(() => {
    if (!needsRanges) return [];
    const epNum = (v: Video | undefined, i: number) => (v && typeof v.episode === 'number' && v.episode > 0 ? v.episode : i + 1);
    return Array.from({ length: chunkCount }, (_, c) => {
      const start = c * EP_CHUNK;
      const end = Math.min(episodes.length, start + EP_CHUNK) - 1;
      return { key: String(c), label: `Ep ${epNum(episodes[start], start)}–${epNum(episodes[end], end)}` };
    });
  }, [needsRanges, chunkCount, episodes]);

  // Per-episode rating + still via the backend's SERVER-KEYED TMDB proxy
  // (/tmdb-find + /tmdb-season-info) — works for EVERY season with no account key
  // (Cinemeta only has stills for S1, so later seasons fell back to the show
  // poster). TMDB and Cinemeta disagree on how a show is split into seasons (esp.
  // anime — e.g. Re:Zero), so we map stills/ratings by ABSOLUTE episode POSITION
  // across concatenated TMDB seasons, cached per Cinemeta season.
  const [stillsBySeason, setStillsBySeason] = useState<Record<number, Record<number, string>>>({});
  const [ratingsBySeason, setRatingsBySeason] = useState<Record<number, Record<number, number>>>({});
  const tmdbIdRef = useRef<number | null | undefined>(undefined); // undefined = not looked up
  useEffect(() => {
    if (!isSeries || season == null) return;
    const s = season;
    if (stillsBySeason[s] != null) return; // already fetched this season
    const imdbId = meta?.imdb_id ?? (IMDB_RE.test(params.id) ? params.id : null);
    if (!imdbId) return;
    let cancelled = false;
    const base = getStorageBaseUrl().replace(/\/storage\/?$/, '');
    type TmdbEp = { episode_number?: number | null; vote_average?: number | null; still?: string | null };
    const fetchSeason = (tid: number, n: number): Promise<TmdbEp[]> =>
      fetch(`${base}/tmdb-season-info?tmdbId=${tid}&season=${n}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { episodes?: TmdbEp[] } | null) => d?.episodes ?? [])
        .catch(() => []);
    void (async () => {
      let tid = tmdbIdRef.current;
      if (tid === undefined) {
        const f = await fetch(`${base}/tmdb-find?imdbId=${encodeURIComponent(imdbId)}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        tid = f && typeof f.tmdbId === 'number' ? (f.tmdbId as number) : null;
        tmdbIdRef.current = tid;
      }
      if (!tid || cancelled) return;
      // Absolute-position mapping: count this show's episodes per Cinemeta season,
      // then walk concatenated TMDB seasons assigning a running absolute index.
      const counts: Record<number, number> = {};
      for (const v of videos) if (typeof v.season === 'number' && v.season > 0) counts[v.season] = (counts[v.season] ?? 0) + 1;
      const seasonCount = counts[s] ?? 0;
      let offset = 0;
      for (const k of Object.keys(counts)) { const n = Number(k); if (n > 0 && n < s) offset += counts[n]; }
      const maxAbs = offset + (seasonCount || 60);
      const absStill: Record<number, string> = {};
      const absRating: Record<number, number> = {};
      let running = 0;
      for (let ts = 1; ts <= 60 && running < maxAbs; ts++) {
        const eps = await fetchSeason(tid, ts);
        if (cancelled) return;
        if (eps.length === 0) break;
        for (const e of eps) {
          running += 1;
          if (e.still) absStill[running] = e.still;
          if (typeof e.vote_average === 'number' && e.vote_average > 0) absRating[running] = e.vote_average;
        }
      }
      if (cancelled) return;
      const stills: Record<number, string> = {};
      const ratings: Record<number, number> = {};
      for (let ep = 1; ep <= seasonCount; ep++) {
        const abs = offset + ep;
        if (absStill[abs]) stills[ep] = absStill[abs];
        if (absRating[abs] != null) ratings[ep] = absRating[abs];
      }
      setStillsBySeason((prev) => ({ ...prev, [s]: stills }));
      setRatingsBySeason((prev) => ({ ...prev, [s]: ratings }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSeries, season, meta?.imdb_id, params.id, videos]);
  // Current season's maps (keyed by per-season episode number) for the cards.
  const epStills = season != null ? (stillsBySeason[season] ?? {}) : {};
  const epRatings = season != null ? (ratingsBySeason[season] ?? {}) : {};

  // Returning from the player: scroll the episode list to the episode that was
  // playing (it's also auto-focused) so it's visible, not off-screen left. The
  // index is WITHIN the visible range chunk (the chunk effect lands us on it).
  useEffect(() => {
    if (params.episode == null || season !== params.season || !visibleEpisodes.length) return;
    const idx = visibleEpisodes.findIndex((v) => v.episode === params.episode);
    if (idx <= 0) return;
    const t = setTimeout(() => {
      try { epListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.3 }); } catch { /* not measured yet */ }
    }, 350);
    return () => clearTimeout(t);
  }, [visibleEpisodes, params.episode, season, params.season]);

  const genres = (meta?.genres ?? meta?.genre ?? []).slice(0, 5);

  // "You may also like" (movies): catalog by the first genre, minus this title.
  useEffect(() => {
    if (isSeries || !genres.length) return;
    let cancelled = false;
    fetchCatalog({ type: params.type, id: 'top', extra: { genre: genres[0] } })
      .then((r) => !cancelled && setSimilar(r.metas.filter((x) => x.id !== params.id).slice(0, 14)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSeries, genres[0], params.id, params.type]);

  // Backdrop with no flash: before meta loads, derive the landscape backdrop
  // from the poster we already have (metahub poster -> background/medium), which
  // is byte-identical to meta.background once it arrives, so the <Image> source
  // never swaps. Falls back to the raw poster (hidden under the scrim) otherwise.
  // Backdrop sources, best first (matches the Windows detail page). Some fanart.tv
  // backgrounds 404 / block a direct fetch, so the <Img> advances through these on
  // load error (onError below) instead of showing a black frame.
  const bgCandidates = useMemo(
    () =>
      Array.from(
        new Set(
          [
            normalizeStremioImage(meta?.background),
            normalizeStremioImage(meta?.poster),
            metahubPosterToBackdrop(normalizeStremioImage(params.poster)),
            normalizeStremioImage(params.poster),
          ].filter((u): u is string => !!u),
        ),
      ),
    [meta?.background, meta?.poster, params.poster],
  );
  const [bgIdx, setBgIdx] = useState(0);
  const bgKey = bgCandidates.join('|');
  useEffect(() => setBgIdx(0), [bgKey]);
  const background = bgCandidates[bgIdx] ?? null;
  const cast = (meta?.cast ?? []).slice(0, 5);
  const released = fmtDate(meta?.released) ?? (meta?.releaseInfo ? formatReleaseInfo(meta.releaseInfo) : null) ?? (meta?.year != null ? String(meta.year) : null);
  const metaBits = [meta?.runtime, released].filter(Boolean) as string[];
  const rating = meta?.imdbRating;

  // Deterministic metahub poster from the imdb id — metahub has a poster for every
  // imdb title, and it goes through the same image proxy as the (working) backdrop
  // + stills. This is the reliable show-poster fallback for episode cards.
  const detailImdb = meta?.imdb_id ?? (IMDB_RE.test(params.id) ? params.id : null);
  const metahubPoster = detailImdb ? `https://images.metahub.space/poster/medium/${encodeURIComponent(detailImdb)}/img` : undefined;

  const name = meta?.name ?? params.name;
  // Movie: pick a stream for the title. Series: pick for the episode's videoId
  // (imdb:S:E — what addons key torrent streams on, not the show id).
  const openMoviePicker = () => setPicker({ type: 'movie', id: params.id, title: name });
  const openEpisodePicker = (video: Video) =>
    setPicker({
      type: 'series',
      id: video.id,
      title: name,
      episodeLabel: `S${video.season ?? '?'}E${video.episode ?? '?'}${video.title || video.name ? ` · ${video.title || video.name}` : ''}`,
    });
  // Watched / in-progress episode → ask Resume vs Start over first; otherwise
  // straight to the stream picker (from the start).
  const onEpisodePress = (video: Video) => {
    if (episodeWatched(video) || episodeResumeSeconds(video.id) > 0) {
      setResumeEp(video);
    } else {
      startSecondsRef.current = 0;
      openEpisodePicker(video);
    }
  };
  // Play an episode on the EXACT stream the progress was made on (instant — no
  // re-resolve), if we have it for that episode; otherwise open the picker.
  const playEpisodeDirect = (video: Video, startSeconds: number) => {
    const url = libState?.video_id === video.id ? (libItem as { _blissStreamUrl?: string } | null)?._blissStreamUrl : undefined;
    if (!url) { startSecondsRef.current = startSeconds; openEpisodePicker(video); return; }
    const title = (libItem as { _blissStreamTitle?: string } | null)?._blissStreamTitle ?? name;
    navigation.navigate('Player', {
      url,
      title: name,
      playlist: [{ url, title }],
      startIndex: 0,
      logo: normalizeStremioImage(meta?.logo),
      background,
      poster: normalizeStremioImage(meta?.poster) ?? params.poster ?? null,
      startSeconds,
      description: meta?.description ?? null,
      releaseInfo: released,
      imdbId: meta?.imdb_id ?? (IMDB_RE.test(params.id) ? params.id : null),
      rating: meta?.imdbRating != null ? String(meta.imdbRating) : null,
      streamTarget: { type: 'series', id: video.id, title: name },
      detailId: params.id,
    });
  };
  const onSimilar = (item: CardItem) => navigation.push('Detail', { id: item.id, type: item.type, name: item.name, poster: item.poster ?? undefined });

  return (
    <View style={styles.root}>
      {background ? <Img uri={background} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '72%' }} contentFit="cover" transition={350} onError={() => setBgIdx((i) => i + 1)} /> : null}
      {/* subtle brand-accent (lavender) wash over the backdrop art — below the
          scrims. Same 72% region as the backdrop image. Tied to the themed accent. */}
      {background ? <View pointerEvents="none" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '72%', backgroundColor: colors.accent, opacity: 0.12 }} /> : null}
      {/* .tv-detail-scrim — left->right + bottom->top */}
      <LinearGradient colors={['#07090d', 'rgba(7,9,13,0.55)', 'transparent']} locations={[0.32, 0.52, 0.76]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['#07090d', 'rgba(7,9,13,0.4)', 'transparent']} locations={[0.06, 0.32, 0.6]} start={{ x: 0, y: 1 }} end={{ x: 0, y: 0 }} style={StyleSheet.absoluteFill} />

      <View style={{ flex: 1, paddingHorizontal: m.safeX, paddingVertical: m.safeY }}>
        <BackPill m={m} onPress={() => navigation.goBack()} />

        <View style={{ maxWidth: '48%', marginTop: m.s(13), gap: m.s(10) }}>
          {meta?.logo ? (
            <Img uri={normalizeStremioImage(meta.logo)} style={{ height: m.s(80), width: '60%', alignSelf: 'flex-start' }} contentFit="contain" contentPosition="left" />
          ) : (
            <Text style={{ fontFamily: font.serif, fontSize: m.s(64), lineHeight: m.s(66), color: colors.text }} numberOfLines={2}>
              {meta?.name ?? params.name}
            </Text>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: m.s(14) }}>
            {metaBits.map((b, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center' }}>
                {i > 0 ? <Text style={{ fontSize: m.s(20), color: 'rgba(255,255,255,0.4)', marginRight: m.s(14) }}>·</Text> : null}
                <Text style={{ fontFamily: font.bodySemi, fontSize: m.s(20), color: 'rgba(255,255,255,0.85)' }}>{b}</Text>
              </View>
            ))}
            <Rating
              imdbId={meta?.imdb_id ?? (IMDB_RE.test(params.id) ? params.id : null)}
              initialRating={rating}
              size="md"
              leading={metaBits.length ? <Text style={{ fontSize: m.s(22), color: 'rgba(255,255,255,0.4)', marginRight: m.s(8) }}>·</Text> : null}
            />
          </View>

          <View style={{ gap: m.s(16) }}>
            {genres.length ? (
              <View>
                <Label m={m}>Genres</Label>
                <Chips items={genres} m={m} onPress={(g) => navigation.navigate('Discover', { type: params.type, genre: g })} />
              </View>
            ) : null}
            {cast.length ? (
              <View>
                <Label m={m}>Cast</Label>
                <Chips items={cast} m={m} onPress={(c) => navigation.navigate('Search', { query: c })} />
              </View>
            ) : null}
          </View>

          {meta?.description ? (
            <View>
              <Label m={m}>Summary</Label>
              <Text style={{ fontFamily: font.body, fontSize: m.s(18), lineHeight: m.s(27), color: 'rgba(255,255,255,0.82)', maxWidth: m.s(640) }} numberOfLines={6}>
                {meta.description}
              </Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.s(11), marginTop: m.s(8) }}>
            {!isSeries ? <ActionBtn label="Watch" icon="play" primary autoFocus m={m} onPress={openMoviePicker} /> : null}
            <ActionBtn label={inLibrary ? 'Remove from library' : 'Add to library'} icon={inLibrary ? 'bookmark' : 'bookmark-outline'} autoFocus={isSeries && params.episode == null} m={m} onPress={handleToggleLibrary} />
            {meta?.trailerStreams?.length ? <ActionBtn label="Trailer" icon="film-outline" m={m} onPress={() => { /* trailer modal next */ }} /> : null}
          </View>

        </View>

        <View style={{ flex: 1 }} />

        {/* .tv-detail-bottom — episodes (series) or similar (movie). */}
        {isSeries && seasons.length ? (
          <View style={{ marginBottom: m.s(40) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(20), marginBottom: m.s(12) }}>
              <Text style={{ fontFamily: font.serif, fontSize: m.s(36), color: colors.text }}>Episodes</Text>
              {seasons.length > 1 ? (() => {
                const idx = Math.max(0, seasons.indexOf(season ?? seasons[0]));
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
                    <SeasonChevron icon="chevron-back" m={m} disabled={idx <= 0} onPress={() => setSeason(seasons[idx - 1])} />
                    <TvSelect
                      iconName="albums-outline"
                      options={seasons.map((s): SelectOption => ({ key: String(s), label: `Season ${s}` }))}
                      value={String(season ?? seasons[0])}
                      onChange={(k) => setSeason(Number(k))}
                      m={m}
                      minWidth={m.s(220)}
                      onOpen={setDropdown}
                    />
                    <SeasonChevron icon="chevron-forward" m={m} disabled={idx >= seasons.length - 1} onPress={() => setSeason(seasons[idx + 1])} />
                  </View>
                );
              })() : null}
              {/* Episode-range selector for huge seasons (One Piece etc.). */}
              {needsRanges ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: m.s(8) }}>
                  <SeasonChevron icon="chevron-back" m={m} disabled={safeChunk <= 0} onPress={() => setEpChunk(safeChunk - 1)} />
                  <TvSelect
                    iconName="list-outline"
                    options={rangeOptions}
                    value={String(safeChunk)}
                    onChange={(k) => setEpChunk(Number(k))}
                    m={m}
                    minWidth={m.s(300)}
                    onOpen={setDropdown}
                  />
                  <SeasonChevron icon="chevron-forward" m={m} disabled={safeChunk >= chunkCount - 1} onPress={() => setEpChunk(safeChunk + 1)} />
                </View>
              ) : null}
            </View>
            <FlatList
              ref={epListRef}
              horizontal
              data={visibleEpisodes}
              keyExtractor={(v) => v.id}
              showsHorizontalScrollIndicator={false}
              getItemLayout={(_, index) => ({ length: m.s(280), offset: m.s(280) * index, index })}
              onScrollToIndexFailed={() => { /* layout not measured yet — the effect retries */ }}
              contentContainerStyle={{ gap: m.s(20), paddingVertical: m.s(10), paddingLeft: m.s(2), paddingRight: m.safeX }}
              renderItem={({ item }) => (
                <EpisodeCard
                  video={item}
                  m={m}
                  runtime={meta?.runtime}
                  // Per-episode stills first (metahub thumbnail → TMDB still); on
                  // error they cycle, then fall back to the show poster. Unreleased
                  // episodes have no real still so the list is empty → straight to
                  // the show poster (CW-modal/library poster, known to render).
                  imgs={
                    (item.released && new Date(item.released).getTime() > Date.now())
                      ? []
                      : [normalizeStremioImage(item.thumbnail), item.episode != null ? epStills[item.episode] : null]
                  }
                  poster={metahubPoster ?? libPoster ?? normalizeStremioImage(params.poster) ?? normalizeStremioImage(meta?.poster) ?? background}
                  rating={(item.episode != null ? epRatings[item.episode] : undefined) ?? (item as { imdbRating?: string | number }).imdbRating ?? null}
                  watched={episodeWatched(item)}
                  progress={episodeProgressPct(item.id)}
                  autoFocus={item.episode === params.episode && season === params.season}
                  onPress={() => onEpisodePress(item)}
                />
              )}
            />
          </View>
        ) : !isSeries && similar.length ? (
          <View style={{ marginBottom: m.s(40) }}>
            <Text style={{ fontFamily: font.serif, fontSize: m.s(36), color: colors.text, marginBottom: m.s(12) }}>You may also like</Text>
            <FlatList horizontal data={similar} keyExtractor={(it) => it.id} showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: m.s(20), paddingTop: m.s(14), paddingBottom: m.s(8), paddingLeft: m.s(8), paddingRight: m.safeX }} renderItem={({ item }) => <PosterCard item={item} width={m.s(180)} onSelect={onSimilar} />} />
          </View>
        ) : null}
      </View>

      <StreamPicker
        target={picker}
        onClose={() => setPicker(null)}
        onPlay={(streams, index) => {
          setPicker(null);
          navigation.navigate('Player', {
            url: streams[index].url,
            // Clean media name for the back pill / pause overlay (NOT the torrent
            // filename — that's the stream title, kept only inside `playlist`).
            title: meta?.name ?? params.name,
            playlist: streams,
            startIndex: index,
            logo: normalizeStremioImage(meta?.logo),
            background,
            poster: normalizeStremioImage(meta?.poster) ?? params.poster ?? null,
            startSeconds: startSecondsRef.current,
            description: meta?.description ?? null,
            releaseInfo: released,
            imdbId: meta?.imdb_id ?? (IMDB_RE.test(params.id) ? params.id : null),
            rating: meta?.imdbRating != null ? String(meta.imdbRating) : null,
            // Lets the player's Sources/Releases button re-open the stream picker.
            streamTarget: picker ?? undefined,
            // Back from the player returns to THIS detail page (the show id).
            detailId: params.id,
          });
        }}
      />

      {dropdown ? (
        <TvSelectOverlay
          anchor={dropdown}
          onClose={() => {
            const refocus = dropdown.requestFocus;
            setDropdown(null);
            setTimeout(() => refocus(), 50);
          }}
          m={m}
        />
      ) : null}

      {/* Resume / Start-over for a watched or in-progress episode. */}
      {resumeEp ? (
        <ResumeModal
          item={cwItemForEpisode(resumeEp, name, normalizeStremioImage(meta?.poster) ?? params.poster, episodeResumeSeconds(resumeEp.id))}
          onResume={() => { const v = resumeEp; setResumeEp(null); playEpisodeDirect(v, episodeResumeSeconds(v.id)); }}
          onStartOver={() => { const v = resumeEp; setResumeEp(null); playEpisodeDirect(v, 0); }}
          onGoToDetail={() => setResumeEp(null)}
          onClose={() => setResumeEp(null)}
        />
      ) : null}
    </View>
  );
}

function cwItemForEpisode(video: Video, showName: string, poster: string | undefined | null, resumeSeconds: number): CwItem {
  return {
    id: video.id,
    type: 'series',
    name: showName,
    poster: poster ?? undefined,
    progress: 0,
    resumeSeconds,
    episodeLabel: `S${video.season ?? '?'}E${video.episode ?? '?'}${video.title || video.name ? ` · ${video.title || video.name}` : ''}`,
    videoId: video.id,
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
