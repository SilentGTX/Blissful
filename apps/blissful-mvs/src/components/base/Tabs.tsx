import type { ComponentProps } from 'react';
import { Tabs } from '@heroui/react';
import { cn } from '@heroui/styles';

// The "pill" tab strip used by the player settings panel and the watch-
// party drawer — a frosted black capsule holding rounded tabs with a
// sliding white-glass indicator behind the active label. Both call sites
// used byte-for-byte the same classes, so all of them live here; call
// sites are left with just structure (ids + selectedKey). Tabs render
// content manually in this app, so Panel is re-exported but rarely used.
function TabsRoot({ className, ...props }: ComponentProps<typeof Tabs>) {
  return <Tabs className={cn('rounded-full bg-black/60 p-1 backdrop-blur-md', className)} {...props} />;
}

function List({ className, ...props }: ComponentProps<typeof Tabs.List>) {
  return <Tabs.List className={cn('relative flex items-center gap-1', className)} {...props} />;
}

function Tab({ className, ...props }: ComponentProps<typeof Tabs.Tab>) {
  return (
    <Tabs.Tab
      className={cn(
        'relative cursor-pointer rounded-full px-4 py-1.5 text-xs font-medium capitalize text-white/60 outline-none transition data-[selected=true]:text-white data-[hovered=true]:text-white',
        className,
      )}
      {...props}
    />
  );
}

function Indicator({ className, ...props }: ComponentProps<typeof Tabs.Indicator>) {
  return (
    <Tabs.Indicator className={cn('absolute inset-0 -z-10 rounded-full bg-white/15', className)} {...props} />
  );
}

export const BlissTabs = Object.assign(TabsRoot, {
  ListContainer: Tabs.ListContainer,
  List,
  Tab,
  Indicator,
  Panel: Tabs.Panel,
});
