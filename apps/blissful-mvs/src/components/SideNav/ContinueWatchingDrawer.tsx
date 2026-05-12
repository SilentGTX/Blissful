import { createPortal } from 'react-dom';
import type { LibraryItem } from '../../lib/stremioApi';
import { ContinueWatchingItem } from './ContinueWatchingItem';

export type ContinueWatchingDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  items: LibraryItem[];
  userLabel: string | null;
  syncError?: string | null;
  onOpenItem: (item: LibraryItem) => void;
  onRemoveItem: (item: LibraryItem) => void;
};

export function ContinueWatchingDrawer({
  isOpen,
  onClose,
  items,
  userLabel,
  syncError: _syncError,
  onOpenItem,
  onRemoveItem,
}: ContinueWatchingDrawerProps) {
  if (!isOpen) return null;

  return createPortal(
    <>
      <div
        className="bliss-continue-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <div className="bliss-continue-drawer bliss-bottom-drawer solid-surface">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-foreground/50">Continue Watching</div>

        </div>

        <div className="mt-3 max-h-[70vh] space-y-2 overflow-auto pr-1 hide-scrollbar">
          {items.length === 0 ? (
            <div className="text-sm text-foreground/70">
              {userLabel ? 'Nothing in progress yet.' : 'Login to sync progress'}
            </div>
          ) : (
            items.map((item) => (
              <ContinueWatchingItem
                key={item._id}
                item={item}
                onOpen={() => {
                  onClose();
                  onOpenItem(item);
                }}
                onRemove={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemoveItem(item);
                }}
              />
            ))
          )}
        </div>
      </div>
    </>,
    document.body
  );
}
