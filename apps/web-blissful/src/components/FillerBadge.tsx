// "Filler" / "Recap" chip stamped on episode cards, the player's title row and
// the next-episode button. One component so the colour reads the same on the
// detail page, in the episodes drawer and in the player.

import type { FillerKind } from '../lib/animeFiller';

export const FILLER_BADGE_CLASS: Record<FillerKind, string> = {
  filler: 'bg-orange-400 text-black',
  recap: 'bg-violet-300 text-black',
};

export function fillerKindLabel(kind: FillerKind): string {
  return kind === 'filler' ? 'Filler' : 'Recap';
}

export function FillerBadge({ kind, className }: { kind: FillerKind; className?: string }) {
  return (
    <span
      className={
        'shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider md:px-2 md:text-[10px] '
        + FILLER_BADGE_CLASS[kind]
        + (className ? ` ${className}` : '')
      }
      title={kind === 'filler' ? 'Filler episode (MyAnimeList)' : 'Recap episode (MyAnimeList)'}
    >
      {fillerKindLabel(kind)}
    </span>
  );
}

/** Small corner dot for icon buttons (the next-episode control) — the button
 *  has no room for the word, the dot says "look at the tooltip". */
export function FillerDot({ kind, className }: { kind: FillerKind; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={
        'pointer-events-none absolute h-2.5 w-2.5 rounded-full ring-2 ring-black/70 '
        + (kind === 'filler' ? 'bg-orange-400' : 'bg-violet-300')
        + (className ? ` ${className}` : ' right-1 top-1')
      }
    />
  );
}
