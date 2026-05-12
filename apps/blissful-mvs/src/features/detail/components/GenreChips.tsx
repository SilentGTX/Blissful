type GenreChipsProps = {
  genres: string[];
  onGenreClick: (genre: string) => void;
  limit?: number;
  className?: string;
  buttonClassName?: string;
};

export function GenreChips({
  genres,
  onGenreClick,
  limit = 18,
  className,
  buttonClassName,
}: GenreChipsProps) {
  if (!genres.length) return null;
  return (
    <div className={className ?? ''}>
      {genres.slice(0, limit).map((g) => (
        <button
          key={g}
          type="button"
          className={
            buttonClassName ??
            'rounded-full bg-white/10 px-4 py-2 text-sm font-semibold tracking-tight text-white/90 hover:bg-white/15'
          }
          onClick={() => onGenreClick(g)}
        >
          {g}
        </button>
      ))}
    </div>
  );
}
