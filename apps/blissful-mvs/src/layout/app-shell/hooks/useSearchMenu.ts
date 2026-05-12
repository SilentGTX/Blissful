import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchCatalog, type StremioMetaPreview } from '../../../lib/stremioAddon';
import { readStoredSearchHistory, writeStoredSearchHistory } from '../utils';
import { SEARCH_HISTORY_KEY, SEARCH_HISTORY_LIMIT } from '../constants';

type UseSearchMenuParams = {
  query: string;
  setQuery: (value: string) => void;
  isNetflix: boolean;
  pathname: string;
};

export function useSearchMenu({ query, setQuery, isNetflix, pathname }: UseSearchMenuParams) {
  const searchMenuRef = useRef<HTMLDivElement | null>(null);
  const prevPathnameRef = useRef<string>(pathname);
  const [isSearchMenuOpen, setIsSearchMenuOpen] = useState(false);
  const [isNetflixSearchOpen, setIsNetflixSearchOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => readStoredSearchHistory());
  const [remoteSearchSuggestions, setRemoteSearchSuggestions] = useState<string[]>([]);
  const [searchResults, setSearchResults] = useState<StremioMetaPreview[]>([]);

  const addToSearchHistory = useCallback((value: string) => {
    const nextValue = value.trim();
    if (!nextValue) return;
    setSearchHistory((prev) => {
      const next = [nextValue, ...prev.filter((q) => q !== nextValue)].slice(0, SEARCH_HISTORY_LIMIT);
      writeStoredSearchHistory(next);
      return next;
    });
  }, []);

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
    localStorage.removeItem(SEARCH_HISTORY_KEY);
  }, []);

  useEffect(() => {
    if (!isSearchMenuOpen) {
      setRemoteSearchSuggestions([]);
      setSearchResults([]);
      return;
    }

    const needle = query.trim();
    if (!needle) {
      setRemoteSearchSuggestions([]);
      setSearchResults([]);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      Promise.all([
        fetchCatalog({ baseUrl: 'https://v3-cinemeta.strem.io', type: 'movie', id: 'top', extra: { search: needle, skip: 0 }, signal: controller.signal }),
        fetchCatalog({ baseUrl: 'https://v3-cinemeta.strem.io', type: 'series', id: 'top', extra: { search: needle, skip: 0 }, signal: controller.signal }),
      ])
        .then(([movies, series]) => {
          if (cancelled) return;
          const allMetas = [...movies.metas, ...series.metas];

          // Name-only suggestions (existing behavior)
          const out: string[] = [];
          const seen = new Set<string>();
          for (const meta of allMetas) {
            const name = meta?.name?.trim();
            if (!name) continue;
            const key = name.toLowerCase();
            if (key === needle.toLowerCase()) continue;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(name);
            if (out.length >= 5) break;
          }
          setRemoteSearchSuggestions(out);

          // Rich preview results (poster + title + year)
          const resultsSeen = new Set<string>();
          const results: StremioMetaPreview[] = [];
          for (const meta of allMetas) {
            if (!meta?.id || !meta?.name) continue;
            if (resultsSeen.has(meta.id)) continue;
            resultsSeen.add(meta.id);
            results.push(meta);
            if (results.length >= 5) break;
          }
          setSearchResults(results);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          if (cancelled) return;
          setRemoteSearchSuggestions([]);
          setSearchResults([]);
        });
    }, 250);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [isSearchMenuOpen, query]);

  useEffect(() => {
    if (!isNetflix) setIsNetflixSearchOpen(false);
  }, [isNetflix]);

  useEffect(() => {
    const onClose = (event: MouseEvent) => {
      if (!isSearchMenuOpen) return;
      const el = searchMenuRef.current;
      if (!el) return;
      if (event.target instanceof Node && el.contains(event.target)) return;
      setIsSearchMenuOpen(false);
      if (isNetflix) setIsNetflixSearchOpen(false);
    };

    document.addEventListener('mousedown', onClose);
    return () => document.removeEventListener('mousedown', onClose);
  }, [isNetflix, isSearchMenuOpen]);

  useEffect(() => {
    const prev = prevPathnameRef.current;
    const next = pathname;
    if (prev.startsWith('/search') && !next.startsWith('/search')) {
      setQuery('');
      setIsSearchMenuOpen(false);
    }
    prevPathnameRef.current = next;
  }, [pathname, setQuery]);

  return {
    searchMenuRef,
    isSearchMenuOpen,
    setIsSearchMenuOpen,
    isNetflixSearchOpen,
    setIsNetflixSearchOpen,
    searchHistory,
    addToSearchHistory,
    clearSearchHistory,
    searchSuggestions: remoteSearchSuggestions,
    searchResults,
  };
}
