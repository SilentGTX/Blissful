import type { ComponentProps } from 'react';
import { Modal } from '@heroui/react';
import { cn } from '@heroui/styles';

// Blissful's modals follow one canonical shape: a blurred backdrop, a
// centered container, and a TRANSPARENT dialog (bg-transparent shadow-none)
// whose visible content is a separate `solid-surface` card nested inside.
// This wrapper bakes those defaults so call sites stop repeating them:
//   - Backdrop defaults to variant="blur"
//   - Container defaults to placement="center"
//   - Dialog defaults to the invisible-frame "bg-transparent shadow-none"
//   - Card is the frosted content surface every modal draws inside the frame
// Everything else (size, custom bg opacity, the controlled isOpen/onOpenChange)
// passes straight through, and call-site classes merge on top.
function ModalRoot(props: ComponentProps<typeof Modal>) {
  return <Modal {...props} />;
}

function Backdrop({ variant = 'blur', ...props }: ComponentProps<typeof Modal.Backdrop>) {
  return <Modal.Backdrop variant={variant} {...props} />;
}

function Container({ placement = 'center', ...props }: ComponentProps<typeof Modal.Container>) {
  return <Modal.Container placement={placement} {...props} />;
}

function Dialog({ className, ...props }: ComponentProps<typeof Modal.Dialog>) {
  return <Modal.Dialog className={cn('bg-transparent shadow-none', className)} {...props} />;
}

// The frosted content card most modals render inside the transparent
// Dialog. Defaults to the app's large-corner glass surface; override the
// radius / fill via className (e.g. rounded-[20px], bg-[#101116]).
function ModalCard({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('solid-surface rounded-[28px] bg-white/10 p-6', className)} {...props} />;
}

export const BlissModal = Object.assign(ModalRoot, {
  Trigger: Modal.Trigger,
  Backdrop,
  Container,
  Dialog,
  Header: Modal.Header,
  Heading: Modal.Heading,
  Body: Modal.Body,
  Footer: Modal.Footer,
  CloseTrigger: Modal.CloseTrigger,
  Card: ModalCard,
});
