import { Button } from '@heroui/react';
import { useState } from 'react';
import { useAuth } from '../../../context/AuthProvider';
import { useHomeCatalogContext } from '../../../context/HomeCatalogProvider';
import { useStorage } from '../../../context/StorageProvider';
import { resolveHomeRowOrder, type HomeRowPrefs } from '../../../lib/homeRows';
import { useErrorToast } from '../../../lib/useErrorToast';

export function HomeSettingsModal({ onClose }: { onClose: () => void }) {
  const { authKey } = useAuth();
  const { homeRowPrefs } = useStorage();
  const { homeRowOptions, saveHomeRowPrefs } = useHomeCatalogContext();
  const { order, hidden } = resolveHomeRowOrder(homeRowOptions, homeRowPrefs);
  const [draft, setDraft] = useState<HomeRowPrefs>(() => ({ order, hidden }));
  const [saveError, setSaveError] = useState<string | null>(null);

  useErrorToast(saveError, 'Home settings error');

  const toggleRow = (id: string) => {
    setDraft((prev) => ({
      ...prev,
      hidden: prev.hidden.includes(id)
        ? prev.hidden.filter((item) => item !== id)
        : [...prev.hidden, id],
    }));
  };

  const moveRow = (id: string, direction: 'up' | 'down') => {
    setDraft((prev) => {
      const idx = prev.order.indexOf(id);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.order.length) return prev;
      const next = [...prev.order];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return { ...prev, order: next };
    });
  };

  return (
    <div className="solid-surface mx-auto w-full max-w-lg rounded-[24px] bg-black/60 p-6">
      <div className="text-lg font-semibold">Customize Home</div>
      <div className="mt-1 text-sm text-foreground/60">Show, hide, and reorder home rows.</div>

      <div className="mt-4 space-y-2">
        {draft.order.map((id: string) => {
          const option = homeRowOptions.find((row) => row.id === id);
          if (!option) return null;
          const isHidden = draft.hidden.includes(id);
          return (
            <div
              key={id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{option.title}</div>
                <div className="text-xs text-foreground/50">{isHidden ? 'Hidden' : 'Visible'}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full bg-white/10"
                  onPress={() => moveRow(id, 'up')}
                >
                  Up
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full bg-white/10"
                  onPress={() => moveRow(id, 'down')}
                >
                  Down
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full bg-white/10"
                  onPress={() => toggleRow(id)}
                >
                  {isHidden ? 'Show' : 'Hide'}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex gap-2">
        <Button
          className="rounded-full bg-white text-black"
          onPress={async () => {
            if (!authKey) {
              setSaveError('Login required to sync settings');
              return;
            }
            try {
              setSaveError(null);
              await saveHomeRowPrefs(draft);
              onClose();
            } catch (err: unknown) {
              setSaveError(err instanceof Error ? err.message : 'Failed to save');
            }
          }}
        >
          Save
        </Button>
        <Button variant="ghost" className="rounded-full bg-white/10" onPress={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
