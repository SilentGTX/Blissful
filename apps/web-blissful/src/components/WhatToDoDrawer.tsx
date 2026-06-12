import { useEffect, useState } from 'react';
import BottomDrawer from './BottomDrawer';

export type WhatToDoPrompt = {
  title: string;
  url: string | null;
  playerLink: string | null;
  metaLine?: string | null;
  metaParts?: string[];
  itemInfo?: { id: string; type: string; name: string; videoId?: string | null };
} | null;

type WhatToDoDrawerProps = {
  isOpen: boolean;
  prompt: WhatToDoPrompt;
  onClose: () => void;
  onPlayVlc: (url: string, itemInfo?: { id: string; type: string; name: string; videoId?: string | null }) => void;
  onPlayWeb: (playerLink: string) => void;
};

export default function WhatToDoDrawer({
  isOpen,
  prompt,
  onClose,
  onPlayVlc,
  onPlayWeb,
}: WhatToDoDrawerProps) {
  const [isMobileViewport, setIsMobileViewport] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobileViewport(media.matches);
    update();
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
    };
  }, []);

  if (!prompt || !isOpen) return null;

  return (
    <BottomDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="What to do"
      subtitle="Choose where to play"
      bodyClassName="overflow-hidden pb-4"
    >
      <div className="mt-2 truncate text-xs text-white/60" title={prompt.title}>
        {prompt.title}
      </div>

      {((prompt.metaParts && prompt.metaParts.length > 0) || prompt.metaLine) ? (
        <div
          className="mt-1 flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/55"
          title={prompt.metaLine ?? ''}
        >
          {prompt.metaParts && prompt.metaParts.length > 0 ? (
            prompt.metaParts.map((part) => (
              <div key={part} className="min-w-0 truncate">
                {part}
              </div>
            ))
          ) : (
            <div className="min-w-0 flex-1 truncate">{prompt.metaLine}</div>
          )}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          className={
            'w-full rounded-2xl px-4 py-3 text-left font-semibold ' +
            (prompt.url
              ? 'bg-orange-500/20 text-orange-300 hover:bg-orange-500/30'
              : 'cursor-not-allowed bg-white/5 text-white/30')
          }
          onClick={() => {
            if (!prompt.url) return;
            onPlayVlc(prompt.url, prompt.itemInfo);
          }}
        >
          Play in VLC
        </button>
        {!prompt.url ? (
          <div className="px-1 text-xs text-white/50">No direct URL for VLC on this stream.</div>
        ) : null}
        {!isMobileViewport ? (
          <button
            type="button"
            className={
              'w-full rounded-2xl px-4 py-3 text-left font-semibold ' +
              (prompt.playerLink
                ? 'bg-white/10 text-white hover:bg-white/15'
                : 'cursor-not-allowed bg-white/5 text-white/30')
            }
            onClick={() => {
              if (!prompt.playerLink) return;
              onPlayWeb(prompt.playerLink);
            }}
          >
            {prompt.playerLink ? 'Play in Web Player' : 'Loading...'}
          </button>
        ) : null}
      </div>
      <div className="h-2" />
    </BottomDrawer>
  );
}
