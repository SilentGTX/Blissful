import { useNavigate, useSearchParams } from 'react-router-dom';
import { proxiedImage } from '../lib/imageProxy';

// Eagerly-loaded buffering screen for /player. Rendered both as the
// Suspense fallback (while the lazy PlayerPage chunk is still
// downloading) and as PlayerPage's own pre-TMDB wait state, and on
// desktop while NativeMpvPlayer does its (non-instant) mount. Because
// it's not part of the lazy chunk, it can paint the *instant* the
// route changes — no "black gap before the logo appears".
//
// Mirrors BlissfulPlayer's in-player buffering UI so the swap from this
// placeholder → the player is visually seamless: same black backdrop,
// same logo-on-top with the pulsing `bliss-buffer-fade` animation, and
// a back pill in the same top-left spot as the player's TopOverlay — so
// the user can bail out of a slow load without waiting for the player to
// finish mounting, and the pill doesn't jump when the player takes over.
export function PlayerBufferingScreen() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // Logo only — no fallbacks. Titles without a meta logo just paint
  // a clean black backdrop until the player takes over.
  const displayLogo = searchParams.get('logo');
  const title = searchParams.get('metaTitle') ?? searchParams.get('title') ?? null;
  const onBack = () => {
    // Same "safe back" target the rest of the app uses (never another
    // player/detail route); falls back to home.
    const safe = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('bliss:safe-back') : null;
    navigate(safe ?? '/', { replace: true });
  };
  return (
    // Very high z-index so this screen sits above the player (z-50) while
    // it mounts; the player reveals underneath once it flips `playerReady`.
    <div className="fixed inset-0 z-[9999] bg-black">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="absolute left-6 top-5 z-10 flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-foreground/90 backdrop-blur-md transition-colors hover:bg-white/15"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        {title ? <span className="max-w-[40vw] truncate text-sm font-semibold">{title}</span> : null}
      </button>
      {displayLogo ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          {/* `loading="eager"` + `fetchpriority="high"` so the browser
              prioritises this image immediately. Same URL DetailPage / the
              entry preload already warmed, so it's usually a cache hit. */}
          <div className="bliss-buffering-panel">
            <img
              className="bliss-buffering-loader"
              src={proxiedImage(displayLogo)}
              alt=" "
              loading="eager"
              fetchPriority="high"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
