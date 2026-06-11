/**
 * Runtime browser codec detection via canPlayType().
 * Probed once at import time, results cached for the session.
 */

type CanPlayResult = '' | 'maybe' | 'probably';

const probe = (type: string): boolean => {
  if (typeof document === 'undefined') return false;
  try {
    const v = document.createElement('video');
    const r: CanPlayResult = v.canPlayType(type) as CanPlayResult;
    return r === 'probably' || r === 'maybe';
  } catch {
    return false;
  }
};

export const codecSupport = {
  // Video codecs
  h264: probe('video/mp4; codecs="avc1.640028"'),
  hevc: probe('video/mp4; codecs="hev1.1.6.L93.B0"') || probe('video/mp4; codecs="hvc1.1.6.L93.B0"'),
  av1: probe('video/mp4; codecs="av01.0.08M.08"'),

  // Audio codecs
  aac: probe('audio/mp4; codecs="mp4a.40.2"'),
  ac3: probe('audio/mp4; codecs="ac-3"'),
  eac3: probe('audio/mp4; codecs="ec-3"'),
  flac: probe('audio/ogg; codecs="flac"') || probe('audio/flac'),
  opus: probe('audio/ogg; codecs="opus"') || probe('audio/webm; codecs="opus"'),

  // Containers
  mkv: probe('video/x-matroska') || probe('video/x-matroska; codecs="avc1.640028"'),
  hlsNative: probe('application/vnd.apple.mpegurl') || probe('application/x-mpegURL'),
} as const;

export type AudioCodecTag = 'aac' | 'ac3' | 'eac3' | 'dts' | 'truehd' | 'atmos' | 'flac' | 'opus' | 'unknown';
export type VideoCodecTag = 'h264' | 'hevc' | 'av1' | 'unknown';

const audioSupportMap: Record<AudioCodecTag, boolean> = {
  aac: codecSupport.aac,
  ac3: codecSupport.ac3,
  eac3: codecSupport.eac3,
  dts: false, // no browser supports DTS
  truehd: false, // no browser supports TrueHD
  atmos: false, // Atmos over TrueHD/EAC3 — treat as unsupported
  flac: codecSupport.flac,
  opus: codecSupport.opus,
  unknown: true, // if we can't detect the codec, assume playable
};

const videoSupportMap: Record<VideoCodecTag, boolean> = {
  h264: codecSupport.h264,
  hevc: codecSupport.hevc,
  av1: codecSupport.av1,
  unknown: true, // if we can't detect the codec, assume playable
};

export function isAudioCodecSupported(tag: AudioCodecTag): boolean {
  return audioSupportMap[tag];
}

export function isVideoCodecSupported(tag: VideoCodecTag): boolean {
  return videoSupportMap[tag];
}
