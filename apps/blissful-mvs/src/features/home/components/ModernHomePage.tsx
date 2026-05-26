import { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { fetchMeta } from '../../../lib/stremioAddon';
import type { StremioMetaDetail } from '../../../lib/stremioAddon';
import type { MediaItem } from '../../../types/media';
import { useStorage } from '../../../context/StorageProvider';
import { useModals } from '../../../context/ModalsProvider';
import { normalizeStremioImage } from '../../../lib/mediaTypes';
import { ModernRow } from './ModernRow';
import { ModernHeroPanel } from './ModernHeroPanel';

const metaCache = new Map<string, StremioMetaDetail>();

interface ModernHomePageProps {
  rows: { id: string; title: string; items: MediaItem[] }[];
  continueItems: MediaItem[];
  onItemClick: (item: MediaItem) => void;
}

export function ModernHomePage({ rows, continueItems, onItemClick }: ModernHomePageProps) {
  const { userProfile } = useStorage();
  const { openAccount } = useModals();
  const [selectedItem, setSelectedItem] = useState<MediaItem | null>(null);
  const [selectedMeta, setSelectedMeta] = useState<StremioMetaDetail | null>(null);

  useEffect(() => {
    if (!selectedItem) { setSelectedMeta(null); return; }
    const cached = metaCache.get(selectedItem.id);
    if (cached) { setSelectedMeta(cached); return; }
    let cancelled = false;
    fetchMeta({ type: selectedItem.type, id: selectedItem.id })
      .then((m) => {
        if (cancelled) return;
        metaCache.set(selectedItem.id, m);
        setSelectedMeta(m);
      })
      .catch(() => { if (!cancelled) setSelectedMeta(null); });
    return () => { cancelled = true; };
  }, [selectedItem]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedItem(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const allRows = [
    ...(continueItems.length > 0 ? [{ id: '__continue__', title: 'Continue Watching', items: continueItems }] : []),
    ...rows,
  ];

  const avatarSrc = normalizeStremioImage(userProfile?.avatar) ?? userProfile?.avatar;

  return (
    <div className="h-full w-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between shrink-0 px-6 py-5">
        <div className="flex-1 flex justify-center">
          <span className="font-[Instrument_Serif] text-white text-xl font-semibold tracking-wide select-none">
            Blissful
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          {avatarSrc ? (
            <img src={avatarSrc} className="w-8 h-8 rounded-full object-cover" alt=""
              onClick={openAccount}
              style={{ cursor: 'pointer' }}
            />
          ) : (
            <div
              className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/50 text-sm cursor-pointer"
              onClick={openAccount}
            >?</div>
          )}
        </div>
      </header>

      {/* Snap-scroll rows */}
      <div className="flex-1 min-h-0 overflow-y-scroll hide-scrollbar snap-y snap-mandatory">
        {allRows.map((row) => (
          <ModernRow
            key={row.id}
            title={row.title}
            items={row.items}
            selectedItem={selectedItem}
            onSelect={setSelectedItem}
          />
        ))}
      </div>

      {/* Hero overlay */}
      <AnimatePresence>
        {selectedItem && (
          <ModernHeroPanel
            key={selectedItem.id}
            item={selectedItem}
            meta={selectedMeta}
            onClose={() => setSelectedItem(null)}
            onPlay={onItemClick}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
