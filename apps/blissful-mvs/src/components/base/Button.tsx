import type { ComponentProps } from 'react';
import { Button } from '@heroui/react';
import { tv, type VariantProps } from '@heroui/styles';

// Single home for Blissful's button looks. Nearly every button in the app
// is a rounded-full pill in one of a handful of colorways that, before
// this wrapper, were re-typed as inline className strings at each call
// site ("rounded-full bg-white text-black", "rounded-full bg-white/10",
// the periwinkle accent soft-fill, etc.). `tone` encodes those so call
// sites pick the look by name instead of repeating the classes.
//
// We deliberately do NOT touch HeroUI's own `variant` prop — it still
// passes through, and the `tone` classes layer on top via tailwind-merge
// (so a call site's own className always wins over the tone default).
const blissButton = tv({
  variants: {
    tone: {
      // White pill — the primary "confirm/continue" CTA.
      solid: 'rounded-full bg-white text-black hover:bg-white/90',
      // Frosted pill — the common secondary / "cancel" action.
      glass: 'rounded-full bg-white/10 text-white hover:bg-white/15',
      // Brand periwinkle soft-fill (e.g. detail-page secondary actions).
      accent:
        'rounded-full font-semibold bg-[var(--bliss-accent)]/15 text-[var(--bliss-accent)] hover:bg-[var(--bliss-accent)]/25',
      // Transparent row button used inside dropdown menus.
      subtle: 'bg-transparent text-white hover:bg-white/5',
      // No imposed look — pure pass-through for fully bespoke buttons
      // (e.g. StreamFilters' state-driven className).
      plain: '',
    },
  },
  defaultVariants: { tone: 'plain' },
});

export type BlissButtonProps = Omit<ComponentProps<typeof Button>, 'className'> &
  VariantProps<typeof blissButton> & { className?: string };

export function BlissButton({ tone, className, ...props }: BlissButtonProps) {
  return <Button className={blissButton({ tone, className })} {...props} />;
}
