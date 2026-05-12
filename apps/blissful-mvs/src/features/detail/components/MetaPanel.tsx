import { ImdbIcon } from '../../../icons/ImdbIcon';
import { GenreChips } from './GenreChips';

type MetaPanelProps = {
  logo: string | null;
  logoTitle: string;
  logoFailed: boolean;
  onLogoError: () => void;
  displayName: string;
  runtime: string | null;
  released: string | null;
  releaseInfo: string | null;
  imdbRating: number | null;
  genres: string[];
  onGenreClick: (genre: string) => void;
  cast: string[];
  onCastClick: (name: string) => void;
  description: string | null;
};

export function MetaPanel({
  logo,
  logoTitle,
  logoFailed,
  onLogoError,
  displayName,
  runtime,
  released,
  releaseInfo,
  imdbRating,
  genres,
  onGenreClick,
  cast,
  onCastClick,
  description,
}: MetaPanelProps) {
  const fallbackInitial = displayName.trim().charAt(0).toUpperCase();

  return (
    <div className="meta-preview-container-o22hc animation-fade-in">
      <div className="meta-preview-ES0h3">
        <div className="meta-info-container-ub8AH">
          <div className="hidden lg:block">
            {logo && !logoFailed ? (
              <img
                title={logoTitle}
                className="logo-X3hTV"
                src={logo}
                alt=" "
                loading="lazy"
                onError={onLogoError}
              />
            ) : (
              <div className="flex items-center gap-4">
                <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-sky-400/30 via-violet-400/30 to-amber-400/30 flex items-center justify-center text-2xl font-bold text-white/80">
                  {fallbackInitial}
                </div>
                <div className="text-3xl font-semibold tracking-tight text-white">
                  {displayName}
                </div>
              </div>
            )}
          </div>

          <div className="runtime-release-info-container-9tY8q">
            {runtime ? <div className="runtime-label-ywyh7">{runtime}</div> : null}
            {released ? (
              <div className="release-info-label-ywyh7">{released}</div>
            ) : releaseInfo ? (
              <div className="release-info-label-ywyh7">{releaseInfo}</div>
            ) : null}
            {imdbRating !== null ? (
              <div className="imdb-button-container-hTq0g" aria-label="IMDb rating">
                <div className="label">{imdbRating.toFixed(1)}</div>
                <ImdbIcon className="icon-N_uIU" />
              </div>
            ) : null}
          </div>

          {genres.length ? (
            <div className="mt-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Genres</div>
              <GenreChips
                genres={genres}
                onGenreClick={onGenreClick}
                className="mt-3 flex flex-wrap gap-3"
              />
            </div>
          ) : null}

          {cast.length ? (
            <div className="mt-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Cast</div>
              <div className="mt-3 flex flex-wrap gap-3">
                {cast.slice(0, 12).map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold tracking-tight text-white/90 hover:bg-white/15"
                    onClick={() => onCastClick(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {description ? (
            <div className="mt-6 max-w-3xl">
              <div className="text-xs font-semibold uppercase tracking-wide text-white/60">Summary</div>
              <p className="mt-2 text-sm leading-relaxed text-white/80">{description}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
