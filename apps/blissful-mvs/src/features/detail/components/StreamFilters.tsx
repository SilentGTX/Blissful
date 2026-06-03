import { FocusableButton } from '../../../spatial/FocusableButton';
import { TvSelect } from '../../../spatial/TvSelect';
import { isTvMode } from '../../../lib/platform';

type StreamFiltersProps = {
  addonSelectItems: Array<{ key: string; label: string }>;
  selectedAddon: string;
  onSelectAddon: (key: string) => void;
  showAddonSelect?: boolean;
  className?: string;
  addonWidthClassName?: string;
};

export function StreamFilters({
  addonSelectItems,
  selectedAddon,
  onSelectAddon,
  showAddonSelect = true,
  className,
  addonWidthClassName = 'w-[140px]',
}: StreamFiltersProps) {
  // TV: a dropdown popover isn't D-pad friendly; render a focusable button that
  // cycles to the next addon on OK (short list — All addons + a few sources).
  const idx = addonSelectItems.findIndex((i) => i.key === selectedAddon);
  const current = addonSelectItems[idx] ?? addonSelectItems[0];
  const cycleAddon = () => {
    if (addonSelectItems.length < 2) return;
    const next = addonSelectItems[(Math.max(0, idx) + 1) % addonSelectItems.length];
    if (next) onSelectAddon(next.key);
  };

  return (
    <div className={className ?? ''}>
      <div className="flex flex-wrap items-center gap-2">
        {showAddonSelect && isTvMode() ? (
          <FocusableButton
            className={
              (addonWidthClassName ?? 'w-[140px]') +
              ' flex h-9 items-center justify-between gap-2 rounded-full border border-white/10 bg-white/10 px-4 text-sm text-white'
            }
            onPress={cycleAddon}
            aria-label="Addon filter — press to cycle"
          >
            <span className="truncate">{current?.label ?? 'All addons'}</span>
            <span aria-hidden className="shrink-0 opacity-60">⟳</span>
          </FocusableButton>
        ) : showAddonSelect ? (
          <TvSelect
            ariaLabel="Addon"
            value={addonSelectItems.some((item) => item.key === selectedAddon) ? selectedAddon : undefined}
            options={addonSelectItems}
            onChange={(key) => onSelectAddon(key)}
            className={addonWidthClassName}
          />
        ) : null}
      </div>
    </div>
  );
}
