import { useCallback, useEffect, useRef, useState } from 'react';

type ScrubSeekArgs = {
  videoRef: { current: HTMLVideoElement | null };
  currentTime: number;
  duration: number;
  setCurrentTime: (t: number) => void;
  onUserSeek?: (t: number) => void;
};

// Shared seek-bar behaviour for the full and mini controls: dragging only
// previews the position; ONE real seek (and one watch-party broadcast) is
// committed on release. After release the thumb stays on the committed value
// until the element reports `seeked`, so it cannot snap back to the old
// playhead while the seek is in flight.
export function useScrubSeek(args: ScrubSeekArgs) {
  const { currentTime, duration } = args;
  const latest = useRef(args);
  latest.current = args;

  const [dragValue, setDragValue] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const stopDragRef = useRef<(() => void) | null>(null);
  const stopHoldRef = useRef<(() => void) | null>(null);

  const commit = useCallback((t: number) => {
    const { videoRef, setCurrentTime, onUserSeek } = latest.current;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = t;
    setCurrentTime(t);
    onUserSeek?.(t);
  }, []);

  const holdUntilSeeked = useCallback((t: number) => {
    stopHoldRef.current?.();
    const video = latest.current.videoRef.current;
    setDragValue(t);
    if (!video) {
      setDragValue(null);
      return;
    }
    let timer: number | undefined;
    const stop = () => {
      video.removeEventListener('seeked', done);
      window.clearTimeout(timer);
      stopHoldRef.current = null;
    };
    const done = () => {
      stop();
      setDragValue(null);
    };
    video.addEventListener('seeked', done);
    // A seek that never completes must not pin the thumb forever.
    timer = window.setTimeout(done, 5000);
    stopHoldRef.current = stop;
  }, []);

  useEffect(
    () => () => {
      stopDragRef.current?.();
      stopHoldRef.current?.();
    },
    []
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLInputElement>) => {
      const el = event.currentTarget;
      stopDragRef.current?.();
      stopHoldRef.current?.();
      const start = Math.min(currentTime, duration || 0);
      draggingRef.current = true;
      setDragValue(start);

      // Listen on window so a release outside the slider still commits.
      const finish = () => {
        stopDragRef.current?.();
        const v = Number.parseFloat(el.value);
        if (Number.isFinite(v) && Math.abs(v - start) > 0.001) {
          commit(v);
          holdUntilSeeked(v);
        } else {
          setDragValue(null);
        }
      };
      const stopDrag = () => {
        draggingRef.current = false;
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        stopDragRef.current = null;
      };
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
      stopDragRef.current = stopDrag;
    },
    [currentTime, duration, commit, holdUntilSeeked]
  );

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = Number.parseFloat(event.target.value);
      if (!Number.isFinite(next)) return;
      if (draggingRef.current) {
        setDragValue(next);
        return;
      }
      // Keyboard on the focused slider (or an assistive-tech set): no drag,
      // so this is already a single discrete seek.
      commit(next);
      holdUntilSeeked(next);
    },
    [commit, holdUntilSeeked]
  );

  const isScrubbing = dragValue !== null;
  const displayedValue = isScrubbing ? dragValue : Math.min(currentTime, duration || 0);

  return { isScrubbing, displayedValue, onPointerDown, onChange };
}
