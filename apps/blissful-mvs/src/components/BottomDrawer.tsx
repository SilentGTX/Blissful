import { motion, type PanInfo } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useEffect, type ReactNode } from 'react';

type BottomDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export default function BottomDrawer({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  className,
  bodyClassName,
}: BottomDrawerProps) {
  useEffect(() => {
    if (!isOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <>
      <motion.div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur"
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
      />
      <motion.div
        drag="y"
        dragDirectionLock
        dragConstraints={{ top: 0, bottom: 260 }}
        dragElastic={0}
        dragMomentum={false}
        onDragEnd={(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
          if (info.offset.y > 95 || info.velocity.y > 700) {
            onClose();
          }
        }}
        initial={{ y: 180, opacity: 0.94 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 24, mass: 0.85 }}
        className={`fixed bottom-0 left-0 right-0 z-50 bliss-bottom-drawer solid-surface rounded-t-[28px] px-4 pt-4 pb-safe text-white ${className ?? ''}`}
        style={{ touchAction: 'none' }}
      >
        <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-white/15" />
        {(title || subtitle) ? (
          <div className="mx-auto w-full max-w-[520px]">
            {title ? <div className="text-xs font-semibold tracking-wide text-white/60">{title}</div> : null}
            {subtitle ? <div className="mt-1 text-sm font-semibold text-white/90">{subtitle}</div> : null}
            <div className="mt-3 h-px w-full bg-white/12" />
          </div>
        ) : null}
        <div className={`mx-auto w-full max-w-[520px] ${bodyClassName ?? ''}`}>{children}</div>
      </motion.div>
    </>,
    document.body
  );
}
