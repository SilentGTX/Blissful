// Top-right badge cluster on the player: source name, 4K, HDR, RD.
//
// Source detection: extracts the addon/service name from the stream URL
// so the user knows which torrent provider is serving the current file.

import React from 'react';
import { BlissTooltip } from '../BlissTooltip';

export type PlayerHdrBadgesProps = {
  videoGamma: string | null;
  videoDwidth: number | null;
  streamTitle: string | null;
  streamUrl: string | null;
  error: string | null;
};

const BADGE_CLASS =
  'rounded-md border border-white/15 bg-black/45 px-2 py-1 text-[10px] font-bold tracking-wider text-white/80 backdrop-blur';

// Full names for the short source codes, shown in the badge tooltip.
const SOURCE_LABELS: Record<string, string> = {
  RD: 'Real-Debrid',
  'TPB+': 'ThePirateBay+',
  AD: 'AllDebrid',
  PM: 'Premiumize',
  Local: 'Local stream',
};

// Resolution badge label, derived from mpv's actual decoded width
// (`videoDwidth`, the reliable source) with the stream title as fallback
// before the dimensions are known. Buckets by standard width thresholds.
function resolutionLabel(
  dwidth: number | null,
  title: string | null,
): { short: string; full: string } | null {
  if (dwidth !== null && dwidth > 0) {
    if (dwidth >= 3840) return { short: '4K', full: 'Ultra HD · 2160p' };
    if (dwidth >= 2560) return { short: '1440p', full: 'Quad HD · 1440p' };
    if (dwidth >= 1920) return { short: '1080p', full: 'Full HD · 1080p' };
    if (dwidth >= 1280) return { short: '720p', full: 'HD · 720p' };
    if (dwidth >= 640) return { short: '480p', full: 'SD · 480p' };
    return { short: 'SD', full: 'Standard definition' };
  }
  const t = title ?? '';
  if (/\b(?:2160p|4k|uhd)\b/i.test(t)) return { short: '4K', full: 'Ultra HD · 2160p' };
  if (/\b1440p\b/i.test(t)) return { short: '1440p', full: 'Quad HD · 1440p' };
  if (/\b1080p\b/i.test(t)) return { short: '1080p', full: 'Full HD · 1080p' };
  if (/\b720p\b/i.test(t)) return { short: '720p', full: 'HD · 720p' };
  if (/\b(?:480p|sd)\b/i.test(t)) return { short: '480p', full: 'SD · 480p' };
  return null;
}

function detectSource(url: string | null): string | null {
  if (!url) return null;
  if (/\/resolve\/realdebrid\//i.test(url)) return 'RD';
  if (/torrentio\.strem\.fun/i.test(url)) return 'Torrentio';
  if (/thepiratebay.*strem/i.test(url)) return 'TPB+';
  if (/comet\.elfhosted/i.test(url)) return 'Comet';
  if (/mediafusion\.elfhosted/i.test(url)) return 'MediaFusion';
  if (/debridio/i.test(url)) return 'Debridio';
  if (/alldebrid/i.test(url)) return 'AD';
  if (/premiumize/i.test(url)) return 'PM';
  if (/127\.0\.0\.1:11470/i.test(url)) return 'Local';
  return null;
}

export const PlayerHdrBadges = React.memo(function PlayerHdrBadges({
  videoGamma,
  videoDwidth,
  streamTitle,
  streamUrl,
  error,
}: PlayerHdrBadgesProps) {
  const isHdr = videoGamma === 'pq' || videoGamma === 'hlg';
  const resolution = resolutionLabel(videoDwidth, streamTitle);
  const source = detectSource(streamUrl);
  return (
    <div className="flex items-center gap-2">
      {source ? (
        <BlissTooltip
          content={SOURCE_LABELS[source] ?? source}
          placement="bottom"
          triggerClassName={BADGE_CLASS}
        >
          {source}
        </BlissTooltip>
      ) : null}
      {resolution ? (
        <BlissTooltip content={resolution.full} placement="bottom" triggerClassName={BADGE_CLASS}>
          {resolution.short}
        </BlissTooltip>
      ) : null}
      {isHdr ? (
        <BlissTooltip
          content={videoGamma === 'pq' ? 'HDR10' : 'HLG'}
          placement="bottom"
          triggerClassName={BADGE_CLASS}
        >
          HDR
        </BlissTooltip>
      ) : null}
      {error ? (
        <div className="rounded-full bg-red-500/20 px-3 py-1 text-xs text-red-200 backdrop-blur">
          {error}
        </div>
      ) : null}
    </div>
  );
});
