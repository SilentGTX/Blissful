import type { ImageSourcePropType } from 'react-native';

// 8 preset avatars (same images as the web app's PRESET_PROFILE_AVATARS).
export const PRESET_AVATARS: ImageSourcePropType[] = [
  require('../../assets/avatar_1.png'),
  require('../../assets/avatar_2.png'),
  require('../../assets/avatar_3.png'),
  require('../../assets/avatar_4.png'),
  require('../../assets/avatar_5.png'),
  require('../../assets/avatar_6.png'),
  require('../../assets/avatar_7.png'),
  require('../../assets/avatar_8.png'),
];

const IMG_EXT = /\.(png|jpe?g|jfif|webp|avif|gif|svg)(\?|$)/i;
// matches the web's preset id inside a stored value like "/assets/avatar_3-HASH.png"
const PRESET_RE = /avatar[_-]?(\d{1,2})/i;

export type ResolvedAvatar =
  | { kind: 'image'; source: ImageSourcePropType }
  | { kind: 'text'; value: string };

// Mirror web renderProfileAvatar: preset id -> bundled image; data-uri / http(s)
// image url -> remote image; short non-path string -> emoji; else the initial.
export function resolveAvatar(avatar: string | null | undefined, fallbackInitial: string): ResolvedAvatar {
  if (avatar && avatar.trim()) {
    const v = avatar.trim();
    const preset = PRESET_RE.exec(v);
    if (preset) {
      const idx = parseInt(preset[1], 10) - 1;
      if (idx >= 0 && idx < PRESET_AVATARS.length) return { kind: 'image', source: PRESET_AVATARS[idx] };
    }
    if (v.startsWith('data:image/') || (/^https?:\/\//i.test(v) && IMG_EXT.test(v))) {
      return { kind: 'image', source: { uri: v } };
    }
    // an emoji / short label (not a path or url)
    if (!v.startsWith('/') && !/^https?:/i.test(v) && [...v].length <= 3) {
      return { kind: 'text', value: v };
    }
  }
  return { kind: 'text', value: fallbackInitial };
}
