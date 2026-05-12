export type StremioApiUser = {
  _id: string;
  email?: string;
  lastModified?: string;
};

export type StremioLoginResult = {
  authKey: string;
  user: StremioApiUser;
};

export type StremioApiResponse<T> = {
  result?: T;
  error?: { message?: string };
};

const API_ENDPOINT = 'https://api.strem.io/api';

async function post<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_ENDPOINT}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    throw new Error(`Stremio API ${method} failed (${res.status})`);
  }

  const json = (await res.json()) as StremioApiResponse<T>;
  if (json.error) {
    throw new Error(json.error.message || `Stremio API ${method} error`);
  }
  if (!json.result) {
    throw new Error(`Stremio API ${method} returned no result`);
  }
  return json.result;
}

export async function loginWithEmail(params: {
  email: string;
  password: string;
  facebook?: boolean;
}): Promise<StremioLoginResult> {
  return post<StremioLoginResult>('login', {
    email: params.email,
    password: params.password,
    facebook: Boolean(params.facebook),
  });
}

export async function registerWithEmail(params: {
  email: string;
  password: string;
}): Promise<StremioLoginResult> {
  return post<StremioLoginResult>('register', {
    email: params.email,
    password: params.password,
  });
}

export type LibraryItemState = {
  timeOffset?: number;
  duration?: number;
  videoId?: string;
  video_id?: string | null;
  watched?: string | null;
  timesWatched?: number;

  // Additional Stremio core fields (present in datastore)
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
};

export type DatastoreGetResult = {
  items: LibraryItem[];
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

export async function datastoreGetLibraryItems(params: {
  authKey: string;
  signal?: AbortSignal;
}): Promise<LibraryItem[]> {
  // Collection name is "libraryItem" in Stremio core.
  const result = await post<unknown>('datastoreGet', {
    authKey: params.authKey,
    collection: 'libraryItem',
    ids: [],
    all: true,
  }, params.signal);

  if (Array.isArray(result)) {
    return result as LibraryItem[];
  }

  if (result && typeof result === 'object' && Array.isArray((result as DatastoreGetResult).items)) {
    return (result as DatastoreGetResult).items;
  }

  return [];
}

export async function datastoreGetLibraryItemById(params: {
  authKey: string;
  id: string;
}): Promise<LibraryItem | null> {
  const result = await post<unknown>('datastoreGet', {
    authKey: params.authKey,
    collection: 'libraryItem',
    ids: [params.id],
    all: false,
  });

  const items = Array.isArray(result)
    ? (result as LibraryItem[])
    : result && typeof result === 'object' && Array.isArray((result as DatastoreGetResult).items)
      ? (result as DatastoreGetResult).items
      : [];

  return items.find((item) => item && item._id === params.id) ?? null;
}

export async function getUser(params: { authKey: string; signal?: AbortSignal }): Promise<StremioApiUser> {
  return post<StremioApiUser>('getUser', { authKey: params.authKey }, params.signal);
}

export async function addonCollectionGet(params: {
  authKey: string;
  signal?: AbortSignal;
}): Promise<AddonDescriptor[]> {
  const result = await post<{ addons?: AddonDescriptor[] }>('addonCollectionGet', {
    authKey: params.authKey,
    update: true,
  }, params.signal);
  return Array.isArray(result.addons) ? result.addons : [];
}

export async function addonCollectionSet(params: {
  authKey: string;
  addons: AddonDescriptor[];
}): Promise<void> {
  await post('addonCollectionSet', {
    authKey: params.authKey,
    addons: params.addons,
  });
}

export type DatastoreItem<T> = {
  _id: string;
  data: T;
};

export async function datastoreGetCollection<T>(params: {
  authKey: string;
  collection: string;
}): Promise<DatastoreItem<T>[]> {
  const result = await post<unknown>('datastoreGet', {
    authKey: params.authKey,
    collection: params.collection,
    ids: [],
    all: true,
  });

  if (Array.isArray(result)) {
    return result as DatastoreItem<T>[];
  }

  if (result && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)) {
    return (result as { items: DatastoreItem<T>[] }).items;
  }

  return [];
}

export async function datastorePutCollection<T>(params: {
  authKey: string;
  collection: string;
  items: DatastoreItem<T>[];
}): Promise<void> {
  await post('datastorePut', {
    authKey: params.authKey,
    collection: params.collection,
    changes: params.items,
  });
}

// Stremio core uses a special schema for "libraryItem" (not wrapped in {data}).
export async function datastorePutLibraryItems(params: {
  authKey: string;
  changes: Array<Partial<LibraryItem> & { _id: string }>;
}): Promise<void> {
  await post('datastorePut', {
    authKey: params.authKey,
    collection: 'libraryItem',
    changes: params.changes,
  });
}

export async function rewindLibraryItem(params: {
  authKey: string;
  id: string;
}): Promise<void> {
  // Match stremio-core behavior: write a full "libraryItem" change with a bumped _mtime
  // and a reset LibraryItemState, so other Stremio clients don't overwrite it as "older".
  const existing = await datastoreGetLibraryItemById({ authKey: params.authKey, id: params.id });
  const nowIso = new Date().toISOString();

  if (!existing) {
    await datastorePutLibraryItems({
      authKey: params.authKey,
      changes: [{ _id: params.id, state: { timeOffset: 0 } }],
    });
    return;
  }

  await datastorePutLibraryItems({
    authKey: params.authKey,
    changes: [
      {
        _id: existing._id,
        name: existing.name,
        type: existing.type,
        poster: existing.poster ?? null,
        posterShape: existing.posterShape ?? 'poster',
        removed: Boolean(existing.removed),
        temp: Boolean(existing.temp),
        _ctime: typeof existing._ctime === 'string' ? existing._ctime : null,
        _mtime: nowIso,
        state: {
          lastWatched: null,
          timeWatched: 0,
          timeOffset: 0,
          overallTimeWatched: 0,
          timesWatched: 0,
          flaggedWatched: 0,
          duration: 0,
          video_id: null,
          watched: null,
          lastVidReleased: null,
          noNotif: false,
        },
        behaviorHints: {
          defaultVideoId: existing.behaviorHints?.defaultVideoId ?? null,
          featuredVideoId: existing.behaviorHints?.featuredVideoId ?? null,
          hasScheduledVideos: Boolean(existing.behaviorHints?.hasScheduledVideos),
        },
      },
    ],
  });

  // Sanity check: ensure the rewind persisted.
  const updated = await datastoreGetLibraryItemById({ authKey: params.authKey, id: params.id });
  const updatedOffset = updated?.state?.timeOffset;
  if (typeof updatedOffset === 'number' && updatedOffset > 0) {
    throw new Error('Rewind did not persist (timeOffset still > 0)');
  }
}

export async function updateLibraryItemProgress(params: {
  authKey: string;
  id: string;
  type: LibraryItem['type'];
  videoId?: string | null;
  timeSeconds: number;
  durationSeconds?: number;
}): Promise<void> {
  const normalizedType = params.type === 'anime' ? 'series' : params.type;
  const existing = await datastoreGetLibraryItemById({ authKey: params.authKey, id: params.id });
  if (!existing) return;

  const nowIso = new Date().toISOString();
  const timeOffset = Math.max(0, Math.round(params.timeSeconds * 1000));
  const duration =
    typeof params.durationSeconds === 'number' && Number.isFinite(params.durationSeconds) && params.durationSeconds > 0
      ? Math.max(0, Math.round(params.durationSeconds * 1000))
      : 0;

  await datastorePutLibraryItems({
    authKey: params.authKey,
    changes: [
      {
        _id: existing._id,
        name: existing.name,
        type: normalizedType,
        poster: existing.poster ?? null,
        posterShape: existing.posterShape ?? 'poster',
        removed: Boolean(existing.removed),
        temp: Boolean(existing.temp),
        _ctime: typeof existing._ctime === 'string' ? existing._ctime : null,
        _mtime: nowIso,
        state: {
          ...(existing.state ?? {}),
          lastWatched: nowIso,
          timeOffset,
          duration,
          video_id: normalizedType === 'series' ? (params.videoId ?? null) : null,
        },
        behaviorHints: {
          defaultVideoId: existing.behaviorHints?.defaultVideoId ?? null,
          featuredVideoId: existing.behaviorHints?.featuredVideoId ?? null,
          hasScheduledVideos: Boolean(existing.behaviorHints?.hasScheduledVideos),
        },
      },
    ],
  });
}

export async function removeFromLibraryItem(params: { authKey: string; id: string }): Promise<void> {
  const existing = await datastoreGetLibraryItemById({ authKey: params.authKey, id: params.id });
  if (!existing) return;

  const nowIso = new Date().toISOString();
  await datastorePutLibraryItems({
    authKey: params.authKey,
    changes: [
      {
        _id: existing._id,
        name: existing.name,
        type: existing.type,
        poster: existing.poster ?? null,
        posterShape: existing.posterShape ?? 'poster',
        removed: true,
        temp: false,
        _ctime: typeof existing._ctime === 'string' ? existing._ctime : null,
        _mtime: nowIso,
        state: {
          ...(existing.state ?? {}),
        },
        behaviorHints: {
          defaultVideoId: existing.behaviorHints?.defaultVideoId ?? null,
          featuredVideoId: existing.behaviorHints?.featuredVideoId ?? null,
          hasScheduledVideos: Boolean(existing.behaviorHints?.hasScheduledVideos),
        },
      },
    ],
  });
}

export async function addToLibraryItem(params: {
  authKey: string;
  id: string;
  type: LibraryItem['type'];
  name: string;
  poster?: string | null;
  posterShape?: string;
}): Promise<void> {
  const existing = await datastoreGetLibraryItemById({ authKey: params.authKey, id: params.id });
  const nowIso = new Date().toISOString();

  const stateDefaults: Required<Pick<LibraryItemState, 'timeOffset' | 'duration'>> & {
    lastWatched: string | null;
    timeWatched: number;
    overallTimeWatched: number;
    timesWatched: number;
    flaggedWatched: number;
    video_id: string | null;
    watched: string | null;
    lastVidReleased: string | null;
    noNotif: boolean;
  } = {
    lastWatched: null,
    timeWatched: 0,
    timeOffset: 0,
    overallTimeWatched: 0,
    timesWatched: 0,
    flaggedWatched: 0,
    duration: 0,
    video_id: null,
    watched: null,
    lastVidReleased: null,
    noNotif: false,
  };

  await datastorePutLibraryItems({
    authKey: params.authKey,
    changes: [
      {
        _id: params.id,
        name: params.name,
        type: params.type,
        poster: params.poster ?? existing?.poster ?? null,
        posterShape: params.posterShape ?? existing?.posterShape ?? 'poster',
        removed: false,
        temp: false,
        _ctime: typeof existing?._ctime === 'string' ? existing._ctime : nowIso,
        _mtime: nowIso,
        state: {
          ...stateDefaults,
          ...(existing?.state ?? {}),
        },
        behaviorHints: {
          defaultVideoId: existing?.behaviorHints?.defaultVideoId ?? null,
          featuredVideoId: existing?.behaviorHints?.featuredVideoId ?? null,
          hasScheduledVideos: Boolean(existing?.behaviorHints?.hasScheduledVideos),
        },
      },
    ],
  });
}

export function normalizeStremioImage(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}
