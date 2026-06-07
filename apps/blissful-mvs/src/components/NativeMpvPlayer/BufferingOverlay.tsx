import { useState } from 'react';

export type BufferingOverlayProps = {
  visible: boolean;
  logo?: string | null;
};

export function BufferingOverlay({ visible, logo }: BufferingOverlayProps) {
  // Start hidden — only show the LOGO after onLoad confirms the image is
  // landscape (real logo, not a poster). Prevents the initial flash.
  const [logoReady, setLogoReady] = useState(false);
  // Logo path shows once the image loads; otherwise (no logo, or it failed /
  // is portrait) fall back to a spinner so a buffering load never leaves a
  // blank black screen — e.g. switching releases on a title with no meta
  // logo ("From"). The overlay is visible whenever `buffering` is true.
  const showLogo = visible && Boolean(logo) && logoReady;
  const showSpinner = visible && !showLogo;
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div className="bliss-buffering-panel">
        {logo ? (
          <img
            className="bliss-buffering-loader"
            src={logo}
            alt=" "
            style={{ display: showLogo ? 'block' : 'none' }}
            onError={() => setLogoReady(false)}
            onLoad={(e) => {
              const img = e.currentTarget;
              setLogoReady(img.naturalWidth >= img.naturalHeight);
            }}
          />
        ) : null}
        {showSpinner ? <div className="bliss-buffering-fallback" aria-label="Loading" /> : null}
      </div>
    </div>
  );
}
