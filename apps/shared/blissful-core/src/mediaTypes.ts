// Pure data helpers + structural types from the Stremio era. The
// actual `api.strem.io` network calls (login, datastoreGet/Put,
// addonCollectionGet/Set, …) were removed when Blissful's native auth
// took over — everything in this file is now offline / type-only.
// `LibraryItem` keeps its old shape because the library docs are
// still stored that way in Mongo, and the rest of the app destructures
// `state.timeOffset` / `state.lastWatched` / etc.

export type StremioApiUser = {
  _id: string;
  email?: string;
  fullname?: string;
  avatar?: string;
};

export type LibraryItemState = {
  timeOffset?: number;
  duration?: number;
  videoId?: string;
  video_id?: string | null;
  watched?: string | null;
  timesWatched?: number;

  // Additional fields preserved from the Stremio datastore shape.
  lastWatched?: string | null;
  timeWatched?: number;
  overallTimeWatched?: number;
  flaggedWatched?: number;
  lastVidReleased?: string | null;
  noNotif?: boolean;
};

export type LibraryItem = {
  _id: string;
  name: string;
  type: string;
  poster?: string | null;
  posterShape?: string;
  removed?: boolean;
  temp?: boolean;
  _ctime?: string | null;
  state?: LibraryItemState;
  _mtime?: string | number;
  behaviorHints?: {
    defaultVideoId?: string | null;
    featuredVideoId?: string | null;
    hasScheduledVideos?: boolean;
  };
  /** Set to 'stremio' by the server when this row's current state came
   *  from a Stremio pull. Cleared whenever Blissful's player writes new
   *  progress. Continue Watching badges items as Stremio-sourced based
   *  on this; stripped from the payload before pushing back to Stremio. */
  _blissProgressSource?: 'stremio' | null;
};

export type AddonDescriptor = {
  transportUrl: string;
  manifest?: {
    id?: string;
    name?: string;
    description?: string;
    resources?: Array<
      | string
      | {
        name: string;
        types?: string[];
        idPrefixes?: string[];
      }
    >;
    catalogs?: Array<{
      type: 'movie' | 'series' | 'channel' | string;
      id: string;
      name?: string;
    }>;
  };
};

export function getAddonDisplayName(addon: Pick<AddonDescriptor, 'transportUrl' | 'manifest'>): string {
  const manifestName = addon.manifest?.name?.trim();
  if (manifestName) return manifestName;

  if (/torrentio\.strem\.fun/i.test(addon.transportUrl)) {
    if (/realdebrid=/i.test(addon.transportUrl)) return 'Torrentio RD';
    return 'Torrentio';
  }

  return addon.transportUrl;
}

export function normalizeStremioImage(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}
