import { EyeIcon } from '../../../icons/EyeIcon';

export function WatchBadge() {
  return (
    <div className="flex items-center gap-2 rounded-md bg-amber-300/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
      <EyeIcon size={12} />
      Watched
    </div>
  );
}
