import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// One full play of /blissful.gif is 4480 ms (56 frames, measured from the
// file's frame delays), but we deliberately dismiss at 3300 ms — the tail of
// the loop is not worth holding the app for. The gif loops forever either way.
const GIF_DURATION = 3300;
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
            style={{ background: '#060a10' }}
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          >
            {/* Full-bleed animated GIF */}
            <motion.img
              src="/blissful.gif"
              alt="Blissful"
              className="absolute inset-0 h-full w-full object-cover"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              onLoad={() => setGifLoaded(true)}
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
