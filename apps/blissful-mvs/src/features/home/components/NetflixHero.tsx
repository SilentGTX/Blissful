import type { MediaItem } from '../../../types/media';
import type { StremioMetaDetail } from '../../../lib/stremioAddon';
import { normalizeStremioImage } from '../../../lib/stremioApi';
import { InfoIcon } from '../../../icons/InfoIcon';
import { PlayIcon } from '../../../icons/PlayIcon';
import { TrailerIcon } from '../../../icons/TrailerIcon';

type NetflixHeroProps = {
  item?: MediaItem;
  meta: StremioMetaDetail | null;
  prevItem?: MediaItem | null;
  prevMeta?: StremioMetaDetail | null;
  isFading?: boolean;
  fadeIn?: boolean;
  onPlay: () => void;
  onInfo: () => void;
  onTrailer?: () => void;
};

export function NetflixHero({
  item,
  meta,
  prevItem,
  prevMeta,
  isFading = false,
  fadeIn = true,
  onPlay,
  onInfo,
  onTrailer,
}: NetflixHeroProps) {
  if (!item) return null;

  const renderLayer = (
    layerItem: MediaItem,
    layerMeta: StremioMetaDetail | null,
    className: string,
    actionsEnabled: boolean
  ) => {
    const background =
      normalizeStremioImage(layerMeta?.meta?.background ?? layerMeta?.meta?.poster) ??
      layerItem.posterUrl;
    const title = layerMeta?.meta?.name ?? layerItem.title;
    const genres = layerMeta?.meta?.genres ?? layerItem.genres ?? [];
    const year = layerMeta?.meta?.year ?? layerItem.year;
    const runtime = layerMeta?.meta?.runtime ?? layerItem.runtime;
    const metaLine = [genres[0], year ? String(year) : null, runtime].filter(
      (v): v is string => typeof v === 'string' && v.length > 0
    );
    const description = layerMeta?.meta?.description ?? layerItem.blurb;

    return (
      <div className={`netflix-hero-layer ${className}`.trim()}>
        {background ? (
          <div className="netflix-hero-bg" style={{ backgroundImage: `url(${background})` }} />
        ) : null}
        <div className="netflix-hero-overlay" />
        <div className="netflix-hero-content">
          <div className="netflix-hero-label">Now Popular</div>
          <div className="netflix-hero-title">{title}</div>
          {metaLine.length > 0 ? <div className="netflix-hero-meta">{metaLine.join(' · ')}</div> : null}
          {description ? <div className="netflix-hero-blurb">{description}</div> : null}
          <div className={`netflix-hero-actions ${actionsEnabled ? '' : 'is-ghost'}`.trim()}>
            <button type="button" className="netflix-hero-btn netflix-hero-btn-play" onClick={onPlay}>
              <PlayIcon size={16} />
              Play
            </button>
            {onTrailer ? (
              <button type="button" className="netflix-hero-btn netflix-hero-btn-trailer" onClick={onTrailer}>
                <TrailerIcon size={16} />
                Trailer
              </button>
            ) : null}
            <button type="button" className="netflix-hero-btn netflix-hero-btn-info" onClick={onInfo}>
              <InfoIcon size={16} />
              More Info
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section className="netflix-hero netflix-reveal">
      {prevItem ? renderLayer(prevItem, prevMeta ?? null, `is-prev ${isFading ? 'is-fading' : ''}`, false) : null}
      {renderLayer(item, meta, `is-current ${fadeIn ? 'is-visible' : ''}`, true)}
    </section>
  );
}
