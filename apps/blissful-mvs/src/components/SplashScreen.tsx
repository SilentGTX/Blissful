import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const SPLASH_DURATION = 1800;

// Use a module-level flag so the splash shows on every fresh page load
// (including hard refresh) but not on React re-renders or hot reloads.
let splashShown = false;

export function SplashScreen({ children }: { children: React.ReactNode }) {
  const [show, setShow] = useState(() => {
    if (splashShown) return false;
    splashShown = true;
    return true;
  });

  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => {
      setShow(false);
    }, SPLASH_DURATION);
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
            {/* Ambient glow behind the logo */}
            <motion.div
              className="absolute rounded-full blur-[120px]"
              style={{
                width: 400,
                height: 400,
                background: 'radial-gradient(circle, rgba(25,247,210,0.15) 0%, transparent 70%)',
              }}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1.2, opacity: 1 }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
            />

            <div className="relative flex flex-col items-center">
              {/* Logo image */}
              <motion.img
                src="/blissful-logo-v2.png"
                alt="Blissful"
                className="w-[min(90vw,700px)] drop-shadow-[0_0_60px_rgba(25,247,210,0.3)]"
                initial={{ scale: 0.85, opacity: 0, y: 12 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              />

              {/* Shimmer bar */}
              <motion.div
                className="mt-6 h-[2px] rounded-full"
                style={{
                  background: 'linear-gradient(90deg, transparent, #19f7d2, transparent)',
                }}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 120, opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.7, ease: 'easeOut' }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Always render children so the app loads behind the splash */}
      {children}
    </>
  );
}
