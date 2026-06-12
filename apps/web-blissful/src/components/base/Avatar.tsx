import type { ComponentProps } from 'react';
import { Avatar } from '@heroui/react';
import { cn } from '@heroui/styles';

// Blissful treats Avatar as a transparent shell: no circular crop, no
// background, no border — the profile artwork (often non-square) just
// shows through. Every call site repeated `bg-transparent rounded-none`
// on the root, `object-contain` on the image, and
// `border-none bg-transparent text-white` on the fallback. Those defaults
// live here now; call sites keep their conditional image/fallback
// structure and only pass size (h-10 w-10, …) on top.
function AvatarRoot({ className, ...props }: ComponentProps<typeof Avatar>) {
  return <Avatar className={cn('bg-transparent rounded-none', className)} {...props} />;
}

function AvatarImage({ className, ...props }: ComponentProps<typeof Avatar.Image>) {
  return <Avatar.Image className={cn('object-contain', className)} {...props} />;
}

function AvatarFallback({ className, ...props }: ComponentProps<typeof Avatar.Fallback>) {
  return (
    <Avatar.Fallback className={cn('border-none bg-transparent text-white', className)} {...props} />
  );
}

export const BlissAvatar = Object.assign(AvatarRoot, {
  Image: AvatarImage,
  Fallback: AvatarFallback,
});
