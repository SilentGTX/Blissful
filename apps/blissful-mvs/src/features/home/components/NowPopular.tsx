import type { MediaItem } from '../../../types/media';
import { useEffect, useRef, useState } from 'react';
import { LibraryActionButton } from '../../../components/LibraryActionButton';
import StremioIcon from '../../../components/StremioIcon';
import { FocusableButton } from '../../../spatial/FocusableButton';
import { isTvMode } from '../../../lib/platform';
import type { StremioMetaDetail } from '../../../lib/stremioAddon';
import { normalizeStremioImage } from '../../../lib/mediaTypes';
import { proxiedImage } from '../../../lib/imageProxy';
import { GenreChips } from '../../detail/components/GenreChips';

type NowPopularProps = {
  hero: MediaItem | null;
  heroMeta: StremioMetaDetail | null;
  inLibrary: boolean;
  onWatch: () => void;
  onAddToList: () => void;
  onGenreClick: (genre: string) => void;
  /** TV: stable focusKey on the "Watch now" button so the top rail can route
   *  UP back onto it. */
  watchFocusKey?: string;
};

export function NowPopular({
  hero,
  heroMeta,
  inLibrary,
  onWatch,
  onAddToList,
  onGenreClick,
  watchFocusKey,
}: NowPopularProps) {
  const [lockedBg, setLockedBg] = useState('');
  // On TV the hero auto-rotates (every ~11s); we keep the outgoing background
  // as a second layer so it can cross-fade out while the new one fades in +
  // Ken-Burns — same motion as the Netflix hero, on the classic billboard.
  const [prevBg, setPrevBg] = useState('');
  const curBgRef = useRef('');
  const tv = isTvMode();

  useEffect(() => {
    if (!hero?.id) {
      setLockedBg('');
      setPrevBg('');
      curBgRef.current = '';
    }
  }, [hero?.id]);

  useEffect(() => {
    const raw = proxiedImage(normalizeStremioImage(heroMeta?.meta?.background) ?? '');
    const next = raw.startsWith('http://') ? raw.replace(/^http:\/\//, 'https://') : raw;
    if (next && next !== curBgRef.current) {
      if (curBgRef.current) setPrevBg(curBgRef.current);
      curBgRef.current = next;
      setLockedBg(next);
    }
  }, [heroMeta?.meta?.background]);

  const hasBg = Boolean(lockedBg);

  // Two button variants. The card uses a container query to swap
  // between them based on the CARD'S width (not viewport), so a
  // narrow column on a wide screen still gets the compact look:
  //   - @max-md (narrow card / mobile): icon-only circles, matching
  //     the DetailPage MobileActionButtons style. "Remove from library"
  //     text is too long for the card here and overflowed.
  //   - @md+ (wider card): the original "Watch now" + library text
  //     buttons.
  const actionButtonsText = (
    <>
      <button
        type="button"
        className="action-button-Pn4hZ group mb-0 cursor-pointer !border-0 !bg-white !text-[#212121] hover:!bg-[#212121] hover:!text-white !h-11 !px-4 !text-sm"
        onClick={onWatch}
      >
        <span className="text !text-[#212121] group-hover:!text-white">Watch now</span>
      </button>
      <LibraryActionButton
        inLibrary={inLibrary}
        onToggleLibrary={onAddToList}
        className="mb-0 cursor-pointer !h-11 !px-4 !text-sm"
      />
    </>
  );

  const actionButtonsIcons = (
    <>
      <button
        type="button"
        className="grid h-10 w-10 place-items-center rounded-full bg-white/95 text-[#05070a] transition-all duration-200 hover:bg-white active:scale-[0.98]"
        onClick={onWatch}
        aria-label="Watch now"
      >
        <svg
          className="h-5 w-5"
          fill="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Centroid at (12,12) for optical centering — see comment
              in ActionButtons.tsx. */}
          <polygon points="8,5 20,12 8,19" />
        </svg>
      </button>
      <button
        type="button"
        className={`grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-black/50 backdrop-blur transition-colors ${inLibrary ? 'text-[var(--bliss-accent)]' : 'text-white'}`}
        onClick={onAddToList}
        aria-label={inLibrary ? 'Remove from library' : 'Add to library'}
      >
        <StremioIcon
          name={inLibrary ? 'remove-from-library' : 'add-to-library'}
          className="h-5 w-5"
        />
      </button>
    </>
  );

  return (
    <div className="now-popular-hero @container solid-surface relative overflow-hidden rounded-[36px] bg-[#0f1115]/85">
      {/* Card grows with viewport at wide container widths, but at
          narrow card widths uses a flat min-height so chips+title+CTAs
          fit. Background image keeps `h-full w-full object-cover`,
          which now sizes against whichever the content drives.       */}
      <div className="now-popular-hero-inner relative w-full min-h-[280px] @md:min-h-[360px] @xl:min-h-[420px] @xl:h-[50dvh]">
        {tv ? (
          <>
            {prevBg ? (
              <div
                key={`prev-${prevBg}`}
                className="now-popular-bg-layer is-prev"
                style={{ backgroundImage: `url(${prevBg})` }}
              />
            ) : null}
            {lockedBg ? (
              <div
                key={`cur-${lockedBg}`}
                className="now-popular-bg-layer is-current"
                style={{ backgroundImage: `url(${lockedBg})` }}
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-white/5 to-transparent" />
            )}
          </>
        ) : hasBg ? (
          <img
            src={lockedBg}
            alt=""
            className="now-popular-bg-motion absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 via-white/5 to-transparent" />
        )}
        <div className="now-popular-scrim absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-black/10" />

        <div className="now-popular-content absolute inset-0 p-4 @md:p-6">
          <div className="flex h-full flex-col min-h-0">
            <div className="text-[10px] @md:text-sm font-semibold uppercase tracking-[0.35em] text-white/70 cursor-default">
              🔥 Now Popular
            </div>
            <div className="now-popular-detail-stack mt-auto min-h-0 space-y-2 @md:space-y-3 cursor-default overflow-hidden">
              <GenreChips
                genres={hero?.genres ?? []}
                onGenreClick={onGenreClick}
                limit={3}
                className="flex flex-wrap gap-2"
                buttonClassName="glass-surface rounded-full bg-white/12 px-3 py-1 text-xs font-semibold text-white/90 backdrop-blur hover:bg-white/20 transition-colors cursor-pointer"
              />
              <div className="tv-hero-title text-xl @sm:text-2xl @md:text-3xl font-semibold text-white break-words max-w-full @md:max-w-[420px] line-clamp-2">
                {hero?.title ?? 'Pick something to watch'}
              </div>
              {hero?.blurb ? (
                // Always visible — the icon-only mobile button cluster
                // and the line-clamp-3 cap mean even the narrowest
                // mid-width cards have room for the blurb without
                // overflowing the slot.
                <p className="line-clamp-3 max-w-full @md:max-w-[60%] @2xl:max-w-[40%] text-xs @md:text-sm @2xl:text-base leading-relaxed text-white/70">
                  {hero.blurb}
                </p>
              ) : null}
              {tv ? (
                <div className="flex flex-wrap gap-3 pt-3">
                  <FocusableButton
                    className="action-button-Pn4hZ mb-0 cursor-pointer !border-0 !bg-[var(--bliss-accent)] !text-[#05070a] hover:!opacity-90 !h-14 !px-7 !text-base"
                    onPress={onWatch}
                    autoFocusTv
                    focusKeyTv={watchFocusKey}
                    aria-label="Watch now"
                  >
                    <StremioIcon name="play" className="icon" />
                    <span className="text !text-[#05070a]">Watch now</span>
                  </FocusableButton>
                  <LibraryActionButton
                    inLibrary={inLibrary}
                    onToggleLibrary={onAddToList}
                    className="mb-0 cursor-pointer !h-14 !px-7 !text-base"
                  />
                </div>
              ) : (
                <>
                  <div className="hidden @md:flex flex-wrap gap-3 pt-2">
                    {actionButtonsText}
                  </div>
                  <div className="flex @md:hidden gap-2 pt-1">
                    {actionButtonsIcons}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
