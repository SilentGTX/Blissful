import { useTvFocusable } from '../../../spatial/useTvFocusable';

type GenreChipsProps = {
  genres: string[];
  onGenreClick: (genre: string) => void;
  limit?: number;
  className?: string;
  buttonClassName?: string;
};

// A single chip. Split out so it can own a TV focus node (hooks can't run in a
// .map). D-pad reachable on TV; mouse onClick everywhere else.
function GenreChip({ genre, onClick, className }: { genre: string; onClick: () => void; className: string }) {
  const { ref } = useTvFocusable({ onPress: onClick });
  return (
    <button ref={ref} type="button" className={'tv-genre-chip ' + className} onClick={onClick}>
      {genre}
    </button>
  );
}

export function GenreChips({
  genres,
  onGenreClick,
  limit = 18,
  className,
  buttonClassName,
}: GenreChipsProps) {
  if (!genres.length) return null;
  const chipClass =
    buttonClassName ??
    'rounded-full bg-white/10 px-4 py-2 text-sm font-semibold tracking-tight text-white/90 hover:bg-white/15';
  return (
    <div className={className ?? ''}>
      {genres.slice(0, limit).map((g) => (
        <GenreChip key={g} genre={g} onClick={() => onGenreClick(g)} className={chipClass} />
      ))}
    </div>
  );
}
