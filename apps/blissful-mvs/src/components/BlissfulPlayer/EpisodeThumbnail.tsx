// Episode card thumbnail with on-load-error fallback. Cinemeta
// cheerfully returns metahub URLs for future episodes that don't
// have artwork yet (e.g. `episodes.metahub.space/.../w780.jpg`
// → 404), so CSS background-image just shows nothing. By using
// <img> we get an `onError` hook that lets us swap to the show
// poster — same source the Resume/Start-Over modal uses.

import { useState } from 'react';

import { proxiedImage } from '../../lib/imageProxy';

export function EpisodeThumbnail({
  thumbnail,
  fallback,
}: {
  thumbnail: string | null | undefined;
  fallback: string | null | undefined;
}) {
  const [failed, setFailed] = useState(false);
  const src = !failed && thumbnail ? thumbnail : fallback || null;
  if (!src) {
    return (
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(135deg,#1a1f2b,#2a3142)' }}
      />
    );
  }
  return (
    <img
      src={proxiedImage(src)}
      alt=""
      className="absolute inset-0 h-full w-full object-cover"
      loading="lazy"
      decoding="async"
      onError={() => {
        if (!failed) setFailed(true);
      }}
    />
  );
}
