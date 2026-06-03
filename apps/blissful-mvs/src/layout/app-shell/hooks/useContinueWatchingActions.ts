import type { Dispatch, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { LibraryItem } from '../../../lib/mediaTypes';
import { normalizeStremioImage } from '../../../lib/mediaTypes';
import { putBlissfulLibraryItem } from '../../../lib/blissfulAuthApi';
import { getLastStreamSelection } from '../../../lib/streamHistory';
import { getResumeSeconds } from '../utils';
import { fetchMeta } from '../../../lib/stremioAddon';
import { proxyUrl } from '../../../lib/proxyBase';
import { isAndroidTv } from '../../../lib/platform';
import { isAndroidPlayableUrl } from '../../../lib/androidPlayable';

type UseContinueWatchingActionsParams = {
  authKey: string | null;
  navigate: NavigateFunction;
  setContinueWatching: Dispatch<SetStateAction<LibraryItem[]>>;
  setContinueSyncError: (value: string | null) => void;
  /** Called when the stored stream cannot be played from where the user
   *  is and we therefore refuse to navigate. Today this fires only for
   *  the RD-only Android (Tauri TV) case: a stored magnet: / local
   *  stremio-server URL that needs the absent torrent server. (The
   *  signature is also kept available for the debrid DMCA-placeholder
   *  flow, which currently transparently auto-falls-back instead.)
   *  Caller surfaces a modal in the current context — we do NOT navigate
   *  when this fires, so the user can pick a different stream in place. */
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
    options?: { source?: 'mobile' | 'desktop'; mode?: 'resume' | 'start-over' | 'advance' }
  ) => {
    // SERIES "advance" — no meaningful resume on the last-played episode. Open
    // the detail page and let it land on the next-to-watch episode in the bottom
    // EPISODES rail (TV: switch to its season + focus its card) WITHOUT opening
    // the stream-selection popup. The detail page computes next-to-watch from its
    // OWN decoded watched set + meta; we deliberately pass NO videoId (passing it
    // would select the episode and force the popup open), NO autoplay, NO `t`.
    // Returns before all resume/stored-stream logic, so the movie + genuine-resume
    // paths are unchanged.
    if (options?.mode === 'advance' && (item.type === 'series' || item.type === 'anime')) {
      navigate(`/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item._id)}`);
      return;
    }

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
      const base = `/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item._id)}`;
      const qs = new URLSearchParams();
      if (item.type === 'series' && typeof videoId === 'string') qs.set('videoId', videoId);
      // On the RD-only Android build there is no local/web player to fall back to —
      // pressing Resume/Play from Continue Watching means "watch it now". So auto-pick
      // the top (Real-Debrid) stream on the detail page and play, instead of silently
      // dumping the user on the detail page. `t` resumes at the saved offset.
      if (isAndroidTv()) qs.set('autoplay', '1');
      if (resumeSeconds && resumeSeconds > 0) qs.set('t', String(Math.floor(resumeSeconds)));
      const query = qs.toString();
      navigate(query ? `${base}?${query}` : base);
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
            proxyUrl(`/resolve-url?url=${encodeURIComponent(stored.url)}`),
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
              return;
            }
          }
        } catch {
          // Probe failed (network, timeout) — fall through and let the
          // player handle it. NativeMpvPlayer has the same probe + the
          // duration-based safety net as a second line of defense.
        }
      }

      // RD-ONLY Android: this is the one path that hands a stored URL
      // straight to /player without DetailPage.handleNavigateToPlayer's
      // guard. If the stored stream needs the (absent) local torrent
      // server (magnet: / /stremio-server/...), surface the RD-required
      // modal WHERE THE USER IS and do NOT navigate. Desktop/browser are
      // unaffected (isAndroidTv() === false).
      if (isAndroidTv() && !isAndroidPlayableUrl(stored.url)) {
        if (onStreamUnavailable) onStreamUnavailable(item);
        return;
      }

      const { logo, background } = await resolveMetaImages();
      const qs = new URLSearchParams({
        url: stored.url,
        title: stored.title ?? item.name,
        metaTitle: item.name,
        type: item.type,
        id: item._id,
      });
      if (logo) qs.set('logo', logo);
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
