// "watching <name>" label for a friend's current playback activity.
//
// Stremio video ids for series are formatted `<imdbId>:<season>:<episode>`
// (e.g. `tt9813792:12:4`). When that pattern is detected we append an
// `SxxEyy` tag so the sidebar reads "The Big Bang Theory - S12E4"
// instead of just the show name.

import type { PresenceActivity } from '../../lib/blissfulAuthApi';

export function activityLabel(activity: PresenceActivity | null): string | null {
  if (!activity || !activity.name) return null;
  const tag = seasonEpisodeTag(activity.videoId);
  return tag ? `${activity.name} - ${tag}` : activity.name;
}

function seasonEpisodeTag(videoId: string | null | undefined): string | null {
  if (!videoId) return null;
  const parts = videoId.split(':');
  if (parts.length < 3) return null;
  const season = Number(parts[parts.length - 2]);
  const episode = Number(parts[parts.length - 1]);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  return `S${season}E${episode}`;
}
