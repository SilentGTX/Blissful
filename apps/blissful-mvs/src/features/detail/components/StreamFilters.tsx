import { ListBox, Select } from '@heroui/react';

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
      </div>
    </div>
  );
}
