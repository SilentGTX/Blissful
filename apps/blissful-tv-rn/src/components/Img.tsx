import { Image, type ImageContentFit, type ImageStyle } from 'expo-image';
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
}: {
  uri: string | null | undefined;
  style: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
}) {
  const src = proxiedImage(uri);
  if (!src) return null;
  return (
    <Image
      source={{ uri: src }}
      style={style}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      transition={0}
    />
  );
}
