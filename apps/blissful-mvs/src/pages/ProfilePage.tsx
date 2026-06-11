// Friend Profile page — a friend's identity plus what they've been
// watching lately. Reached via the "View profile" action in the
// Friends list. Data comes from blissful-storage's
// `/users/:id/profile`, which is gated server-side to accepted friends
// (or self) and returns the friend's recent library rows that carry
// playback progress (i.e. their Continue-Watching surface).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { fetchUserProfile, type FriendProfileResponse } from '../lib/blissfulAuthApi';
import { normalizeStremioImage } from '../lib/mediaTypes';
import { proxiedImage } from '../lib/imageProxy';
import { FriendAvatar } from '../components/Friends/FriendAvatar';
import { formatRelativeTime } from '../components/Friends/relativeTime';
import { TruncatedText } from '../components/TruncatedText';

// `<imdb>:<season>:<episode>` → "S2E4". Mirrors the sidebar's
// activityLabel logic so episode tags read consistently.
function seasonEpisodeTag(videoId: string | null | undefined): string | null {
  if (!videoId) return null;
  const parts = videoId.split(':');
  if (parts.length < 3) return null;
  const season = Number(parts[parts.length - 2]);
  const episode = Number(parts[parts.length - 1]);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  return `S${season}E${episode}`;
}

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { authKey } = useAuth();
  const navigate = useNavigate();

  const [data, setData] = useState<FriendProfileResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authKey || !userId) {
      setLoading(false);
      setError(!authKey ? 'Sign in to view profiles.' : 'No user specified.');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    fetchUserProfile(authKey, userId)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load profile.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authKey, userId]);

  const statusLine = useMemo(() => {
    if (!data) return '';
    if (data.online && data.currentActivity?.name) {
      const tag = seasonEpisodeTag(data.currentActivity.videoId);
      return `Watching ${data.currentActivity.name}${tag ? ` · ${tag}` : ''}`;
    }
    if (data.online) return 'Online';
    if (data.lastSeenAt) return `Last seen ${formatRelativeTime(data.lastSeenAt)}`;
    return 'Offline';
  }, [data]);

  const isWatchingNow = Boolean(data?.online && data.currentActivity?.name);

  // navigate(-1) dead-ends when the profile is the first history entry
  // (shared link, hard refresh, or new tab) — there's no in-app entry to
  // pop back to. Fall back to home in that case so Back is never inert.
  const handleBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate('/');
  };

  return (
    <div className="mx-auto w-full max-w-5xl pt-6 md:pt-10">
      <button
        type="button"
        onClick={handleBack}
        className="mb-6 inline-flex cursor-pointer items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/80 hover:bg-white/20"
      >
        <span aria-hidden>←</span> Back
      </button>

      {loading ? (
        // Skeleton mirrors the loaded layout (header card + poster grid
        // sharing the exact grid classes) so content settles in place
        // instead of popping in — same no-layout-jump pattern as Discover.
        <div className="animate-pulse">
          <div className="solid-surface flex items-center gap-5 rounded-[28px] bg-white/6 p-6">
            <div className="h-[clamp(4rem,10vh,6rem)] w-[clamp(4rem,10vh,6rem)] shrink-0 rounded-full bg-white/10" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-6 w-1/2 rounded bg-white/10" />
              <div className="h-3.5 w-1/3 rounded bg-white/10" />
              <div className="h-3.5 w-2/5 rounded bg-white/10" />
            </div>
          </div>
          <div className="mt-8">
            <div className="mb-3 h-3 w-32 rounded bg-white/10" />
            <div className="grid grid-cols-2 gap-5 p-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="aspect-[2/3] w-full rounded-2xl bg-white/10" />
                  <div className="h-3.5 w-3/4 rounded bg-white/10" />
                  <div className="h-3 w-1/2 rounded bg-white/10" />
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : error ? (
        <div className="solid-surface rounded-[28px] bg-white/6 px-6 py-10 text-center">
          <div className="text-lg font-medium text-white">Couldn’t open this profile</div>
          <div className="mt-2 text-sm text-white/60">{error}</div>
        </div>
      ) : data ? (
        <>
          {/* Header card */}
          <div className="solid-surface flex items-center gap-5 rounded-[28px] bg-white/6 p-6">
            <FriendAvatar
              displayName={data.profile.displayName}
              size="clamp(4rem,10vh,6rem)"
              online={data.online}
            />
            <div className="min-w-0 flex-1">
              <TruncatedText
                content={data.profile.displayName}
                placement="bottom"
                className="truncate text-2xl font-semibold text-white md:text-3xl"
              />
              {data.profile.username ? (
                <TruncatedText
                  content={`@${data.profile.username}`}
                  placement="bottom"
                  className="mt-0.5 truncate text-sm text-white/50"
                />
              ) : null}
              <TruncatedText
                content={statusLine}
                placement="bottom"
                className={`mt-1.5 truncate text-sm ${isWatchingNow ? 'text-[var(--bliss-accent)] font-medium' : 'text-white/60'}`}
              />
              {data.profile.createdAt ? (
                <div className="mt-1 text-xs text-white/35">
                  Member since{' '}
                  {new Date(data.profile.createdAt).toLocaleDateString(undefined, {
                    month: 'long',
                    year: 'numeric',
                  })}
                </div>
              ) : null}
            </div>
          </div>

          {/* Recently watched */}
          <div className="mt-8">
            <div className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-white/45">
              Recently watched
            </div>
            {data.history.length === 0 ? (
              <div className="px-1 py-6 text-sm text-white/50">No recent activity to show.</div>
            ) : (
              <div className="grid grid-cols-2 gap-5 p-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {data.history.map((h) => {
                  const poster = normalizeStremioImage(h.poster);
                  const tag = seasonEpisodeTag(h.videoId);
                  const progress =
                    h.duration > 0
                      ? Math.min(100, Math.max(0, (h.timeOffset / h.duration) * 100))
                      : null;
                  const target =
                    `/detail/${encodeURIComponent(h.type ?? 'movie')}/${encodeURIComponent(h.id)}` +
                    (h.videoId ? `?videoId=${encodeURIComponent(h.videoId)}` : '');
                  return (
                    <button
                      key={`${h.id}:${h.videoId ?? ''}`}
                      type="button"
                      onClick={() => navigate(target)}
                      className="group flex cursor-pointer flex-col text-left"
                    >
                      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl bg-white/10">
                        {poster ? (
                          <img
                            src={proxiedImage(poster)}
                            alt=""
                            loading="lazy"
                            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center p-2 text-center text-xs text-white/40">
                            {h.name ?? 'Untitled'}
                          </div>
                        )}
                        {progress !== null ? (
                          <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/40">
                            <div
                              className="h-full bg-[var(--bliss-accent)]"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        ) : null}
                      </div>
                      <TruncatedText
                        content={h.name ?? 'Untitled'}
                        placement="top"
                        className="mt-1.5 truncate text-sm font-medium text-white/90"
                      />
                      <div className="truncate text-xs text-white/50">
                        {tag ?? (h.type === 'series' ? 'Series' : 'Movie')}
                        {h.lastWatched ? ` · ${formatRelativeTime(h.lastWatched)}` : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
