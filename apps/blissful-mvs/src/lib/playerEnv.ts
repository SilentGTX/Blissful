// Shared player-environment helpers used by InvitePage and the player.

export function parseSeriesInfo(videoId: string | null): { season?: number; episode?: number } | undefined {
  if (!videoId) return undefined;
  const parts = videoId.split(':');
  if (parts.length < 3) return undefined;
  const season = Number.parseInt(parts[parts.length - 2], 10);
  const episode = Number.parseInt(parts[parts.length - 1], 10);
  const result: { season?: number; episode?: number } = {};
  if (Number.isFinite(season) && season > 0) result.season = season;
  if (Number.isFinite(episode) && episode > 0) result.episode = episode;
  return result.season || result.episode ? result : undefined;
}
