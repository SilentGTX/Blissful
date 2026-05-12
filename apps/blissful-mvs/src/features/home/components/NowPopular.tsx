import type { MediaItem } from '../../../types/media';
import { useEffect, useState } from 'react';
import { LibraryActionButton } from '../../../components/LibraryActionButton';
import type { StremioMetaDetail } from '../../../lib/stremioAddon';
import { normalizeStremioImage } from '../../../lib/stremioApi';
import { GenreChips } from '../../detail/components/GenreChips';

type NowPopularProps = {
  hero: MediaItem | null;
  heroMeta: StremioMetaDetail | null;
  inLibrary: boolean;
  onWatch: () => void;
  onAddToList: () => void;
  onGenreClick: (genre: string) => void;
};

export function NowPopular({
  hero,
  heroMeta,
  inLibrary,
  onWatch,
  onAddToList,
  onGenreClick,
}: NowPopularProps) {
  const [lockedBg, setLockedBg] = useState('');

  useEffect(() => {
    if (!hero?.id) {
      setLockedBg('');
    }
  }, [hero?.id]);

  useEffect(() => {
    const raw = normalizeStremioImage(heroMeta?.meta?.background) ?? '';
    const next = raw.startsWith('http://') ? raw.replace(/^http:\/\//, 'https://') : raw;
    if (next) setLockedBg(next);
  }, [heroMeta?.meta?.background]);

  const hasBg = Boolean(lockedBg);

  return (
    <div className="solid-surface relative overflow-hidden rounded-[36px] bg-[#0f1115]/85">
      <div className="relative w-full h-[32vh] md:h-[50dvh]">
        {hasBg ? (
          <img
            src={lockedBg}
            alt=""
            className="now-popular-bg-motion absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-white/5 to-transparent" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/10" />

        <div className="absolute inset-0 p-4 md:p-6">
          <div className="flex h-full flex-col">
            <div className="text-[10px] md:text-sm font-semibold uppercase tracking-[0.35em] text-white/70 cursor-default">
              🔥 Now Popular
            </div>
            <div className="mt-auto space-y-2 md:space-y-3 cursor-default">
              <GenreChips
                genres={hero?.genres ?? []}
                onGenreClick={onGenreClick}
                limit={3}
                className="flex flex-wrap gap-2"
                buttonClassName="glass-surface rounded-full bg-white/12 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur hover:bg-white/20 transition-colors cursor-pointer"
              />
              <div className="max-w-[320px] md:max-w-[420px] text-2xl md:text-3xl font-semibold text-white">
                {hero?.title ?? 'Pick something to watch'}
              </div>
              {hero?.blurb ? (
                <p className="hidden md:block max-w-[40%] text-md leading-relaxed text-white/70">
                  {hero.blurb}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2 md:gap-3 pt-1 md:pt-2">
                <button
                  type="button"
                  className="action-button-Pn4hZ group mb-0 cursor-pointer !border-0 !bg-white !text-[#212121] hover:!bg-[#212121] hover:!text-white !h-11 !px-4 !text-sm"
                  onClick={onWatch}
                >
                  <span className="text !text-[#212121] group-hover:!text-white">Watch now</span>
                </button>
                <LibraryActionButton inLibrary={inLibrary} onToggleLibrary={onAddToList} className="mb-0 cursor-pointer !h-11 !px-4 !text-sm" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
