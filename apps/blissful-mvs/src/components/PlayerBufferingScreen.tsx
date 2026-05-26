import { useSearchParams } from 'react-router-dom';

// Eagerly-loaded buffering screen for /player. Rendered both as the
// Suspense fallback (while the lazy PlayerPage chunk is still
// downloading) and as PlayerPage's own pre-TMDB wait state. Because
// it's not part of the lazy chunk, it can paint the *instant* the
// route changes — no 400 ms "black gap before the logo appears" while
// the chunk lands.
//
// Mirrors BlissfulPlayer's in-player buffering UI so the swap from this
// placeholder → BlissfulPlayer is visually seamless: same black backdrop,
// same logo-on-top with the pulsing `bliss-buffer-fade` animation.
export function PlayerBufferingScreen() {
  const [searchParams] = useSearchParams();
  // Logo only — no poster fallback. A vertical poster painted at logo
  // dimensions looks like the wrong image was loaded; titles without
  // a meta logo fall through to the "Buffering" text instead.
  const displayLogo = searchParams.get('logo');
  return (
    // Very high z-index so this screen sits above BlissfulPlayer
    // (z-50, nested inside the AnimatePresence motion.div whose
    // stacking context could otherwise trap BlissfulPlayer's z-50
    // beneath this at z-40). With z-[9999], BlissfulPlayer mounts and
    // fully renders BEHIND the buffer screen — when BlissfulPlayer's
    // first frame paints, the buffer screen unmounts and reveals the
    // fully-rendered player underneath instantly, no black gap.
    <div className="fixed inset-0 z-[9999] bg-black">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="bliss-buffering-panel">
          {displayLogo ? (
            // `loading="eager"` + `fetchpriority="high"` so the browser
            // prioritises this image immediately, rather than treating
            // it like a deferred-priority asset. The URL is the same as
            // the one DetailPage already rendered so the cache should
            // hit, but the priority hint still helps on cold loads.
            <img
              className="bliss-buffering-loader"
              src={displayLogo}
              alt=" "
              loading="eager"
              fetchPriority="high"
            />
          ) : (
            <div className="bliss-buffering-fallback">Buffering</div>
          )}
        </div>
      </div>
    </div>
  );
}
