import type { AddonDescriptor } from './stremioApi';

export const HOME_ROW_POPULAR_MOVIE = 'popular:movie';
export const HOME_ROW_POPULAR_SERIES = 'popular:series';

export type HomeRowOption = {
  id: string;
  title: string;
};

export type HomeRowPrefs = {
  order: string[];
  hidden: string[];
};

export function buildAddonRowId(transportUrl: string, type: string, id: string) {
  return `addon:${encodeURIComponent(transportUrl)}:${type}:${id}`;
}

export function getHomeRowOptions(addons: AddonDescriptor[]): HomeRowOption[] {
  const rows: HomeRowOption[] = [
    { id: HOME_ROW_POPULAR_MOVIE, title: 'Popular - Movie' },
    { id: HOME_ROW_POPULAR_SERIES, title: 'Popular - Series' },
  ];

  addons.forEach((addon) => {
    const manifest = addon.manifest;
    if (!manifest?.catalogs?.length) return;
    const catalog = manifest.catalogs.find((entry) => entry.id && entry.type);
    if (!catalog) return;
    rows.push({
      id: buildAddonRowId(addon.transportUrl, catalog.type, catalog.id),
      title: `${manifest.name ?? 'Addon'} - ${catalog.name ?? catalog.id}`,
    });
  });

  return rows;
}

export function resolveHomeRowOrder(options: HomeRowOption[], prefs: HomeRowPrefs) {
  const availableIds = options.map((option) => option.id);
  const ordered = prefs.order.filter((id) => availableIds.includes(id));
  const missing = availableIds.filter((id) => !ordered.includes(id));
  const hidden = prefs.hidden.filter((id) => availableIds.includes(id));
  return {
    order: [...ordered, ...missing],
    hidden,
  };
}
