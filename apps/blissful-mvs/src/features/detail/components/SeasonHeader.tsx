import { Button, ListBox, Select } from '@heroui/react';
import { ArrowLeftIcon } from '../../../icons/ArrowLeftIcon';
import { ArrowRightIcon } from '../../../icons/ArrowRightIcon';
import { ChevronLeftIcon } from '../../../icons/ChevronLeftIcon';
import { ChevronRightIcon } from '../../../icons/ChevronRightIcon';

type SeasonHeaderProps = {
  isSeriesLike: boolean;
  rightMode: 'episodes' | 'streams';
  selectedVideoId: string | null;
  selectedEpisodeLabel: string | null;
  nextEpisode: { id: string } | null;
  onBackToEpisodes: () => void;
  onNextEpisode: () => void;
  season: number | null;
  seasonSelectItems: Array<{ key: string; label: string }>;
  onSeasonChange: (season: number) => void;
  canPrevSeason: boolean;
  canNextSeason: boolean;
  onPrevSeason: () => void;
  onNextSeason: () => void;
  className?: string;
};

export function SeasonHeader({
  isSeriesLike,
  rightMode,
  selectedVideoId,
  selectedEpisodeLabel,
  nextEpisode,
  onBackToEpisodes,
  onNextEpisode,
  season,
  seasonSelectItems,
  onSeasonChange,
  canPrevSeason,
  canNextSeason,
  onPrevSeason,
  onNextSeason,
  className,
}: SeasonHeaderProps) {
  if (!isSeriesLike) {
    return <div className={className ?? ''}><div className="p-3" /></div>;
  }

  return (
    <div className={className ?? ''}>
      {rightMode === 'streams' && selectedVideoId ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/15"
            onClick={onBackToEpisodes}
            aria-label="Back"
          >
            <ArrowLeftIcon className="h-6 w-6" />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white/85">
            {selectedEpisodeLabel ?? ''}
          </div>
          <button
            type="button"
            className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onNextEpisode}
            disabled={!nextEpisode}
            aria-label="Next episode"
          >
            <ArrowRightIcon className="h-6 w-6" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            className="rounded-full bg-white/10 text-white"
            isDisabled={!canPrevSeason}
            onPress={onPrevSeason}
            aria-label="Previous season"
          >
            <ChevronLeftIcon className="h-[18px] w-[18px]" />
          </Button>

          <div className="flex-1">
            <Select
              aria-label="Season"
              selectedKey={season === null ? undefined : String(season)}
              onSelectionChange={(key) => {
                if (key === null) return;
                const n = Number.parseInt(String(key), 10);
                if (Number.isFinite(n)) onSeasonChange(n);
              }}
            >
              <Select.Trigger className="bg-white/10 border border-white/10 rounded-full">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {seasonSelectItems.map((item) => (
                    <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                      {item.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>

          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            className="rounded-full bg-white/10 text-white"
            isDisabled={!canNextSeason}
            onPress={onNextSeason}
            aria-label="Next season"
          >
            <ChevronRightIcon className="h-[18px] w-[18px]" />
          </Button>
        </div>
      )}
    </div>
  );
}
