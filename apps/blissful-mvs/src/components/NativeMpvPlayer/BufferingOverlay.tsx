import { useState } from 'react';

export type BufferingOverlayProps = {
  visible: boolean;
  logo?: string | null;
};

export function BufferingOverlay({ visible, logo }: BufferingOverlayProps) {
  // Start hidden — only show after onLoad confirms the image is
  // landscape (real logo, not a poster). Prevents the initial flash.
  const [logoReady, setLogoReady] = useState(false);
  const show = visible && Boolean(logo) && logoReady;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300"
      style={{ opacity: show ? 1 : 0 }}
    >
      <div className="bliss-buffering-panel">
        {logo ? (
          <img
            className="bliss-buffering-loader"
            src={logo}
            alt=" "
            onError={() => setLogoReady(false)}
            onLoad={(e) => {
              const img = e.currentTarget;
              setLogoReady(img.naturalWidth >= img.naturalHeight);
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
