import { proxiedImage } from '../../../lib/imageProxy';
import { normalizeStremioImage } from '../../../lib/mediaTypes';
import type { MediaItem } from '../../../types/media';

interface ModernCardProps {
  item: MediaItem;
  isSelected: boolean;
  onClick: () => void;
}

export function ModernCard({ item, onClick }: ModernCardProps) {
  const poster = normalizeStremioImage(item.posterUrl) ?? item.posterUrl;

  return (
    <div
      className="w-full h-full cursor-pointer rounded-xl overflow-hidden relative"
      style={{
        boxShadow: '0 4px 24px rgba(0,0,0,0.55)',
        transition: 'transform 180ms ease, box-shadow 180ms ease',
      }}
      onClick={onClick}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = 'scale(1.04)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = ''; }}
    >
      {poster ? (
        <img src={proxiedImage(poster)} className="w-full h-full object-cover block" loading="lazy" draggable={false} />
      ) : (
        <div className="w-full h-full bg-white/10 flex items-center justify-center text-white/40 text-xs px-3 text-center">
          {item.title}
        </div>
      )}
    </div>
  );
}
