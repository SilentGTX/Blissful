import type { ComponentProps } from 'react';
import { Spinner } from '@heroui/react';
import { tv, type VariantProps } from '@heroui/styles';

// HeroUI's `color="accent"` is its OWN semantic accent, not Blissful's
// brand periwinkle (--bliss-accent). Every spinner in the app therefore
// used `color="current"` + the same `text-[var(--bliss-accent)]` + glow
// drop-shadow className. This wrapper bakes that in as the default `tone`
// so a bare <BlissSpinner /> already glows the right color; `size` and
// everything else pass straight through.
const blissSpinner = tv({
  variants: {
    tone: {
      accent: 'text-[var(--bliss-accent)] drop-shadow-[0_0_12px_var(--bliss-accent-glow)]',
      muted: 'text-white/40',
    },
  },
  defaultVariants: { tone: 'accent' },
});

export type BlissSpinnerProps = Omit<ComponentProps<typeof Spinner>, 'className' | 'color'> &
  VariantProps<typeof blissSpinner> & { className?: string };

export function BlissSpinner({ tone, className, ...props }: BlissSpinnerProps) {
  return <Spinner color="current" className={blissSpinner({ tone, className })} {...props} />;
}
