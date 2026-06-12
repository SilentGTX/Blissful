// Top-right badge cluster on the player: HDR, RD (Real-Debrid).
//
// Quality was here historically but it's now rendered on the bottom
// controls bar (in place of the gear icon). Keeping the cluster
// HDR/RD/error-only frees the top-right for the Watch Party button.
//
// HDR fires when the video reports a PQ or HLG transfer characteristic
// for the active video track. RD is a pure URL inspection: torrentio +
// Real-Debrid stream URLs always pass through /resolve/realdebrid/.

import React from 'react';

export type PlayerHdrBadgesProps = {
  videoGamma: string | null;
  streamUrl: string | null;
  error: string | null;
};

const BADGE_CLASS =
  'rounded-md border border-white/15 bg-black/45 px-2 py-1 text-[10px] font-bold tracking-wider text-white/80 backdrop-blur';

export const PlayerHdrBadges = React.memo(function PlayerHdrBadges({
  videoGamma,
  streamUrl,
  error,
}: PlayerHdrBadgesProps) {
  const isHdr = videoGamma === 'pq' || videoGamma === 'hlg';
  const rawUrl = streamUrl ?? '';
  // Decode repeatedly — the played URL is /transcode.m3u8?url=<encoded torrentio
  // url>, and that inner url itself has %20-encoded spaces, so the filename is
  // DOUBLE-encoded. One decode leaves "...%201080p..." where 1080p is glued to a
  // digit and \b fails; decode until stable so spaces are real.
  let decodedUrl = rawUrl;
  for (let i = 0; i < 3 && /%[0-9a-f]{2}/i.test(decodedUrl); i++) {
    try {
      const next = decodeURIComponent(decodedUrl);
      if (next === decodedUrl) break;
      decodedUrl = next;
    } catch {
      break;
    }
  }
  const isRealDebrid = /(\/resolve\/realdebrid\/|real-?debrid)/i.test(decodedUrl);
  // Resolution badge — only for RD streams, parsed from the release filename in
  // the URL (e.g. "From.S04E07.1080p.x265-ELiTE.mkv" → "1080p").
  let rdQuality: string | null = null;
  if (isRealDebrid) {
    const q = decodedUrl.match(/(2160p|4k|uhd|1440p|1080p|720p|480p|360p)/i);
    if (q) {
      const v = q[1].toLowerCase();
      rdQuality = v === '2160p' || v === '4k' || v === 'uhd' ? '4K' : v;
    }
  }
  return (
    <div className="flex items-center gap-2">
      {isHdr ? (
        <div className={BADGE_CLASS} title={videoGamma === 'pq' ? 'HDR10' : 'HLG'}>
          HDR
        </div>
      ) : null}
      {isRealDebrid ? (
        <div className={BADGE_CLASS} title="Real-Debrid">
          RD
        </div>
      ) : null}
      {rdQuality ? (
        <div className={BADGE_CLASS} title={`Real-Debrid · ${rdQuality}`}>
          {rdQuality.toUpperCase()}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-full bg-red-500/20 px-3 py-1 text-xs text-red-200 backdrop-blur">
          {error}
        </div>
      ) : null}
    </div>
  );
});
