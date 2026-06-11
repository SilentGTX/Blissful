import type { ComponentProps } from 'react';
import { ListBox, Select } from '@heroui/react';
import { cn } from '@heroui/styles';

// Inherit HeroUI Select's exact selection types — its keys are React
// Aria's Key (string | number), NOT React's Key (which also allows
// bigint), so we derive rather than re-declare to avoid a mismatch.
type SelectProps = ComponentProps<typeof Select>;

export type BlissSelectItem = {
  /** Stable key — also the value reported to onSelectionChange. */
  key: string;
  /** Visible option text (and the trigger's selected label). */
  label: string;
};

export type BlissSelectProps = {
  /** Accessible name for the trigger. */
  ariaLabel: string;
  /** Options rendered into the listbox. */
  items: BlissSelectItem[];
  /** Controlled selected key (single-select). */
  selectedKey?: SelectProps['selectedKey'];
  /** Fires with the chosen key. */
  onSelectionChange?: SelectProps['onSelectionChange'];
  /** Disable the whole control. */
  isDisabled?: boolean;
  /** Classes on the root Select (e.g. a width like 'w-40'). */
  className?: string;
  /** Extra classes merged onto the trigger pill (e.g. 'h-9', 'solid-surface'). */
  triggerClassName?: string;
  /** Extra classes on the selected-value text (e.g. 'truncate whitespace-nowrap'). */
  valueClassName?: string;
};

// The glass-pill <select> used across Settings, Discover, Library and the
// detail-page filters. They all shared the same
// Trigger→Value/Indicator + Popover→ListBox tree and the same rounded
// bordered trigger, varying only in width and the option list — so this
// collapses the whole tree into one declarative, `items`-driven component.
//
// NOTE: EpisodesDrawer's season picker is intentionally NOT migrated here:
// it uses a bespoke chevron trigger that doesn't fit this scaffold, so it
// keeps the raw HeroUI compound.
const TRIGGER_BASE = 'bg-white/10 border border-white/10 rounded-full text-white';

export function BlissSelect({
  ariaLabel,
  items,
  selectedKey,
  onSelectionChange,
  isDisabled,
  className,
  triggerClassName,
  valueClassName,
}: BlissSelectProps) {
  return (
    <Select
      aria-label={ariaLabel}
      selectedKey={selectedKey}
      onSelectionChange={onSelectionChange}
      isDisabled={isDisabled}
      className={className}
    >
      <Select.Trigger className={cn(TRIGGER_BASE, triggerClassName)}>
        <Select.Value className={valueClassName} />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {items.map((item) => (
            <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
              {item.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
