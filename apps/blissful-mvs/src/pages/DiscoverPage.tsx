import { Spinner } from '@heroui/react';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import BottomDrawer from '../components/BottomDrawer';
import { SkeletonSearchGrid } from '../components/Skeleton';
import MediaCard from '../components/MediaCard';
import StremioIcon from '../components/StremioIcon';
import { useAddons } from '../context/AddonsProvider';
import { useUI } from '../context/UIProvider';
import { ImdbIcon } from '../icons/ImdbIcon';
import { ContentTypeIcon, SortIcon, GenreIcon, YearIcon } from '../icons/DiscoverFilterIcons';
import { useDiscoverCatalogData } from '../features/discover/hooks/useDiscoverCatalogData';
import { useDiscoverSelection } from '../features/discover/hooks/useDiscoverSelection';
import { formatDate } from '../features/discover/utils';
import { isInLibrary as isInLibraryStored, toggleLibrary } from '../lib/libraryStore';
import { useImdbRating } from '../lib/useImdbRating';
import { TvSelect } from '../spatial/TvSelect';
import { FocusableButton } from '../spatial/FocusableButton';
import type { MediaItem, MediaType } from '../types/media';

export default function DiscoverPage() {
  const { addons } = useAddons();
  const { query, setQuery } = useUI();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const transportUrl = params.transportUrl ? decodeURIComponent(params.transportUrl) : null;
  const discoverType = (params.type as MediaType | undefined) ?? 'movie';
  const discoverCatalog = params.catalogId ?? 'top';
  const discoverGenre = searchParams.get('genre');
  const discoverYear = searchParams.get('year');

  const seedItems = useMemo(() => {
    const seed = (location.state as { seedItems?: MediaItem[] } | null)?.seedItems;
    return Array.isArray(seed) ? seed : [];
  }, [location.state]);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [mobileDrawerType, setMobileDrawerType] = useState<'type' | 'catalog' | 'genre' | null>(null);

  const {
    filteredItems,
    availableGenres,
    discoverLoading,
    gridScrollRef,
    baseUrl,
  } = useDiscoverCatalogData({
    transportUrl,
    discoverType,
    discoverCatalog,
    discoverGenre,
    discoverYear,
    query,
    addons,
    searchParams,
    seedItems,
    navigate,
  });

  const {
    selectedId,
    setSelectedId,
    selectedLoading,
    selected,
  } = useDiscoverSelection({ discoverType, baseUrl, filteredItems });

  const selectedInlineRating = useMemo(() => {
    if (!selected) return null;
    const raw = (selected as { imdbRating?: string | number }).imdbRating;
    if (raw === undefined || raw === null || raw === '') return null;
    const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
    return Number.isFinite(parsed) ? parsed : null;
  }, [selected]);

  const selectedImdbId = useMemo(() => {
    if (!selected) return null;
    const explicit = (selected as { imdb_id?: string }).imdb_id;
    if (explicit && /^tt\d{5,}$/.test(explicit)) return explicit;
    const id = (selected as { id?: string }).id;
    return id && /^tt\d{5,}$/.test(id) ? id : null;
  }, [selected]);

  const selectedResolvedRating = useImdbRating(selectedImdbId, selectedInlineRating);

  // Stremio core exposes filter options via CatalogWithFilters.selectable.extra.
  // We don't have that model here, so we derive genre options from the loaded items.

  const typeItems = useMemo(() => {
    const types = Array.from(
      new Set(addons.flatMap((a) => a.manifest?.catalogs?.map((c) => c.type) ?? []))
    );
    return types.map((type) => ({
      key: type,
      label: type.charAt(0).toUpperCase() + type.slice(1),
    }));
  }, [addons]);

  const catalogItems = useMemo(() => {
    return addons.flatMap((addon) =>
      (addon.manifest?.catalogs ?? [])
        .filter((catalog) => catalog.type === discoverType)
        .map((catalog) => ({
          key: `${addon.transportUrl}::${catalog.id}`,
          label: `${catalog.name ?? catalog.id}`,
        }))
    );
  }, [addons, discoverType]);

  const genreItems = useMemo(() => {
    return [{ key: 'all', label: 'Genre' }, ...availableGenres.map((g) => ({ key: g, label: g }))];
  }, [availableGenres]);

  const yearItems = useMemo(() => {
    const now = new Date().getFullYear();
    const years: Array<{ key: string; label: string }> = [];
    for (let y = now; y >= now - 30; y -= 1) {
      years.push({ key: String(y), label: String(y) });
    }
    return [{ key: 'all', label: 'Year' }, ...years];
  }, []);

  const selectedTypeKeys = typeItems.some((item) => item.key === discoverType)
    ? [discoverType]
    : [];
  const selectedCatalogKey = `${transportUrl ?? ''}::${discoverCatalog}`;
  const selectedCatalogKeys = catalogItems.some((item) => item.key === selectedCatalogKey)
    ? [selectedCatalogKey]
    : [];
  const filterItems = discoverCatalog === 'year' ? yearItems : genreItems;
  const filterKey = discoverCatalog === 'year' ? (discoverYear ?? 'all') : (discoverGenre ?? 'all');
  const selectedFilterKeys = filterItems.some((item) => item.key === filterKey)
    ? [filterKey]
    : [];

  const bg = selected?.background || selected?.poster;
  void libraryVersion;
  const selectedInLibrary = selected ? isInLibraryStored({ type: discoverType, id: selected.id }) : false;

  return (
    <div className="catalog-container">
      <div className="lg:mr-[360px]">
        <div className="h-full overflow-hidden">
          {/* Desktop / TV: filter dropdowns (horizontal row above the grid) */}
          <div className="hidden sm:flex flex-wrap gap-3">
            <TvSelect
              ariaLabel="Type"
              leftIcon={<ContentTypeIcon className="h-4 w-4" />}
              value={selectedTypeKeys[0] ?? null}
              options={typeItems}
              onChange={(key) => {
                const keyStr = String(key);
                const first = addons
                  .flatMap((addon) =>
                    (addon.manifest?.catalogs ?? [])
                      .filter((catalog) => catalog.type === keyStr)
                      .map((catalog) => ({ addon, catalog }))
                  )
                  .at(0);
                if (!first) return;
                const nextParams = new URLSearchParams(searchParams);
                nextParams.delete('genre');
                nextParams.delete('year');
                const qs = nextParams.toString();
                navigate(
                  '/discover/' +
                  encodeURIComponent(first.addon.transportUrl) +
                  '/' +
                  keyStr +
                  '/' +
                  first.catalog.id +
                  (qs ? `?${qs}` : '')
                );
              }}
              className="w-40"
              triggerClassName="solid-surface bg-white/10 border border-white/10 rounded-full"
            />

            <TvSelect
              ariaLabel="Catalog"
              leftIcon={<SortIcon className="h-4 w-4" />}
              value={selectedCatalogKeys[0] ?? null}
              options={catalogItems}
              onChange={(key) => {
                const keyStr = String(key);
                const [addonTransportUrl, catalogId] = keyStr.split('::');
                if (!addonTransportUrl || !catalogId) return;
                const nextParams = new URLSearchParams(searchParams);
                nextParams.delete('genre');
                nextParams.delete('year');
                const qs = nextParams.toString();
                navigate(
                  '/discover/' +
                  encodeURIComponent(addonTransportUrl) +
                  '/' +
                  discoverType +
                  '/' +
                  catalogId +
                  (qs ? `?${qs}` : '')
                );
              }}
              className="w-48"
              triggerClassName="solid-surface bg-white/10 border border-white/10 rounded-full"
            />

            <TvSelect
              ariaLabel="Genre"
              leftIcon={discoverCatalog === 'year' ? <YearIcon className="h-4 w-4" /> : <GenreIcon className="h-4 w-4" />}
              value={selectedFilterKeys[0] ?? null}
              options={filterItems}
              onChange={(key) => {
                const keyStr = String(key);
                const nextParams = new URLSearchParams(searchParams);
                if (discoverCatalog === 'year') {
                  nextParams.delete('genre');
                  if (keyStr === 'all') nextParams.delete('year');
                  else nextParams.set('year', keyStr);
                } else {
                  nextParams.delete('year');
                  if (keyStr === 'all') nextParams.delete('genre');
                  else nextParams.set('genre', keyStr);
                }

                const qs = nextParams.toString();
                if (!transportUrl) return;
                navigate(
                  '/discover/' +
                  encodeURIComponent(transportUrl) +
                  '/' +
                  discoverType +
                  '/' +
                  discoverCatalog +
                  (qs ? `?${qs}` : '')
                );
              }}
              className="w-44"
              triggerClassName="solid-surface bg-white/10 border border-white/10 rounded-full"
            />
          </div>

          {/* Mobile: Filter buttons that open bottom drawer */}
          <div className="flex sm:hidden flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full solid-surface bg-white/10 border border-white/10 px-4 py-2 text-sm font-medium text-white"
              onClick={() => {
                setMobileDrawerType('type');
                setMobileDrawerOpen(true);
              }}
            >
              {typeItems.find(t => t.key === discoverType)?.label || 'Type'}
            </button>

            <button
              type="button"
              className="rounded-full solid-surface bg-white/10 border border-white/10 px-4 py-2 text-sm font-medium text-white"
              onClick={() => {
                setMobileDrawerType('catalog');
                setMobileDrawerOpen(true);
              }}
            >
              {catalogItems.find(c => c.key === `${transportUrl ?? ''}::${discoverCatalog}`)?.label || 'Catalog'}
            </button>

            <button
              type="button"
              className="rounded-full solid-surface bg-white/10 border border-white/10 px-4 py-2 text-sm font-medium text-white"
              onClick={() => {
                setMobileDrawerType('genre');
                setMobileDrawerOpen(true);
              }}
            >
              {discoverCatalog === 'year'
                ? (yearItems.find(y => y.key === (discoverYear ?? 'all'))?.label || 'Year')
                : (genreItems.find(g => g.key === (discoverGenre ?? 'all'))?.label || 'Genre')}
            </button>
          </div>

          <div ref={gridScrollRef} className="mt-5 h-[calc(100%-4rem)] overflow-y-auto hide-scrollbar">
            {discoverLoading && filteredItems.length === 0 ? (
              <SkeletonSearchGrid />
            ) : (
              // Auto-fit grid: card min-width clamps with viewport so
              // we keep ~5 columns at 1920w (matches the old fixed
              // breakpoints) and get ~6-7 bigger cards at 4K instead
              // of shrinking each card down to nothing.
              <div className="tv-poster-grid grid gap-5 p-1 [grid-template-columns:repeat(auto-fit,minmax(clamp(160px,16vw,420px),1fr))]">
                {filteredItems.map((item, index) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    variant="poster"
                    selected={selectedId === item.id}
                    autoFocusTv={index === 0}
                    // Focus / hover live-previews the title in the side panel;
                    // OK / click opens the detail page we built (TvDetailLayout).
                    onFocus={() => setSelectedId(item.id)}
                    onPress={() => navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="fixed right-3 top-25 h-[calc(100vh-6rem)] w-[360px] hidden lg:block px-3 py-5">
          <div className="solid-surface relative flex h-full flex-col overflow-hidden rounded-[32px] bg-white/6">
            {bg ? (
              <>
                <div
                  className="absolute inset-0 bg-cover bg-center opacity-60 blur-md"
                  style={{ backgroundImage: `url(${bg})` }}
                />
                {/* Legibility scrim: darkens the top (title/meta) and bottom
                    (CTA buttons) where white text sits, while leaving the
                    middle band of the backdrop bright enough to read. */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/30 to-black/80" />
              </>
            ) : null}
            <div className="relative z-10 flex h-full flex-col p-6">
              {selectedLoading ? (
                <div className="flex items-center gap-2 text-sm text-foreground/70">
                  <Spinner
                    size="sm"
                    color="current"
                    className="text-[var(--bliss-accent)] drop-shadow-[0_0_12px_var(--bliss-accent-glow)]"
                  />
                  Loading details...
                </div>
              ) : selected ? (
                <div key={selected.id} className="discover-details-appear flex h-full flex-col">
                  <div className="min-h-0 flex-1 overflow-auto pr-1 hide-scrollbar">
                    <div className="text-2xl font-semibold tracking-tight text-white">{selected.name}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-[1.05rem] font-semibold text-white">
                      {selected.runtime ? <span>{selected.runtime}</span> : null}
                      {(selected as any)?.released ? <span>{formatDate((selected as any).released) ?? ''}</span> : null}
                      {selectedResolvedRating !== null ? (
                        <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1">
                          <span>{selectedResolvedRating.toFixed(1)}</span>
                          <ImdbIcon className="h-6 w-6 text-[#f5c518]" />
                        </span>
                      ) : null}
                    </div>

                    {selected.description ? (
                      <p className="mt-4 text-sm leading-relaxed text-white/80">{selected.description}</p>
                    ) : null}

                    {selected.genres && selected.genres.length ? (
                      <div className="mt-6">
                        <div className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
                          Genres
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3">
                          {selected.genres.slice(0, 6).map((g) => (
                            <FocusableButton
                              key={g}
                              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold tracking-tight text-white/90 hover:bg-white/15"
                              onPress={() => {
                                setQuery('');
                                const qs = new URLSearchParams({ genre: g });
                                navigate(`/discover/${encodeURIComponent('https://v3-cinemeta.strem.io/manifest.json')}/${discoverType}/top?${qs.toString()}`);
                              }}
                            >
                              {g}
                            </FocusableButton>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {selected.cast && selected.cast.length ? (
                      <div className="mt-6">
                        <div className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
                          Cast
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3">
                          {selected.cast.slice(0, 6).map((c) => (
                            <FocusableButton
                              key={c}
                              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold tracking-tight text-white/90 hover:bg-white/15"
                              onPress={() => {
                                navigate(`/search?search=${encodeURIComponent(c)}`);
                              }}
                            >
                              {c}
                            </FocusableButton>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {selected.director && selected.director.length ? (
                      <div className="mt-6">
                        <div className="text-xs font-semibold uppercase tracking-wide text-foreground/60">
                          Directors
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3">
                          {selected.director.slice(0, 3).map((d) => (
                            <FocusableButton
                              key={d}
                              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold tracking-tight text-white/90 hover:bg-white/15"
                              onPress={() => {
                                navigate(`/search?search=${encodeURIComponent(d)}`);
                              }}
                            >
                              {d}
                            </FocusableButton>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-6 flex flex-col gap-3">
                    {/* Primary CTA: Play -> opens the detail page (TvDetailLayout),
                        where the stream picker / Watch lives. Replaces the old
                        "Watch Trailer" button per the redesign. */}
                    <FocusableButton
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--bliss-accent)]/70 bg-[var(--bliss-accent)]/18 px-4 py-3 text-base font-semibold text-white shadow-[0_0_24px_var(--bliss-accent-glow)] transition-colors hover:bg-[var(--bliss-accent)]/30"
                      onPress={() => navigate(`/detail/${discoverType}/${encodeURIComponent(selected.id)}`)}
                    >
                      <StremioIcon name="play" className="h-5 w-5" />
                      <span>Play</span>
                    </FocusableButton>

                    <FocusableButton
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-base font-semibold text-white/90 transition-colors hover:bg-white/15"
                      aria-label={selectedInLibrary ? 'Remove from library' : 'Add to library'}
                      onPress={() => {
                        toggleLibrary({ type: discoverType, id: selected.id, name: selected.name, poster: selected.poster ?? undefined });
                        setLibraryVersion((v) => v + 1);
                      }}
                    >
                      <StremioIcon
                        name={selectedInLibrary ? 'remove-from-library' : 'add-to-library'}
                        className="h-5 w-5"
                      />
                      <span>{selectedInLibrary ? 'Remove from Library' : 'Add to Library'}</span>
                    </FocusableButton>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-foreground/70">Select a title to see details.</div>
              )}
            </div>
          </div>
        </aside>

        {/* Mobile filter drawer (same bottom-sheet style as Continue Watching) */}
        <BottomDrawer
          isOpen={mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          title={
            mobileDrawerType === 'type'
              ? 'Select Type'
              : mobileDrawerType === 'catalog'
                ? 'Select Catalog'
                : (discoverCatalog === 'year' ? 'Select Year' : 'Select Genre')
          }
          bodyClassName="mt-3 h-[min(50vh,380px)] overflow-auto pb-4 pr-1 hide-scrollbar"
          className="px-6"
        >
          <div className="space-y-2">
                    {mobileDrawerType === 'type' && typeItems.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors ${item.key === discoverType
                          ? 'bg-white/20 text-white'
                          : 'text-white/80 hover:bg-white/10'
                          }`}
                        onClick={() => {
                          const first = addons
                            .flatMap((addon) =>
                              (addon.manifest?.catalogs ?? [])
                                .filter((catalog) => catalog.type === item.key)
                                .map((catalog) => ({ addon, catalog }))
                            )
                            .at(0);
                          if (!first) return;
                          const nextParams = new URLSearchParams(searchParams);
                          nextParams.delete('genre');
                          nextParams.delete('year');
                          const qs = nextParams.toString();
                          navigate(
                            '/discover/' +
                            encodeURIComponent(first.addon.transportUrl) +
                            '/' +
                            item.key +
                            '/' +
                            first.catalog.id +
                            (qs ? `?${qs}` : '')
                          );
                          setMobileDrawerOpen(false);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}

                    {mobileDrawerType === 'catalog' && catalogItems.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors ${item.key === `${transportUrl ?? ''}::${discoverCatalog}`
                          ? 'bg-white/20 text-white'
                          : 'text-white/80 hover:bg-white/10'
                          }`}
                        onClick={() => {
                          const [addonTransportUrl, catalogId] = item.key.split('::');
                          if (!addonTransportUrl || !catalogId) return;
                          const nextParams = new URLSearchParams(searchParams);
                          nextParams.delete('genre');
                          nextParams.delete('year');
                          const qs = nextParams.toString();
                          navigate(
                            '/discover/' +
                            encodeURIComponent(addonTransportUrl) +
                            '/' +
                            discoverType +
                            '/' +
                            catalogId +
                            (qs ? `?${qs}` : '')
                          );
                          setMobileDrawerOpen(false);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}

                    {mobileDrawerType === 'genre' && (
                      discoverCatalog === 'year' ? yearItems : genreItems
                    ).map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`w-full rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors ${item.key === (discoverCatalog === 'year' ? (discoverYear ?? 'all') : (discoverGenre ?? 'all'))
                          ? 'bg-white/20 text-white'
                          : 'text-white/80 hover:bg-white/10'
                          }`}
                        onClick={() => {
                          const nextParams = new URLSearchParams(searchParams);
                          if (discoverCatalog === 'year') {
                            nextParams.delete('genre');
                            if (item.key === 'all') nextParams.delete('year');
                            else nextParams.set('year', item.key);
                          } else {
                            nextParams.delete('year');
                            if (item.key === 'all') nextParams.delete('genre');
                            else nextParams.set('genre', item.key);
                          }

                          const qs = nextParams.toString();
                          if (!transportUrl) return;
                          navigate(
                            '/discover/' +
                            encodeURIComponent(transportUrl) +
                            '/' +
                            discoverType +
                            '/' +
                            discoverCatalog +
                            (qs ? `?${qs}` : '')
                          );
                          setMobileDrawerOpen(false);
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
          </div>
        </BottomDrawer>
      </div>
    </div>
  );
}
