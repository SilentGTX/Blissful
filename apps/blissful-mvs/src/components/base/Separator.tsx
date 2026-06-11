import type { ComponentProps } from 'react';
import { Separator } from '@heroui/react';
import { cn } from '@heroui/styles';

// Every divider in the app (dropdown menu sections, stream-row list) used
// the identical `my-1 bg-white/10` glass hairline. This owns that default
// so new dividers match automatically; call-site classes still merge on
// top (e.g. to drop the margin or change opacity).
export type BlissSeparatorProps = ComponentProps<typeof Separator>;

export function BlissSeparator({ className, ...props }: BlissSeparatorProps) {
  return <Separator className={cn('my-1 bg-white/10', className)} {...props} />;
}
