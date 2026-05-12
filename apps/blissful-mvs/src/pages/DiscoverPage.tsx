import {
  ListBox,
  Modal,
  Select,
  Spinner,
  Tooltip,
} from '@heroui/react';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import BottomDrawer from '../components/BottomDrawer';
import { SkeletonSearchGrid } from '../components/Skeleton';
import MediaCard from '../components/MediaCard';
import StremioIcon from '../components/StremioIcon';
import { useAppContext } from '../context/AppContext';
import { ImdbIcon } from '../icons/ImdbIcon';
import { useDiscoverCatalogData } from '../features/discover/hooks/useDiscoverCatalogData';
import { useDiscoverSelection } from '../features/discover/hooks/useDiscoverSelection';
import { formatDate } from '../features/discover/utils';
import { isInLibrary as isInLibraryStored, toggleLibrary } from '../lib/libraryStore';
import { useImdbRating } from '../lib/useImdbRating';
import type { MediaItem, MediaType } from '../types/media';

export default function DiscoverPage() {
  const { query, addons, isDark, setQuery } = useAppContext();
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
  const [isTrailerOpen, setIsTrailerOpen] = useState(false);
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
  const trailerStreams = ((selected as any)?.trailerStreams ?? []) as Array<{ ytId?: string }>;
  const trailers = ((selected as any)?.trailers ?? []) as Array<{ source?: string }>;
  const firstTrailerId = trailerStreams[0]?.ytId ?? trailers[0]?.source ?? null;

  return (
    <div className="catalog-container">
      <div className="lg:mr-[360px]">
        <div className="h-full overflow-hidden">
          {/* Desktop: Select dropdowns */}
          <div className="hidden sm:flex flex-wrap gap-3">
            <Select
              aria-label="Type"
              selectedKey={selectedTypeKeys[0] ?? undefined}
              onSelectionChange={(key) => {
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
            >
              <Select.Trigger className="solid-surface bg-white/10 border border-white/10 rounded-full">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {typeItems.map((item) => (
                    <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                      {item.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            <Select
              aria-label="Catalog"
              selectedKey={selectedCatalogKeys[0] ?? undefined}
              onSelectionChange={(key) => {
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
            >
              <Select.Trigger className="solid-surface bg-white/10 border border-white/10 rounded-full">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {catalogItems.map((item) => (
                    <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                      {item.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>

            <Select
              aria-label="Genre"
              selectedKey={selectedFilterKeys[0] ?? undefined}
              onSelectionChange={(key) => {
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
            >
              <Select.Trigger className="solid-surface bg-white/10 border border-white/10 rounded-full">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {filterItems.map((item) => (
                    <ListBox.Item key={item.key} id={item.key} textValue={item.label}>
                      {item.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
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
              <div className="grid grid-cols-2 gap-5 p-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {filteredItems.map((item) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    variant="poster"
                    selected={selectedId === item.id}
                    onPress={() => {
                      // On mobile, navigate to detail page directly
                      // On desktop, show the sidebar preview
                      if (window.innerWidth < 1024) {
                        navigate(`/detail/${item.type}/${encodeURIComponent(item.id)}`);
                      } else {
                        setSelectedId(item.id);
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="fixed right-3 top-25 h-[calc(100vh-6rem)] w-[360px] hidden lg:block px-3 py-5">
          <div className="solid-surface relative flex h-full flex-col overflow-hidden rounded-[32px] bg-white/6">
            {bg ? (
              <div
                className="absolute inset-0 bg-cover bg-center opacity-35 blur-lg "

              />
            ) : null}
            <div className="relative z-10 flex h-full flex-col p-6">
              {selectedLoading ? (
                <div className="flex items-center gap-2 text-sm text-foreground/70">
                  <Spinner
                    size="sm"
                    color="current"
                    className="text-[var(--bliss-teal)] drop-shadow-[0_0_12px_var(--bliss-teal-glow)]"
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
                            <button
                              key={g}
                              type="button"
                              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold tracking-tight text-white/90 hover:bg-white/15"
                              onClick={() => {
                                setQuery('');
                                const qs = new URLSearchParams({ genre: g });
                                navigate(`/discover/${encodeURIComponent('https://v3-cinemeta.strem.io/manifest.json')}/${discoverType}/top?${qs.toString()}`);
                              }}
                            >
                              {g}
                            </button>
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
                            <button
                              key={c}
                              type="button"
                              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold tracking-tight text-white/90 hover:bg-white/15"
                              onClick={() => {
                                navigate(`/search?search=${encodeURIComponent(c)}`);
                              }}
                            >
                              {c}
                            </button>
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
                            <button
                              key={d}
                              type="button"
                              className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold tracking-tight text-white/90 hover:bg-white/15"
                              onClick={() => {
                                navigate(`/search?search=${encodeURIComponent(d)}`);
                              }}
                            >
                              {d}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-6 flex items-center justify-between gap-3">
                    <Tooltip>
                      <Tooltip.Trigger>
                        <button
                          type="button"
                          className="grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/10 text-white hover:bg-white/15"
                          aria-label={selectedInLibrary ? 'Remove from library' : 'Add to library'}
                          onClick={() => {
                            toggleLibrary({ type: discoverType, id: selected.id, name: selected.name, poster: selected.poster ?? undefined });
                            setLibraryVersion((v) => v + 1);
                          }}
                        >
                          <StremioIcon
                            name={selectedInLibrary ? 'remove-from-library' : 'add-to-library'}
                            className="h-6 w-6"
                          />
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Content placement="top">
                        {selectedInLibrary ? 'Remove from library' : 'Add to library'}
                      </Tooltip.Content>
                    </Tooltip>

                    <Tooltip>
                      <Tooltip.Trigger>
                        <button
                          type="button"
                          className={
                            'grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/10 text-white hover:bg-white/15 ' +
                            (!firstTrailerId ? 'opacity-40 cursor-not-allowed' : '')
                          }
                          aria-label="Trailer"
                          onClick={() => {
                            if (!firstTrailerId) return;
                            setIsTrailerOpen(true);
                          }}
                        >
                          <StremioIcon name="trailer" className="h-6 w-6" />
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Content placement="top">Trailer</Tooltip.Content>
                    </Tooltip>

                    <button
                      type="button"
                      className={
                        'group flex h-12 flex-1 items-center justify-center gap-2 rounded-full border font-semibold transition-colors ' +
                        (isDark
                          ? 'border-white/10 bg-white/10 text-white hover:bg-white hover:text-black'
                          : 'border-black/10 bg-black/10 text-black hover:bg-black hover:text-white')
                      }
                      onClick={() => navigate(`/detail/${discoverType}/${encodeURIComponent(selected.id)}`)}
                    >
                      <StremioIcon
                        name="play"
                        className={
                          'h-6 w-6 transition-colors ' +
                          (isDark ? 'text-white group-hover:text-black' : 'text-black group-hover:text-white')
                        }
                      />
                      <span>Show</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-foreground/70">Select a title to see details.</div>
              )}
            </div>
          </div>
        </aside>

        <Modal>
          <Modal.Backdrop
            isOpen={isTrailerOpen}
            onOpenChange={(open) => setIsTrailerOpen(open)}
            variant="blur"
            className="bg-black/60"
          >
            <Modal.Container placement="center" size="cover">
              <Modal.Dialog className="bg-transparent shadow-none">
                <Modal.Header className="sr-only"><Modal.Heading>Trailer</Modal.Heading></Modal.Header>
                <Modal.Body className="px-0">
                  <div className="overflow-hidden rounded-[28px] bg-black">
                    {firstTrailerId ? (
                      <iframe
                        title="Trailer"
                        className="h-[70vh] w-[min(1000px,92vw)]"
                        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(firstTrailerId)}?autoplay=1`}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    ) : (
                      <div className="p-6 text-sm text-white/70">No trailer.</div>
                    )}
                  </div>
                </Modal.Body>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>

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
