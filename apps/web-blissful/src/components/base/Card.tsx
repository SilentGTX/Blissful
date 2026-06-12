import type { ComponentProps } from 'react';
import { Card } from '@heroui/react';
import { tv, type VariantProps } from '@heroui/styles';

// The two card looks used across the app, named so call sites stop
// re-typing the long shadow/blur/border strings:
//   - `panel`  — bordered glass card (grid "details" cards, generic panels)
//   - `poster` — borderless, zero-padding frame that the poster image fills
//   - `flat`   — opaque solid-surface card (no translucency) for dark UIs
// Interactive states (hover glow, selected ring) stay at the call site and
// merge on top via tailwind-merge — the wrapper only owns the base surface.
// HeroUI's own `variant` is intentionally left at its default so the
// underlying surface token is unchanged from the pre-wrapper markup.
const blissCard = tv({
  variants: {
    surface: {
      panel:
        'rounded-2xl border border-white/10 shadow-[0_18px_40px_rgba(0,0,0,0.22)] backdrop-blur-xl',
      poster:
        'rounded-2xl border-0 p-0 shadow-[0_18px_40px_rgba(0,0,0,0.25)] backdrop-blur-xl',
      flat: 'solid-surface rounded-2xl border-0 bg-white/6 backdrop-blur',
    },
  },
  defaultVariants: { surface: 'panel' },
});

export type BlissCardProps = Omit<ComponentProps<typeof Card>, 'className'> &
  VariantProps<typeof blissCard> & { className?: string };

function CardRoot({ surface, className, ...props }: BlissCardProps) {
  return <Card className={blissCard({ surface, className })} {...props} />;
}

// Re-export the compound parts unchanged so call sites keep using the
// familiar <BlissCard.Content> / <BlissCard.Header> structure.
export const BlissCard = Object.assign(CardRoot, {
  Content: Card.Content,
  Header: Card.Header,
  Footer: Card.Footer,
  Title: Card.Title,
  Description: Card.Description,
});
