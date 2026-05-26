import { useState } from 'react';

export type BufferingOverlayProps = {
  visible: boolean;
  logo?: string | null;
};

export function BufferingOverlay({ visible, logo }: BufferingOverlayProps) {
  const [logoOk, setLogoOk] = useState(true);
  if (!visible) return null;
  if (!logo || !logoOk) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="bliss-buffering-panel">
        <img
          className="bliss-buffering-loader"
          src={logo}
          alt=" "
          onError={() => setLogoOk(false)}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalHeight > img.naturalWidth) setLogoOk(false);
          }}
        />
      </div>
    </div>
  );
}
