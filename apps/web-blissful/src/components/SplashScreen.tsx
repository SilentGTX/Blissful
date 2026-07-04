import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// One full play of /blissful.gif is 1890 ms (27 frames, measured from the
// file's frame delays), but we deliberately dismiss at 800 ms — the tail of
// the loop is not worth holding the app for. The gif loops forever either way.
const GIF_DURATION = 800;
// If the gif never loads (offline, bad cache), don't hold the app hostage.
const FALLBACK_TIMEOUT = 8000;

// Use a module-level flag so the splash shows on every fresh page load
// (including hard refresh) but not on React re-renders or hot reloads.
let splashShown = false;

export function SplashScreen({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(() => {
    // A background auto-reload (SW upgrade after a deploy / stale-chunk
    // recovery, flagged by main.tsx) is not a fresh open or visit, so skip
    // the splash for that one reload — re-playing the full-screen logo on
    // every deploy is jarring mid-session.
    try {
      if (sessionStorage.getItem('bliss:auto-reload')) {
        sessionStorage.removeItem('bliss:auto-reload');
        splashShown = true;
        return false;
      }
    } catch { /* sessionStorage unavailable — fall through to normal splash */ }
    if (splashShown) return false;
    splashShown = true;
    return true;
  });

  const [gifLoaded, setGifLoaded] = useState(false);
  // Backdrop for the gif's letterbox. The gif export quantizes/dithers its
  // background, so no hardcoded color reliably matches — sample the loaded
  // frame's edges instead. #070321 is only the pre-load fallback.
  const [backdrop, setBackdrop] = useState('#070321');

  const handleGifLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    try {
      const W = 24, H = 16;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, W, H);
        const data = ctx.getImageData(0, 0, W, H).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            // Average only the border ring; the interior holds the logo.
            if (x > 1 && x < W - 2 && y > 1 && y < H - 2) continue;
            const i = (y * W + x) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
          }
        }
        setBackdrop(`rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
      }
    } catch { /* canvas unavailable — keep the fallback color */ }
    setGifLoaded(true);
  };

  // Only start counting once the gif has loaded, so the full animation always
  // plays through even on a slow first fetch (it's ~5 MB).
  useEffect(() => {
    if (!show || !gifLoaded) return;
    const timer = setTimeout(() => {
      setShow(false);
    }, GIF_DURATION);
    return () => clearTimeout(timer);
  }, [show, gifLoaded]);

  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => {
      setShow(false);
    }, FALLBACK_TIMEOUT);
    return () => clearTimeout(timer);
  }, [show]);

  return (
    <>
      <AnimatePresence>
        {show && (
          <motion.div
            key="splash"
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            style={{ background: backdrop }}
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          >
            {/* Letterboxed animated GIF. The gif's background is close to the
                backdrop but not identical (palette + vignette), so feather its
                edges with a mask instead of chasing an exact color match. */}
            <motion.img
              src="/blissful.gif"
              alt="Blissful"
              className="max-h-full max-w-full"
              style={{
                WebkitMaskImage:
                  'linear-gradient(to right, transparent, black 6%, black 94%, transparent), linear-gradient(to bottom, transparent, black 6%, black 94%, transparent)',
                WebkitMaskComposite: 'source-in',
                maskImage:
                  'linear-gradient(to right, transparent, black 6%, black 94%, transparent), linear-gradient(to bottom, transparent, black 6%, black 94%, transparent)',
                maskComposite: 'intersect',
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              onLoad={handleGifLoad}
              onError={() => setShow(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Always render children so the app loads behind the splash */}
      {children}
    </>
  );
}
