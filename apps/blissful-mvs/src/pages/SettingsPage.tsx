import { useMemo, useState } from 'react';
import { Checkbox, ListBox, ScrollShadow, Select } from '@heroui/react';
import { ChromePicker, type ColorResult } from 'react-color';
import { useStorage } from '../context/StorageProvider';
import { useUI } from '../context/UIProvider';
import {
  EXTERNAL_PLAYER_OPTIONS,
  NEXT_VIDEO_POPUP_OPTIONS_MS,
  PLAYER_LANGUAGE_OPTIONS,
  SEEK_SHORT_TIME_DURATION_OPTIONS_MS,
  SEEK_TIME_DURATION_OPTIONS_MS,
  STREAMING_CACHE_SIZE_OPTIONS,
  SUBTITLE_SIZE_OPTIONS_PX,
  type PlayerSettings,
} from '../lib/playerSettings';

const triggerClassName = 'bg-white/10 border border-white/10 rounded-full h-9 text-white';

export default function SettingsPage() {
  const { uiStyle, setUiStyle } = useUI();
  const { playerSettings, savePlayerSettings } = useStorage();
  const [colorModal, setColorModal] = useState<'text' | 'bg' | 'outline' | null>(null);

  const updateSettings = (next: Partial<PlayerSettings>) => {
    void savePlayerSettings({ ...playerSettings, ...next });
  };

  const seekLabel = useMemo(
    () => (value: number) => `${Math.round(value / 1000)} sec`,
    []
  );

  const languageItems = useMemo(
    () =>
      [{ key: 'none', label: 'None' }].concat(
        PLAYER_LANGUAGE_OPTIONS.filter((opt) => opt.value).map((opt) => ({
          key: String(opt.value),
          label: opt.label,
        }))
      ),
    []
  );

  const sizeItems = useMemo(
    () => SUBTITLE_SIZE_OPTIONS_PX.map((size) => ({ key: String(size), label: `${size}px` })),
    []
  );

  const seekItems = useMemo(
    () =>
      SEEK_TIME_DURATION_OPTIONS_MS.map((value) => ({
        key: String(value),
        label: seekLabel(value),
      })),
    [seekLabel]
  );

  const seekShiftItems = useMemo(
    () =>
      SEEK_SHORT_TIME_DURATION_OPTIONS_MS.map((value) => ({
        key: String(value),
        label: seekLabel(value),
      })),
    [seekLabel]
  );

  const nextPopupItems = useMemo(
    () =>
      NEXT_VIDEO_POPUP_OPTIONS_MS.map((value) => ({
        key: String(value),
        label: value === 0 ? 'Disabled' : seekLabel(value),
      })),
    [seekLabel]
  );

  const externalPlayerItems = useMemo(
    () => EXTERNAL_PLAYER_OPTIONS.map((opt) => ({ key: opt.value, label: opt.label })),
    []
  );

  // `null` is a valid cache size (= unlimited) so we map it to the
  // string 'unlimited' for the select key. 0 stays as '0' (no caching).
  const cacheSizeItems = useMemo(
    () =>
      STREAMING_CACHE_SIZE_OPTIONS.map((opt) => ({
        key: opt.value === null ? 'unlimited' : String(opt.value),
        label: opt.label,
      })),
    []
  );

  const parseColor = (value: string) => {
    const hexMatch = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (hexMatch) {
      return { hex: `#${hexMatch[1]}`, alpha: 1 };
    }
    const rgbaMatch =
      /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\)$/i.exec(value.trim()) ||
      /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i.exec(value.trim());
    if (rgbaMatch) {
      const r = Math.min(255, Math.max(0, Number(rgbaMatch[1])));
      const g = Math.min(255, Math.max(0, Number(rgbaMatch[2])));
      const b = Math.min(255, Math.max(0, Number(rgbaMatch[3])));
      const alpha = rgbaMatch[4] ? Math.min(1, Math.max(0, Number(rgbaMatch[4]))) : 1;
      const hex = `#${[r, g, b]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')}`;
      return { hex, alpha };
    }
    return { hex: '#ffffff', alpha: 1 };
  };

  const buildRgba = (hex: string, alpha: number) => {
    const cleaned = hex.replace('#', '');
    if (cleaned.length !== 6) return hex;
    const r = parseInt(cleaned.slice(0, 2), 16);
    const g = parseInt(cleaned.slice(2, 4), 16);
    const b = parseInt(cleaned.slice(4, 6), 16);
    const safeAlpha = Math.min(1, Math.max(0, alpha));
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
  };

  const hexToRgb = (hex: string) => {
    const cleaned = hex.replace('#', '');
    if (cleaned.length !== 6) return { r: 255, g: 255, b: 255 };
    return {
      r: parseInt(cleaned.slice(0, 2), 16),
      g: parseInt(cleaned.slice(2, 4), 16),
      b: parseInt(cleaned.slice(4, 6), 16),
    };
  };

  const subtitleTextColor = parseColor(playerSettings.subtitlesTextColor);
  const subtitleBgColor = parseColor(playerSettings.subtitlesBackgroundColor);
  const subtitleOutlineColor = parseColor(playerSettings.subtitlesOutlineColor);

  const activeColor = colorModal === 'text'
    ? subtitleTextColor
    : colorModal === 'bg'
      ? subtitleBgColor
      : colorModal === 'outline'
        ? subtitleOutlineColor
        : null;

  const updateColor = (key: 'text' | 'bg' | 'outline', hex: string, alpha: number) => {
    const rgba = buildRgba(hex, alpha);
    if (key === 'text') updateSettings({ subtitlesTextColor: rgba });
    if (key === 'bg') updateSettings({ subtitlesBackgroundColor: rgba });
    if (key === 'outline') updateSettings({ subtitlesOutlineColor: rgba });
  };

  return (
    <>
      <div className="mt-4">
        <div className="solid-surface rounded-[28px] bg-white/6 p-6 ">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-[Fraunces] text-2xl font-semibold">Settings</div>
              <div className="text-sm text-foreground/60">Customize your experience</div>
            </div>
          </div>

          <ScrollShadow className="mt-6 max-h-[calc(100vh-14rem)] space-y-6 pr-1" hideScrollBar>
            <div>
              <div className="text-lg font-semibold mb-3">Style</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  className={
                    'rounded-2xl border px-4 py-4 text-left transition ' +
                    (uiStyle === 'classic'
                      ? 'border-white bg-white/15 text-white'
                      : 'border-white/10 bg-white/5 text-foreground/70 hover:bg-white/10')
                  }
                  onClick={() => setUiStyle('classic')}
                >
                  <div className="text-sm font-semibold">Classic</div>
                  <div className="mt-1 text-xs text-foreground/60">
                    Solid surfaces with simple layout.
                  </div>
                </button>
                <button
                  type="button"
                  className={
                    'rounded-2xl border px-4 py-4 text-left transition ' +
                    (uiStyle === 'netflix'
                      ? 'border-white bg-white/15 text-white'
                      : 'border-white/10 bg-white/5 text-foreground/70 hover:bg-white/10')
                  }
                  onClick={() => setUiStyle('netflix')}
                >
                  <div className="text-sm font-semibold">Kecflix</div>
                  <div className="mt-1 text-xs text-foreground/60">
                    Dark UI with Kecflix-style navigation and rails.
                  </div>
                </button>
              </div>
            </div>

            <div className="text-sm text-foreground/60">
              Solid colors only (background gradients removed).
            </div>

            <div>
              <div className="text-lg font-semibold mb-3">Player</div>
              <div className="space-y-6">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Subtitles</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Language</div>
                      <Select
                        aria-label="Subtitles language"
                        selectedKey={playerSettings.subtitlesLanguage ?? 'none'}
                        onSelectionChange={(key) => {
                          updateSettings({ subtitlesLanguage: key === 'none' ? null : String(key) });
                        }}
                      >
                        <Select.Trigger className={triggerClassName}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {languageItems.map((item) => (
                              <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                                {item.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Size</div>
                      <Select
                        aria-label="Subtitles size"
                        selectedKey={String(playerSettings.subtitlesSizePx)}
                        onSelectionChange={(key) => {
                          updateSettings({ subtitlesSizePx: Number.parseInt(String(key), 10) });
                        }}
                      >
                        <Select.Trigger className={triggerClassName}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {sizeItems.map((item) => (
                              <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                                {item.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Text color</div>
                      <button
                        type="button"
                        className="flex w-full items-center justify-end rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
                        onClick={() => setColorModal('text')}
                      >
                        {subtitleTextColor.alpha === 0 ? (
                          <span className="text-xs text-foreground/70">transparent</span>
                        ) : (
                          <span
                            className="h-5 w-full rounded-full border border-white/20"
                            style={{ background: subtitleTextColor.hex }}
                          />
                        )}
                      </button>
                    </div>
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Background color</div>
                      <button
                        type="button"
                        className="flex w-full items-center justify-end rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
                        onClick={() => setColorModal('bg')}
                      >
                        {subtitleBgColor.alpha === 0 ? (
                          <span className="text-xs text-foreground/70">transparent</span>
                        ) : (
                          <span
                            className="h-5 w-full rounded-full border border-white/20"
                            style={{ background: subtitleBgColor.hex }}
                          />
                        )}
                      </button>
                    </div>
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Outline color</div>
                      <button
                        type="button"
                        className="flex w-full items-center justify-end rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
                        onClick={() => setColorModal('outline')}
                      >
                        {subtitleOutlineColor.alpha === 0 ? (
                          <span className="text-xs text-foreground/70">transparent</span>
                        ) : (
                          <span
                            className="h-5 w-full rounded-full border border-white/20"
                            style={{ background: subtitleOutlineColor.hex }}
                          />
                        )}
                      </button>
                    </div>

                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Audio</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Default audio track</div>
                      <Select
                        aria-label="Audio language"
                        selectedKey={playerSettings.audioLanguage ?? 'none'}
                        onSelectionChange={(key) => {
                          updateSettings({ audioLanguage: key === 'none' ? null : String(key) });
                        }}
                      >
                        <Select.Trigger className={triggerClassName}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {languageItems.map((item) => (
                              <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                                {item.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>

                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Controls</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Seek key</div>
                      <Select
                        aria-label="Seek key"
                        selectedKey={String(playerSettings.seekTimeDurationMs)}
                        onSelectionChange={(key) => {
                          updateSettings({ seekTimeDurationMs: Number.parseInt(String(key), 10) });
                        }}
                      >
                        <Select.Trigger className={triggerClassName}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {seekItems.map((item) => (
                              <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                                {item.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Seek key + Shift</div>
                      <Select
                        aria-label="Seek key shift"
                        selectedKey={String(playerSettings.seekShortTimeDurationMs)}
                        onSelectionChange={(key) => {
                          updateSettings({ seekShortTimeDurationMs: Number.parseInt(String(key), 10) });
                        }}
                      >
                        <Select.Trigger className={triggerClassName}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {seekShiftItems.map((item) => (
                              <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                                {item.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>

                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Auto Play</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Checkbox
                      className="text-sm text-foreground/70"
                      isSelected={playerSettings.bingeWatching}
                      onChange={(value) => updateSettings({ bingeWatching: Boolean(value) })}
                    >
                      Auto play next video
                    </Checkbox>
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Next video popup</div>
                      <Select
                        aria-label="Next video popup"
                        selectedKey={String(playerSettings.nextVideoNotificationDurationMs)}
                        onSelectionChange={(key) => {
                          updateSettings({
                            nextVideoNotificationDurationMs: Number.parseInt(String(key), 10),
                          });
                        }}
                      >
                        <Select.Trigger className={triggerClassName}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {nextPopupItems.map((item) => (
                              <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                                {item.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Streaming server</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Cache size</div>
                      <Select
                        aria-label="Cache size"
                        selectedKey={
                          playerSettings.streamingServerCacheSizeBytes === null
                            ? 'unlimited'
                            : String(playerSettings.streamingServerCacheSizeBytes)
                        }
                        onSelectionChange={(key) => {
                          if (typeof key !== 'string') return;
                          const next =
                            key === 'unlimited' ? null : Number.parseInt(key, 10);
                          if (key !== 'unlimited' && !Number.isFinite(next)) return;
                          updateSettings({
                            streamingServerCacheSizeBytes:
                              key === 'unlimited' ? null : (next as number),
                          });
                        }}
                      >
                        <Select.Trigger className={triggerClassName}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {cacheSizeItems.map((item) => (
                              <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                                {item.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                      <div className="mt-2 text-xs text-foreground/50">
                        Maximum disk space the torrent cache may grow to.
                        Only fills as you stream. Larger values reduce
                        cache trims at playback start.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-sm font-semibold mb-3">Advanced</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs text-foreground/60 mb-2">Play in external player</div>
                      <Select
                        aria-label="External player"
                        selectedKey={playerSettings.playInExternalPlayer}
                        onSelectionChange={(key) => {
                          if (typeof key === 'string') updateSettings({ playInExternalPlayer: key });
                        }}
                      >
                        <Select.Trigger className={triggerClassName}>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            {externalPlayerItems.map((item) => (
                              <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                                {item.label}
                              </ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>

                    <div className="md:col-span-2">
                      <div className="text-xs text-foreground/60 mb-2">TMDB API key</div>
                      <input
                        type="text"
                        value={playerSettings.tmdbApiKey}
                        onChange={(e) => updateSettings({ tmdbApiKey: e.target.value.trim() })}
                        placeholder="paste your TMDB v3 API key"
                        autoComplete="off"
                        spellCheck={false}
                        className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-foreground/90 placeholder:text-foreground/40 focus:border-[var(--bliss-teal)] focus:outline-none"
                      />
                      <div className="mt-2 text-xs text-foreground/50">
                        Used as a rating fallback for posters where
                        IMDB doesn't have a rating yet (typically new
                        releases under IMDB's vote threshold). Free
                        key at{' '}
                        <a
                          href="https://www.themoviedb.org/settings/api"
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--bliss-teal)] underline-offset-2 hover:underline"
                        >
                          themoviedb.org/settings/api
                        </a>
                        . Leave blank to disable.
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            </div>
          </ScrollShadow>
        </div>
      </div>
      {colorModal && activeColor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="solid-surface w-full max-w-sm rounded-[24px] bg-black/70 p-6 text-center">
            <div className="text-lg font-semibold">Pick color</div>

            <div className="mt-4 flex justify-center">
              <ChromePicker
                color={{
                  ...hexToRgb(activeColor.hex),
                  a: activeColor.alpha,
                }}
              onChange={(color: ColorResult) => updateColor(colorModal, color.hex, color.rgb.a ?? 1)}
                disableAlpha={false}
              />
            </div>
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                className="rounded-full bg-white/10 px-4 py-2 text-sm text-white"
                onClick={() => setColorModal(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
