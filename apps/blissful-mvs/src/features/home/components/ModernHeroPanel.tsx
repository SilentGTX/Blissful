import { useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { showHeroTransition } from '../../../lib/heroTransition';
import { motion } from 'framer-motion';
import { BlissButton } from '../../../components/base';
import { normalizeStremioImage } from '../../../lib/mediaTypes';
import { proxiedImage } from '../../../lib/imageProxy';
import type { MediaItem } from '../../../types/media';
import type { StremioMetaDetail } from '../../../lib/stremioAddon';

interface ModernHeroPanelProps {
  item: MediaItem;
  meta: StremioMetaDetail | null;
  onClose: () => void;
  onPlay: (item: MediaItem) => void;
}

export function ModernHeroPanel({ item, meta, onClose }: ModernHeroPanelProps) {
  const navigate = useNavigate();
  const [isExpanding, setIsExpanding] = useState(false);
  const backdrop = normalizeStremioImage(meta?.meta?.background) ?? null;
  const poster = normalizeStremioImage(item.posterUrl) ?? item.posterUrl;
  const heroImage = backdrop ?? poster;

  const handleWatchNow = async () => {
    await import('../../../pages/DetailPage'); // ensure chunk ready before animation
    setIsExpanding(true);
  };

  const handleAnimationComplete = () => {
    if (isExpanding) {
      // Force overlay to render synchronously before navigate fires
      flushSync(() => showHeroTransition(heroImage ?? null));
      // Double rAF: ensure the overlay is actually painted before route change
      requestAnimationFrame(() => requestAnimationFrame(() => {
        navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`, {
          state: { heroImage },
        });
      }));
    }
  };

  return (
    <>
      {/* Backdrop scrim — fades out when expanding */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: isExpanding ? 0 : 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
        className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
        onClick={!isExpanding ? onClose : undefined}
      />

      {/* Panel */}
      <motion.div
        initial={{ clipPath: 'inset(0 50% 0 50% round 24px)', opacity: 0 }}
        animate={isExpanding ? {
          clipPath: 'inset(0 0% 0 0% round 0px)',
          opacity: 1,
          top: '0vh',
          bottom: '0vh',
          left: '0%',
          right: '0%',
          borderRadius: '0px',
        } : {
          clipPath: 'inset(0 0% 0 0% round 24px)',
          opacity: 1,
        }}
        exit={isExpanding ? undefined : { clipPath: 'inset(0 50% 0 50% round 24px)', opacity: 0 }}
        transition={{ duration: isExpanding ? 0.55 : 1, ease: [0.22, 1, 0.36, 1] }}
        onAnimationComplete={handleAnimationComplete}
        style={{
          position: 'fixed',
          top: 'calc(16vh + 36px)',
          bottom: 'calc(16vh - 36px)',
          left: '12%',
          right: '12%',
          zIndex: 50,
          overflow: 'hidden',
          borderRadius: '1.5rem',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.9)',
        }}
      >
        {/* Background */}
        {backdrop ? (
          <img src={proxiedImage(backdrop)} className="absolute inset-0 w-full h-full object-cover" />
        ) : poster ? (
          <img src={proxiedImage(poster)} className="absolute inset-0 w-full h-full object-cover" style={{ filter: 'blur(8px) brightness(0.5) scale(1.1)' }} />
        ) : (
          <div className="absolute inset-0 bg-black/80" />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/40 to-black/20" />

        {/* Close button — hidden while expanding */}
        {!isExpanding && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center bg-black/50 hover:bg-black/80 rounded-full text-white text-sm transition"
          >
            ✕
          </button>
        )}

        {/* Content */}
        <div className="absolute bottom-8 left-8 right-8 z-10 space-y-3">
          <h2 className="font-[Instrument_Serif] text-3xl md:text-5xl font-bold text-white leading-tight">
            {item.title}
          </h2>
          <div className="flex flex-wrap items-center gap-2 text-sm text-white/70">
            {meta?.meta?.year && <span>{meta.meta.year}</span>}
            {meta?.meta?.runtime && <span>· {meta.meta.runtime}</span>}
            {meta?.meta?.imdbRating && (
              <span className="bg-yellow-500/20 text-yellow-400 rounded px-2 py-0.5">
                ★ {meta.meta.imdbRating}
              </span>
            )}
            {meta?.meta?.genres?.slice(0, 3).map((g) => (
              <span key={g} className="bg-white/10 rounded px-2 py-0.5">{g}</span>
            ))}
          </div>
          {meta?.meta?.description && (
            <p className="text-sm md:text-base text-white/70 max-w-2xl line-clamp-3">
              {meta.meta.description}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <BlissButton
              size="sm"
              className="bg-white text-black font-semibold hover:bg-white/90 px-6"
              onPress={handleWatchNow}
            >
              ▶ Watch Now
            </BlissButton>
            <BlissButton
              size="sm"
              variant="ghost"
              className="bg-white/10 text-white hover:bg-white/20 px-6"
              onPress={onClose}
            >
              Close
            </BlissButton>
          </div>
        </div>
      </motion.div>
    </>
  );
}
