import { Button, ListBox, Select } from '@heroui/react';
import { isElectronDesktopApp } from '../../../lib/platform';

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
          <Select
            aria-label="Addon"
            selectedKey={addonSelectItems.some((item) => item.key === selectedAddon) ? selectedAddon : undefined}
            onSelectionChange={(key) => {
              if (key !== null) onSelectAddon(String(key));
            }}
            className={addonWidthClassName}
          >
            <Select.Trigger className="h-9 bg-white/10 border border-white/10 rounded-full">
              <Select.Value className="truncate whitespace-nowrap" />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {addonSelectItems.map((item) => (
                  <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                    {item.label}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        ) : null}

        {showWebReadyToggle && !isElectronDesktopApp() ? (
          <Button
            size="sm"
            variant="ghost"
            className={
              'rounded-full border h-9 px-4 whitespace-nowrap ' +
              (onlyTorrentioRdResolve
                ? 'bg-emerald-400/15 border-emerald-300/20 text-emerald-100'
                : 'bg-white/10 border-white/10 text-white')
            }
            onPress={onToggleWebReady}
          >
            WEB Ready
          </Button>
        ) : null}
      </div>
    </div>
  );
}
