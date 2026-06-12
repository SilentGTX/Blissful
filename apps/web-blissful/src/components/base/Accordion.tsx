import type { ComponentProps } from 'react';
import { Accordion } from '@heroui/react';
import { cn } from '@heroui/styles';

// Thin wrapper for the stream-list accordion. The root is left
// unstyled (it sits inside an already-styled panel — no glass surface
// imposed); the only shared defaults are the trigger hover and the
// right-aligned chevron. Compound parts are re-exported so the
// Heading/Trigger/Panel/Body structure is preserved.
function AccordionRoot(props: ComponentProps<typeof Accordion>) {
  return <Accordion {...props} />;
}

function Trigger({ className, ...props }: ComponentProps<typeof Accordion.Trigger>) {
  return <Accordion.Trigger className={cn('px-3 py-2 hover:bg-white/5', className)} {...props} />;
}

function Indicator({ className, ...props }: ComponentProps<typeof Accordion.Indicator>) {
  return <Accordion.Indicator className={cn('ml-auto', className)} {...props} />;
}

export const BlissAccordion = Object.assign(AccordionRoot, {
  Item: Accordion.Item,
  Heading: Accordion.Heading,
  Trigger,
  Panel: Accordion.Panel,
  Body: Accordion.Body,
  Indicator,
});
