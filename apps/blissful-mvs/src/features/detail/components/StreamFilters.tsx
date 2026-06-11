import { BlissButton, BlissSelect } from '../../../components/base';

type StreamFiltersProps = {
  addonSelectItems: Array<{ key: string; label: string }>;
  selectedAddon: string;
  onSelectAddon: (key: string) => void;
  showAddonSelect?: boolean;
  onlyTorrentioRdResolve: boolean;
  onToggleWebReady: () => void;
  className?: string;
  addonWidthClassName?: string;
  showWebReadyToggle?: boolean;
};

export function StreamFilters({
  addonSelectItems,
  selectedAddon,
  onSelectAddon,
  showAddonSelect = true,
  onlyTorrentioRdResolve,
  onToggleWebReady,
  className,
  addonWidthClassName = 'w-[140px]',
  showWebReadyToggle = true,
}: StreamFiltersProps) {
  return (
    <div className={className ?? ''}>
      <div className="flex flex-wrap items-center gap-2">
        {showAddonSelect ? (
          <BlissSelect
            ariaLabel="Addon"
            selectedKey={addonSelectItems.some((item) => item.key === selectedAddon) ? selectedAddon : undefined}
            onSelectionChange={(key) => {
              if (key !== null) onSelectAddon(String(key));
            }}
            items={addonSelectItems}
            className={addonWidthClassName}
            triggerClassName="h-9"
            valueClassName="truncate whitespace-nowrap"
          />
        ) : null}

        {showWebReadyToggle ? (
          <BlissButton
            size="sm"
            variant="ghost"
            className={
              'rounded-full border h-9 px-4 whitespace-nowrap ' +
              (onlyTorrentioRdResolve
                ? 'bg-[var(--bliss-accent)]/15 border-[var(--bliss-accent)]/20 text-[var(--bliss-accent)]'
                : 'bg-white/10 border-white/10 text-white')
            }
            onPress={onToggleWebReady}
          >
            WEB Ready
          </BlissButton>
        ) : null}
      </div>
    </div>
  );
}
