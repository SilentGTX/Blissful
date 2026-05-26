import { useEffect, useRef, useState } from 'react';

const SCRAMBLE_POOL = '!<>-_\\/[]{}—=+*^?#@$%&░▒▓0123456789ABCDEFXY';

export type GlitchTextOptions = {
  /** Total animation duration in ms. Default 400. */
  total?: number;
  /** How long each char spends scrambling, as a fraction of `total`. Default 0.4. */
  charLock?: number;
  /** Max probability a scrambling char is "dropped" (rendered as nothing) — early frames only. Default 0.6. */
  maxDropChance?: number;
};

/**
 * Drive a character-scramble / random reveal animation on a string.
 * Returns the current display string, which equals `text` when
 * `active` is false. While `active` is true, the string animates from
 * scrambled glyphs to the real text — each char locking at a random
 * point in the timeline so the reveal isn't strictly left-to-right.
 */
export function useGlitchText(
  text: string,
  active: boolean,
  options: GlitchTextOptions = {}
): string {
  const { total = 400, charLock = 0.4, maxDropChance = 0.6 } = options;
  const [out, setOut] = useState(text);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const scheduleRef = useRef<Array<[number, number]>>([]);

  useEffect(() => {
    if (!active) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setOut(text);
      return;
    }
    startRef.current = performance.now();
    scheduleRef.current = Array.from({ length: text.length }, () => {
      const start = Math.random() * (1 - charLock);
      return [start, start + charLock] as [number, number];
    });

    const tick = () => {
      const t = performance.now() - startRef.current;
      const progress = Math.min(1, t / total);
      let next = '';
      for (let i = 0; i < text.length; i++) {
        if (text[i] === ' ') {
          next += ' ';
          continue;
        }
        const [lockStart, lockEnd] = scheduleRef.current[i] ?? [0, 1];
        if (progress >= lockEnd) {
          next += text[i];
          continue;
        }
        const localProgress = progress < lockStart
          ? 0
          : (progress - lockStart) / (lockEnd - lockStart);
        const dropChance = maxDropChance * (1 - localProgress);
        if (Math.random() < dropChance) continue;
        next += SCRAMBLE_POOL[Math.floor(Math.random() * SCRAMBLE_POOL.length)];
      }
      setOut(next);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setOut(text);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, text, total, charLock, maxDropChance]);

  return out;
}
