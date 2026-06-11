import { Input } from '@heroui/react';
import { cn } from '@heroui/styles';
import type { ComponentPropsWithoutRef } from 'react';

// The frosted text field used by the app's modal forms (add-addon, login,
// profile, nickname) — all shared the `bg-white/10 rounded-xl px-4 py-2`
// surface. This owns that default; per-field extras (focus ring, invalid
// state, width) still come from the call site and merge on top.
//
// NOTE: TopNav's search box is intentionally NOT this — it's a bespoke
// rounded-full pill driven by the `.bliss-nav-input` CSS class.
export type BlissInputProps = ComponentPropsWithoutRef<typeof Input>;

export function BlissInput({ className, ...props }: BlissInputProps) {
  return <Input className={cn('bg-white/10 rounded-xl px-4 py-2', className)} {...props} />;
}
