import type { Dispatch, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { LibraryItem } from '../../../lib/mediaTypes';
import type { MediaType } from '../../../types/media';
import { normalizeStremioImage } from '../../../lib/mediaTypes';
import { putBlissfulLibraryItem } from '../../../lib/blissfulAuthApi';
import { getLastStreamSelection } from '../../../lib/streamHistory';
import { getResumeSeconds } from '../utils';
import { fetchMeta } from '../../../lib/stremioAddon';
import { shellOrigin } from '../../../lib/desktop';
import { preloadImage } from '../../../lib/imageProxy';

type UseContinueWatchingActionsParams = {
  authKey: string | null;
  navigate: NavigateFunction;
  setContinueWatching: Dispatch<SetStateAction<LibraryItem[]>>;
  setContinueSyncError: (value: string | null) => void;
  /** Called when the stored stream URL is detected as a debrid DMCA
   *  placeholder (Real-Debrid serves a ~30s "file removed" video, <20MB).
   *  Caller is expected to surface a modal in the current context — we
   *  do NOT navigate anywhere when this fires, so the user can pick a
   *  different stream from where they already are. */
  onStreamUnavailable?: (item: LibraryItem) => void;
};

export function useContinueWatchingActions({
  authKey,
  navigate,
  setContinueWatching,
  setContinueSyncError,
  onStreamUnavailable,
}: UseContinueWatchingActionsParams) {
  const onOpenContinueItem = async (
    item: LibraryItem,
    options?: { source?: 'mobile' | 'desktop'; mode?: 'resume' | 'start-over' }
  ) => {
    const videoId =
      (item.state as any)?.videoId ??
      (item.state as any)?.video_id ??
      item.behaviorHints?.defaultVideoId ??
      null;
    // `mode: 'start-over'` from the sidebar's two-option menu — ignore
    // saved progress and start the stream at 0. Default 'resume' keeps
    // the legacy behavior (start at the saved offset).
    const resumeSeconds = options?.mode === 'start-over' ? 0 : getResumeSeconds(item);

    // Try localStorage first (fastest), then fall back to the server-
    // stored stream URL from the library entry (persists across devices).
    // Only accept URLs that mpv can actually play (http/https/magnet) —
    // web-only URLs (vidking:, iframe:, etc.) from the web version are
    // useless for the desktop player.
    const isPlayableUrl = (url: string | unknown): url is string =>
      typeof url === 'string' && /^(https?:|magnet:)/i.test(url);
    // If the progress came from the web version or Stremio, skip
    // straight to the detail page so the user picks a torrent. Web
    // streams (Videasy/iframe) can't play in mpv.
    const progressSource = (item as Record<string, unknown>)._blissProgressSource as string | undefined;
    const isWebProgress = progressSource === 'web' || progressSource === 'stremio'
      || (!(item as Record<string, unknown>)._blissStreamUrl && !getLastStreamSelection({
        authKey, type: item.type, id: item._id,
        videoId: typeof videoId === 'string' ? videoId : null,
      }));

    if (isWebProgress) {
      // Progress came from the web player or Stremio — the saved URL (if
      // any) can't play in mpv, so hand off to the detail page's AUTO-PICK
      // flow: it fetches addon streams, picks the top-ranked torrent, and
      // resumes at the saved offset. The logo is resolved here (best-effort,
      // covered by the black pending veil) and passed as a `?logo=` hint so
      // the detail autoplay veil paints the title's logo immediately —
      // without it the veil sits plain black for the meta-fetch duration
      // and the CW→player loading chain visibly breaks.
      const base = `/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item._id)}`;
      const qs = new URLSearchParams();
      if (item.type === 'series' && typeof videoId === 'string') qs.set('videoId', videoId);
      qs.set('autoplay', '1');
      if (resumeSeconds && resumeSeconds > 0) qs.set('t', String(Math.floor(resumeSeconds)));
      try {
        const meta = await fetchMeta({ type: item.type as MediaType, id: item._id });
        const logo = normalizeStremioImage(meta.meta.logo ?? null);
        if (logo) { qs.set('logo', logo); preloadImage(logo); }
      } catch {
        // best-effort — the veil just stays black until detail's own meta loads
      }
      navigate(`${base}?${qs.toString()}`);
      return;
    }

    const localStored = getLastStreamSelection({
      authKey,
      type: item.type,
      id: item._id,
      videoId: typeof videoId === 'string' ? videoId : null,
    });
    const serverUrl = (item as Record<string, unknown>)._blissStreamUrl;
    const stored = (localStored && isPlayableUrl(localStored.url) ? localStored : null)
      ?? (isPlayableUrl(serverUrl)
        ? {
            url: serverUrl,
            title: ((item as Record<string, unknown>)._blissStreamTitle as string) ?? null,
            logo: null,
          }
        : null
    );

    // Resolve logo AND background in a single meta fetch — the player's
    // buffering veil uses `background` (16:9 hero) for the loading
    // image. Without this the player only gets the vertical `poster`
    // and the cover-fit on a non-16:9 image looks zoomed/cropped.
    const resolveMetaImages = async () => {
      const cached: { logo: string | null; background: string | null } = {
        logo: stored?.logo ?? null,
        background: null,
      };
      try {
        const meta = await fetchMeta({ type: item.type as any, id: item._id });
        if (!cached.logo) {
          cached.logo = normalizeStremioImage(meta.meta.logo ?? null) || null;
        }
        cached.background =
          normalizeStremioImage(meta.meta.background ?? null) || null;
      } catch {
        // ignore — fall back to whatever we have from `stored`
      }
      return cached;
    };

    // Mobile + iOS used to detour through a "Play in VLC / Play in
    // Browser" drawer and (for series) bounce back to the detail
    // page. Now that the web player is the single playback path on
    // every platform, both branches just go straight to /player.

    if (stored?.url) {
      // Pre-flight HEAD probe — Real-Debrid serves a ~30 s "File was
      // removed" placeholder (<20 MB) when a cached release is DMCA'd.
      // If we hit one, transparently fall back to the auto-pick flow:
      // hand off to the detail page with `autoplay=1&t=<sec>` so it
      // fetches addon streams, picks the top-ranked one, and resumes
      // at the saved offset — the user never sees a player UI on a
      // dead stream.
      if (/^https:\/\//i.test(stored.url)) {
        try {
          const probe = await fetch(
            `${shellOrigin()}/resolve-url?url=${encodeURIComponent(stored.url)}`,
          );
          if (probe.ok) {
            const data = (await probe.json()) as { contentLength?: number };
            const len = data.contentLength ?? 0;
            if (len > 0 && len < 20 * 1024 * 1024) {
              const base = `/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item._id)}`;
              const fbQs = new URLSearchParams();
              if (item.type === 'series' && typeof videoId === 'string') {
                fbQs.set('videoId', videoId);
              }
              fbQs.set('autoplay', '1');
              if (resumeSeconds && resumeSeconds > 0) {
                fbQs.set('t', String(Math.floor(resumeSeconds)));
              }
              // Seed the skip list with the dead URL so detail's auto-pick
              // doesn't reselect the very same stream we just probed dead.
              fbQs.append('skip', stored.url);
              navigate(`${base}?${fbQs.toString()}`);
              if (onStreamUnavailable) {
                // intentionally unused now; kept in signature so
                // callers don't break and so the modal infra remains
                // available for future use (e.g. when ALL alternative
                // streams are also unavailable).
                void onStreamUnavailable;
              }
              return;
            }
          }
        } catch {
          // Probe failed (network, timeout) — fall through and let the
          // player handle it. NativeMpvPlayer has the same probe + the
          // duration-based safety net as a second line of defense.
        }
      }

      const { logo, background } = await resolveMetaImages();
      // Build piece-by-piece — `new URLSearchParams({ k: undefined })`
      // stringifies undefined to the literal "undefined", which then
      // round-trips into the library row's `name` and shows up as a
      // tile titled "undefined" in Continue Watching forever.
      const qs = new URLSearchParams({
        url: stored.url,
        type: item.type,
        id: item._id,
      });
      const resolvedTitle = stored.title ?? item.name ?? null;
      if (resolvedTitle) qs.set('title', resolvedTitle);
      if (item.name) qs.set('metaTitle', item.name);
      if (logo) { qs.set('logo', logo); preloadImage(logo); }
      if (background) qs.set('background', background);
      if (item.poster) {
        const poster = normalizeStremioImage(item.poster);
        if (poster) qs.set('poster', poster);
      }
      if (item.type === 'series' && typeof videoId === 'string') qs.set('videoId', videoId);
      if (resumeSeconds && Number.isFinite(resumeSeconds) && resumeSeconds > 0) {
        qs.set('t', String(resumeSeconds));
      }
      navigate(`/player?${qs.toString()}`);
      return;
    }

    // No stored stream — the user is resuming an item that progress
    // came from Stremio cloud sync, not from prior Blissful playback.
    // We still want the click to feel like instant resume, so we hand
    // off to the detail page with `autoplay=1` so it can pick the top
    // stream and navigate to the player automatically once addons have
    // resolved. `t` carries the seek timestamp.
    const base = `/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item._id)}`;
    const qs = new URLSearchParams();
    if (item.type === 'series' && typeof videoId === 'string') {
      qs.set('videoId', videoId);
    }
    qs.set('autoplay', '1');
    if (resumeSeconds && resumeSeconds > 0) {
      qs.set('t', String(Math.floor(resumeSeconds)));
    }
    const query = qs.toString();
    navigate(query ? `${base}?${query}` : base);
  };

  const onRemoveContinueItem = (item: LibraryItem) => {
    setContinueWatching((prev) => prev.filter((x) => x._id !== item._id));
    if (!authKey) return;
    setContinueSyncError(null);
    // Zero out the progress fields but keep the row in the library —
    // matches the prior "rewind" semantics (still bookmarked, just
    // doesn't show up in Continue Watching anymore).
    const wiped: LibraryItem = {
      ...item,
      state: {
        ...(item.state ?? {}),
        timeOffset: 0,
        duration: 0,
        timeWatched: 0,
        lastWatched: '',
      },
    };
    void putBlissfulLibraryItem(authKey, item._id, wiped).catch((err: unknown) => {
      console.error('Failed to sync continue-watching removal', err);
      setContinueSyncError('Failed to update item');
      window.setTimeout(() => setContinueSyncError(null), 3000);
    });
  };

  return { onOpenContinueItem, onRemoveContinueItem };
}
