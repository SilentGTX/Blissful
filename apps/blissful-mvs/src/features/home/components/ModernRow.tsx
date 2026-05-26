import { useState, useRef, useEffect, useCallback } from 'react';
import type { MediaItem } from '../../../types/media';
import { ModernCard } from './ModernCard';

const HEIGHT     = ['68vh', '60vh', '50vh', '44vh', '40vh', '38vh'];
const OPACITY    = [1.00,   0.85,   0.65,   0.45,   0.30,   0.18 ];
const BLUR_PX    = [0,      0,      1,      2,      3,      4    ];
const BRIGHTNESS = [1.00,   0.88,   0.70,   0.52,   0.38,   0.26 ];
const ZINDEX     = [50,     40,     30,     20,     10,     5    ];
const MAX_VISIBLE = 5;

function lut<T>(table: T[], idx: number): T {
  return table[Math.min(idx, table.length - 1)];
}

interface ModernRowProps {
  title: string;
  items: MediaItem[];
  selectedItem: MediaItem | null;
  onSelect: (item: MediaItem) => void;
}

export function ModernRow({ title, items, selectedItem, onSelect }: ModernRowProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportW, setViewportW] = useState(900);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setViewportW(el.offsetWidth);
    const ro = new ResizeObserver(() => setViewportW(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = useCallback(
    (delta: number) =>
      setActiveIdx((i) => Math.max(0, Math.min(items.length - 1, i + delta))),
    [items.length],
  );

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [go]);

  // Wheel: only intercept horizontal scroll -- vertical propagates to parent snap container
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let acc = 0;
    let timer: ReturnType<typeof setTimeout>;
    const onWheel = (e: WheelEvent) => {
      const isHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!isHorizontal) return;
      e.preventDefault();
      acc += e.deltaX;
      clearTimeout(timer);
      timer = setTimeout(() => { acc = 0; }, 250);
      if (acc >  90) { go(1);  acc = 0; }
      if (acc < -90) { go(-1); acc = 0; }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); clearTimeout(timer); };
  }, [go]);

  const cardWActive     = Math.round(viewportW * 0.25);
  const cardW           = Math.round(viewportW * 0.20);
  const gap             = Math.round(viewportW * 0.012);
  const LEAD_PAD        = Math.round(viewportW * 0.04);
  const spacingActive   = gap + Math.round((cardWActive + cardW) / 2);
  const spacingNeighbor = gap + cardW;

  const leadCenterX = activeIdx === 0
    ? LEAD_PAD + cardWActive / 2
    : LEAD_PAD + cardW / 2 + spacingActive + (activeIdx - 1) * spacingNeighbor;
  const activeCenterX = Math.min(leadCenterX, viewportW / 2);

  return (
    <section
      className="relative snap-start snap-always"
      style={{ height: '100%', background: 'rgb(18 24 30)' }}
    >
      {/* Title floats over the carousel so it doesn't affect vertical centering */}
      <div className="absolute top-0 left-0 pt-8 px-10 z-10 pointer-events-none">
        <h2 className="text-[11px] font-semibold text-white/35 tracking-[0.2em] uppercase">
          {title}
        </h2>
      </div>

      <div
        ref={viewportRef}
        className="absolute inset-0 overflow-hidden"
        style={{ perspective: '1100px', perspectiveOrigin: '50% 50%' }}
      >
        {/* Radial glow behind active card */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 520,
            height: 520,
            background: 'radial-gradient(ellipse at center, rgba(25,140,255,0.12) 0%, rgba(25,140,255,0.04) 40%, transparent 70%)',
            zIndex: 0,
          }}
        />

        {items.map((item, i) => {
          const offset = i - activeIdx;
          const absOff = Math.abs(offset);
          if (absOff > MAX_VISIBLE) return null;

          const cardWidth = i === activeIdx ? cardWActive : cardW;
          const sign = Math.sign(offset);
          const x = offset === 0
            ? activeCenterX - cardWActive / 2
            : activeCenterX + sign * (spacingActive + (absOff - 1) * spacingNeighbor) - cardW / 2;

          return (
            <div
              key={item.id}
              className="absolute top-1/2 -translate-y-1/2"
              style={{
                left: x,
                width: cardWidth,
                height: lut(HEIGHT, absOff),
                opacity: lut(OPACITY, absOff),
                filter: `blur(${lut(BLUR_PX, absOff)}px) brightness(${lut(BRIGHTNESS, absOff)})`,
                zIndex: lut(ZINDEX, absOff),
                transition: 'left 220ms ease, width 220ms ease, height 220ms ease, opacity 220ms ease, filter 220ms ease',
              }}
            >
              <ModernCard
                item={item}
                isSelected={selectedItem?.id === item.id}
                onClick={() => {
                  if (i !== activeIdx) setActiveIdx(i);
                  else onSelect(item);
                }}
              />
            </div>
          );
        })}

        {/* Edge fades */}
        <div className="absolute inset-y-0 left-0 w-28 bg-gradient-to-r from-[#12181e] to-transparent pointer-events-none z-[60]" />
        <div className="absolute inset-y-0 right-0 w-28 bg-gradient-to-l from-[#12181e] to-transparent pointer-events-none z-[60]" />

        {activeIdx > 0 && (
          <button
            onClick={() => go(-1)}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-[70] w-10 h-10 rounded-full bg-white/8 hover:bg-white/20 border border-white/10 flex items-center justify-center text-white text-2xl transition-all duration-200"
          >
            &lsaquo;
          </button>
        )}
        {activeIdx < items.length - 1 && (
          <button
            onClick={() => go(1)}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-[70] w-10 h-10 rounded-full bg-white/8 hover:bg-white/20 border border-white/10 flex items-center justify-center text-white text-2xl transition-all duration-200"
          >
            &rsaquo;
          </button>
        )}
      </div>
    </section>
  );
}
