import { Image, type ImageContentFit, type ImageContentPosition, type ImageStyle } from 'expo-image';
import type { StyleProp } from 'react-native';
import { proxiedImage } from '../lib/images';

// Remote-art image with on-device caching — expo-image with cachePolicy
// 'memory-disk' (true disk persistence across cold starts; RN core <Image> only
// caches in memory and re-downloads). Routes metahub/TMDB urls through the
// backend /img edge cache first. Use for posters/backdrops/stills/logos; keep
// bundled require() assets on RN <Image>.
export function Img({
  uri,
  style,
  contentFit = 'cover',
  contentPosition,
  blurRadius,
  transition = 0,
  onLoad,
  onError,
}: {
  uri: string | null | undefined;
  style: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  /** Alignment of a `contain`/`cover` image within its box (e.g. 'left'). */
  contentPosition?: ImageContentPosition;
  /** Gaussian blur radius — used for the blurred fill behind a `contain` poster. */
  blurRadius?: number;
  /** Cross-dissolve duration (ms) when the source changes; 0 = instant (default).
   *  Keep the SAME <Img> mounted (don't change its React key) for the crossfade
   *  to actually run between the old and new image. */
  transition?: number;
  onLoad?: () => void;
  /** Fired when the image fails to load (404 / decode) — lets callers fall back. */
  onError?: () => void;
}) {
  const src = proxiedImage(uri);
  if (!src) return null;
  return (
    <Image
      source={{ uri: src }}
      style={style}
      contentFit={contentFit}
      contentPosition={contentPosition}
      blurRadius={blurRadius}
      cachePolicy="memory-disk"
      transition={transition}
      onLoad={onLoad ? () => onLoad() : undefined}
      onError={onError ? () => onError() : undefined}
    />
  );
}
