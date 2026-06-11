import { useCallback, useState, type RefObject } from 'react';

// In-page fallback mini-player frame — used only when the Document
// Picture-in-Picture API is unavailable (non-Chromium). Draggable + 8-way
// resizable 16:9 window. The host appends the persistent player's STABLE mount
// node into `contentRef`, so the <video> never remounts across the
// full ↔ mini ↔ PiP-window transitions (when Document PiP IS available the
// player is moved into a real OS window instead — see PersistentPlayerHost).
const MINI_MIN_W = 220;
const MINI_DEFAULT_W = 360;
const ASPECT = 9 / 16;

// No fixed upper cap on the in-page window — you can grow it right up to the
// viewport (16:9 must still fit, so the limit is whichever of width/height the
// screen runs out of first). The real Document-PiP OS window has no app cap at
// all; the OS handles its sizing.
function maxWidth() {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
  return Math.max(MINI_MIN_W, Math.min(vw - 16, Math.floor((vh - 16) / ASPECT)));
}

type Dir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

// Edge/corner handles. Edges are thin strips between the corners; corners are
// small squares. Inset from the very ends so they don't fight each other.
const HANDLES: { dir: Dir; cls: string }[] = [
  { dir: 'n', cls: 'left-6 right-6 top-0 h-2.5 cursor-ns-resize' },
  { dir: 's', cls: 'left-6 right-6 bottom-0 h-2.5 cursor-ns-resize' },
  { dir: 'w', cls: 'top-6 bottom-6 left-0 w-2.5 cursor-ew-resize' },
  { dir: 'e', cls: 'top-6 bottom-6 right-0 w-2.5 cursor-ew-resize' },
  { dir: 'nw', cls: 'top-0 left-0 h-6 w-6 cursor-nwse-resize' },
  { dir: 'ne', cls: 'top-0 right-0 h-6 w-6 cursor-nesw-resize' },
  { dir: 'sw', cls: 'bottom-0 left-0 h-6 w-6 cursor-nesw-resize' },
  { dir: 'se', cls: 'bottom-0 right-0 h-6 w-6 cursor-nwse-resize' },
];

export function MiniPlayerWindow({ contentRef }: { contentRef: RefObject<HTMLDivElement | null> }) {
  const [box, setBox] = useState<{ x: number; y: number; w: number } | null>(null);

  const resolveRect = useCallback(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 720;
    const w = Math.min(maxWidth(), Math.max(MINI_MIN_W, box?.w ?? MINI_DEFAULT_W));
    const h = Math.round(w * ASPECT);
    const x = Math.min(Math.max(8, box?.x ?? vw - w - 16), Math.max(8, vw - w - 8));
    const y = Math.min(Math.max(8, box?.y ?? vh - h - 88), Math.max(8, vh - h - 8));
    return { left: x, top: y, width: w, height: h };
  }, [box]);

  // Kill page text-selection for the duration of a drag/resize, restore after.
  const beginGesture = useCallback((cursor: string, onMove: (ev: PointerEvent) => void) => {
    const prevSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = cursor;
    const onUp = () => {
      document.body.style.userSelect = prevSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

  const startDrag = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = resolveRect();
    const sx = e.clientX;
    const sy = e.clientY;
    beginGesture('grabbing', (ev) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const nx = Math.min(Math.max(8, rect.left + ev.clientX - sx), Math.max(8, vw - rect.width - 8));
      const ny = Math.min(Math.max(8, rect.top + ev.clientY - sy), Math.max(8, vh - rect.height - 8));
      setBox({ x: nx, y: ny, w: rect.width });
    });
  }, [resolveRect, beginGesture]);

  const startResize = useCallback((dir: Dir, cursor: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = resolveRect();
    const right = rect.left + rect.width;
    const bottom = rect.top + rect.height;
    const sx = e.clientX;
    const sy = e.clientY;
    beginGesture(cursor, (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      // New width derives from the dragged axis (height follows, 16:9).
      let w: number;
      if (dir.includes('e')) w = rect.width + dx;
      else if (dir.includes('w')) w = rect.width - dx;
      else if (dir === 'n') w = (rect.height - dy) / ASPECT;
      else w = (rect.height + dy) / ASPECT; // 's'
      w = Math.min(maxWidth(), Math.max(MINI_MIN_W, w));
      const h = Math.round(w * ASPECT);
      // Anchor the opposite side (so the handle you grabbed is the one moving).
      const x = dir.includes('w') ? right - w : rect.left;
      const y = dir.includes('n') ? bottom - h : rect.top;
      setBox({ x: Math.max(8, x), y: Math.max(8, y), w });
    });
  }, [resolveRect, beginGesture]);

  const rect = resolveRect();

  return (
    <div
      className="fixed z-[60] cursor-grab touch-none select-none overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_12px_40px_-8px_rgba(0,0,0,0.7)] active:cursor-grabbing"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      onPointerDown={startDrag}
    >
      {/* The persistent player's stable mount node is appended here by the host.
          `isolate` makes it its own stacking context so the player's internal
          z-indexes (controls, overlays) can't paint over the resize handles. */}
      <div ref={contentRef} className="absolute inset-0 isolate" />
      {HANDLES.map(({ dir, cls }) => (
        <div
          key={dir}
          className={`absolute z-40 touch-none pointer-events-auto ${cls}`}
          onPointerDown={startResize(dir, cls.includes('ns') ? 'ns-resize' : cls.includes('ew') ? 'ew-resize' : cls.includes('nwse') ? 'nwse-resize' : 'nesw-resize')}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
