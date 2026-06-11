// Native HTMLMediaElement audio-track helpers. TypeScript's lib.dom
// doesn't include the optional `video.audioTracks` API at all
// (Safari, Firefox, Chromium-with-flag), so we shadow it here with a
// minimal structural type + accessors. Used by BlissfulPlayer to
// surface multi-audio MKVs in the bottom-bar's Audio menu.

export type HlsAudioTrack = {
  id: number;
  name?: string;
  lang?: string;
};

export type NativeAudioTrack = {
  id?: string;
  label?: string;
  language?: string;
  enabled?: boolean;
};

export type NativeAudioTrackList = {
  length: number;
  [index: number]: NativeAudioTrack;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
};

export type PlayerAudioTrack = {
  kind: 'hls' | 'native';
  index: number;
  id: string;
  label: string;
};

export function getNativeAudioTracks(video: HTMLVideoElement | null): NativeAudioTrackList | null {
  if (!video) return null;
  return ((video as unknown as { audioTracks?: NativeAudioTrackList }).audioTracks) ?? null;
}

export function readNativeAudioTracks(video: HTMLVideoElement | null): PlayerAudioTrack[] {
  const tracks = getNativeAudioTracks(video);
  if (!tracks || tracks.length === 0) return [];
  return Array.from({ length: tracks.length }, (_, index) => {
    const track = tracks[index];
    const label = track.label || track.language || `Track ${index + 1}`;
    return {
      kind: 'native',
      index,
      id: `native:${track.id || index}`,
      label,
    };
  });
}

export function getSelectedNativeAudioTrackId(video: HTMLVideoElement | null): string | null {
  const tracks = getNativeAudioTracks(video);
  if (!tracks || tracks.length === 0) return null;
  for (let index = 0; index < tracks.length; index += 1) {
    if (tracks[index]?.enabled) return `native:${tracks[index]?.id || index}`;
  }
  return 'native:0';
}
