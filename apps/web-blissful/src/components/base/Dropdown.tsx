import type { ComponentProps } from 'react';
import { Dropdown } from '@heroui/react';
import { cn } from '@heroui/styles';

// The app's three dropdown menus diverge in fill color, padding and shadow
// (account menu vs watch-party vs friend actions), so this wrapper only
// owns the bits they truly share — the rounded, blurred, white-text menu
// surface and rounded menu items — and lets each call site keep its own
// fill / positioning, which merge on top. Mainly this gives a single
// import + a sensible default for any new dropdown.
function DropdownRoot(props: ComponentProps<typeof Dropdown>) {
  return <Dropdown {...props} />;
}

function Popover({ className, ...props }: ComponentProps<typeof Dropdown.Popover>) {
  return (
    <Dropdown.Popover className={cn('rounded-2xl text-white backdrop-blur-xl', className)} {...props} />
  );
}

function Item({ className, ...props }: ComponentProps<typeof Dropdown.Item>) {
  return <Dropdown.Item className={cn('rounded-xl', className)} {...props} />;
}

export const BlissDropdown = Object.assign(DropdownRoot, {
  Trigger: Dropdown.Trigger,
  Popover,
  Menu: Dropdown.Menu,
  Item,
});
