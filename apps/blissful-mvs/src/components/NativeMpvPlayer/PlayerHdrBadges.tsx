// Top-right badge cluster on the player: 4K, HDR, RD (Real-Debrid).
//
// HDR fires when mpv reports a PQ or HLG transfer characteristic for
// the active video track — same predicate Stremio's HDRLabel uses.
// 4K detection is two-stage: stream-title parsing gives an instant
// badge before the decoder has reported dimensions (uploaders mislabel
// constantly — 1080p reencodes get tagged "4K", real UHDs sold as
// "WEB-DL"), then mpv's `dwidth` overrides as ground truth once
// available.
// RD is a pure URL inspection: torrentio + Real-Debrid stream URLs
// always pass through /resolve/realdebrid/.

import React from 'react';

export type PlayerHdrBadgesProps = {
  videoGamma: string | null;
  videoDwidth: number | null;
  streamTitle: string | null;
  streamUrl: string | null;
  error: string | null;
};

const BADGE_CLASS =
  'rounded-md border border-white/15 bg-black/45 px-2 py-1 text-[10px] font-bold tracking-wider text-white/80 backdrop-blur';

export const PlayerHdrBadges = React.memo(function PlayerHdrBadges({
  videoGamma,
  videoDwidth,
  streamTitle,
  streamUrl,
  error,
}: PlayerHdrBadgesProps) {
  const isHdr = videoGamma === 'pq' || videoGamma === 'hlg';
  const titleSays4K = /\b(?:2160p|4k|uhd)\b/i.test(streamTitle ?? '');
  const is4K = videoDwidth !== null ? videoDwidth >= 3840 : titleSays4K;
  const isRealDebrid = /\/resolve\/realdebrid\//i.test(streamUrl ?? '');
  return (
    <div className="flex items-center gap-2">
      {is4K ? (
        <div className={BADGE_CLASS} title="Ultra High Definition">
          4K
        </div>
      ) : null}
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
      {error ? (
        <div className="rounded-full bg-red-500/20 px-3 py-1 text-xs text-red-200 backdrop-blur">
          {error}
        </div>
      ) : null}
    </div>
  );
});
