import { lazy, Suspense, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMiniPlayer } from '../context/MiniPlayerProvider';
import { MiniPlayerWindow } from './MiniPlayerWindow';

// The player is hoisted out of the /player route into one persistent instance so
// it survives navigation. Lazy so the heavy player chunk only loads once a
// session actually starts.
const PersistentPlayerPage = lazy(() => import('../pages/PlayerPage'));

// Owns the persistent player. A single stable DOM node (`mountEl`) always holds
// the player; only its PARENT is reparented — full-screen host, the real PiP
// window's body (Document PiP), or the in-page fallback frame. Because the
// portal target never changes, React never remounts the subtree, so the
// <video> + HLS instance keep playing across every transition. The PiP window
// itself is opened/closed by the provider (it needs the click gesture); here we
// only follow `pipWindow`.
export function PersistentPlayerHost() {
  const { mode, pipWindow } = useMiniPlayer();

  const mountRef = useRef<HTMLDivElement | null>(null);
  if (mountRef.current === null && typeof document !== 'undefined') {
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;';
    mountRef.current = el;
  }

  const fullHostRef = useRef<HTMLDivElement | null>(null);
  const miniHostRef = useRef<HTMLDivElement | null>(null);

  // Reparent the stable mount node into the active host. Layout effect so the
  // move happens before paint (no flicker).
  useLayoutEffect(() => {
    const el = mountRef.current;
    if (!el || !mode) return;
    const target =
      mode === 'full'
        ? fullHostRef.current
        : pipWindow
          ? pipWindow.document.body
          : miniHostRef.current;
    if (target && el.parentNode !== target) target.appendChild(el);
  }, [mode, pipWindow]);

  if (!mode) return null;

  return (
    <>
      {createPortal(
        <Suspense fallback={null}>
          <PersistentPlayerPage />
        </Suspense>,
        mountRef.current!,
      )}
      {mode === 'full' ? <div ref={fullHostRef} className="fixed inset-0 z-50 bg-black" /> : null}
      {mode === 'mini' && !pipWindow ? <MiniPlayerWindow contentRef={miniHostRef} /> : null}
    </>
  );
}
