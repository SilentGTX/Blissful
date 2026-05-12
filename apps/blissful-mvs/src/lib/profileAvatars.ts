import avatar1 from '../../avatar_1.png';
import avatar2 from '../../avatar_2.png';
import avatar3 from '../../avatar_3.png';
import avatar4 from '../../avatar_4.png';
import avatar5 from '../../avatar_5.png';
import avatar6 from '../../avatar_6.png';
import avatar7 from '../../avatar_7.png';
import avatar8 from '../../avatar_8.png';

export const PRESET_PROFILE_AVATARS = [
  avatar1,
  avatar2,
  avatar3,
  avatar4,
  avatar5,
  avatar6,
  avatar7,
  avatar8,
];

const IMAGE_EXT_RE = /\.(png|jpe?g|jfif|webp|avif|gif|svg)(\?.*)?$/i;
// Vite-built preset asset URLs look like `/assets/avatar_3-DTzPlmCT.png`.
// The hash changes on every rebuild, so stored URLs from prior builds 404
// when the file gets re-emitted under a new hash. We rescue these by
// matching the base filename (`avatar_N`) and resolving to the current
// build's hashed URL via PRESET_PROFILE_AVATARS (the imports refresh
// the hash on every build).
const PRESET_ASSET_RE = /(?:^|\/)avatar_([1-8])(?:-[A-Za-z0-9_-]+)?\.png(?:\?.*)?$/i;

function resolvePresetAvatar(avatar: string): string | null {
  const m = PRESET_ASSET_RE.exec(avatar);
  if (!m) return null;
  const idx = Number.parseInt(m[1], 10);
  if (!Number.isInteger(idx) || idx < 1 || idx > PRESET_PROFILE_AVATARS.length) return null;
  return PRESET_PROFILE_AVATARS[idx - 1];
}

export function renderProfileAvatar(avatar: string | undefined, fallback: string) {
  if (avatar) {
    // Remap stale preset URLs to the current build's hashed URL first
    // so the avatar survives Vite rebuilds. Falls through to as-is for
    // anything that isn't a preset (data URIs, custom uploads, etc.).
    const remapped = resolvePresetAvatar(avatar);
    if (remapped) {
      return { kind: 'image' as const, value: remapped };
    }
    if (avatar.startsWith('data:image/') || IMAGE_EXT_RE.test(avatar)) {
      return { kind: 'image' as const, value: avatar };
    }
    if (avatar.trim().length > 0) {
      return { kind: 'emoji' as const, value: avatar };
    }
  }

  return {
    kind: 'emoji' as const,
    value: fallback,
  };
}
