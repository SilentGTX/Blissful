import type { ComponentProps } from 'react';
import { Chip } from '@heroui/react';

// Thin entry point for chips so the app's chip styling has one home. The
// only shared default today is the small size used by MediaCard's type /
// genre tags; HeroUI's `variant` ("soft" | "secondary" | …) and `color`
// still pass through untouched.
export type BlissChipProps = ComponentProps<typeof Chip>;

export function BlissChip({ size = 'sm', ...props }: BlissChipProps) {
  return <Chip size={size} {...props} />;
}
