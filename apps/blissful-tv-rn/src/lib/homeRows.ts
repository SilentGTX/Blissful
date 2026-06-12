// Home-row identity + ordering — ported 1:1 from apps/blissful-mvs/src/lib/homeRows.ts
// (the Windows app). Keeping the row IDs byte-identical means a user's customize-home
// prefs (the { order, hidden } id lists) round-trip between the Windows app and this
// TV app through the same blissful-storage /state.homeRowPrefs document.
//
// Pure functions only — the persistence (read/write of /state.homeRowPrefs + the local
// kv cache) lives in lib/addons.ts next to the other /state I/O.
import type { AddonDescriptor } from '@blissful/core';

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

export function buildAddonRowId(transportUrl: string, type: string, id: string): string {
  return `addon:${encodeURIComponent(transportUrl)}:${type}:${id}`;
}

// Popular Movies/Series + one row per addon — the addon's FIRST catalog that has
// both a type and an id (same rule as the web). The Popular titles use this app's
// rail labels ("Popular Movies"/"Popular Series") rather than the web's
// "Popular - Movie" so the modal label matches the rendered rail; the IDs stay
// identical to the web for cross-device sync.
export function getHomeRowOptions(addons: AddonDescriptor[]): HomeRowOption[] {
  const rows: HomeRowOption[] = [
    { id: HOME_ROW_POPULAR_MOVIE, title: 'Popular Movies' },
    { id: HOME_ROW_POPULAR_SERIES, title: 'Popular Series' },
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

// Reconcile saved prefs against the currently-available rows: keep the user's order
// (dropping ids for uninstalled addons), append any newly-available row at the end,
// and drop stale hidden ids. Default prefs ({ order: [], hidden: [] }) ⇒ every row in
// getHomeRowOptions order, nothing hidden.
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
