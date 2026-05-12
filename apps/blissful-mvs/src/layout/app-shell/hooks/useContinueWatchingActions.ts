import type { Dispatch, SetStateAction } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { LibraryItem } from '../../../lib/stremioApi';
import { rewindLibraryItem } from '../../../lib/stremioApi';
import { getLastStreamSelection } from '../../../lib/streamHistory';
import type { WhatToDoPrompt } from '../../../components/WhatToDoDrawer';
import { getResumeSeconds, isIos, parsePromptTitleLines, splitMetaLine } from '../utils';
import { normalizeStremioImage } from '../../../lib/stremioApi';
import { fetchMeta } from '../../../lib/stremioAddon';

type UseContinueWatchingActionsParams = {
  authKey: string | null;
  navigate: NavigateFunction;
  setContinueWatching: Dispatch<SetStateAction<LibraryItem[]>>;
  setContinueSyncError: (value: string | null) => void;
  setIosPlayPrompt: (value: WhatToDoPrompt) => void;
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
  setIosPlayPrompt,
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

    const stored = getLastStreamSelection({
      authKey,
      type: item.type,
      id: item._id,
      videoId: typeof videoId === 'string' ? videoId : null,
    });

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

    if (options?.source === 'mobile' && item.type === 'series' && typeof videoId === 'string') {
      const base = `/detail/${encodeURIComponent(item.type)}/${encodeURIComponent(item._id)}`;
      navigate(`${base}?videoId=${encodeURIComponent(videoId)}`);
      return;
    }

    if (isIos() && stored?.url) {
      const parsed = parsePromptTitleLines(stored.title ?? item.name);
      const metaParts = (() => {
        if (!parsed.meta) return undefined;
        const parts = splitMetaLine(parsed.meta);
        return [parts.seeders, parts.size, parts.provider].filter(
          (v): v is string => typeof v === 'string' && v.length > 0
        );
      })();

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
      const playerLink = `/player?${qs.toString()}`;

      setIosPlayPrompt({
        title: parsed.primary,
        url: stored.url,
        playerLink,
        metaLine: parsed.meta,
        metaParts,
      });
      return;
    }

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
            `/resolve-url?url=${encodeURIComponent(stored.url)}`,
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
    if (resumeSeconds && resumeSeconds > 0) {
      qs.set('autoplay', '1');
      qs.set('t', String(Math.floor(resumeSeconds)));
    }
    const query = qs.toString();
    navigate(query ? `${base}?${query}` : base);
  };

  const onRemoveContinueItem = (item: LibraryItem) => {
    setContinueWatching((prev) => prev.filter((x) => x._id !== item._id));
    if (!authKey) return;
    setContinueSyncError(null);
    void rewindLibraryItem({ authKey, id: item._id }).catch((err: unknown) => {
      console.error('Failed to sync continue-watching removal', err);
      setContinueSyncError('Failed to sync removal with Stremio');
      window.setTimeout(() => setContinueSyncError(null), 3000);
    });
  };

  return { onOpenContinueItem, onRemoveContinueItem };
}
