import type { RefObject } from 'react';
import { UserIcon } from '../../icons/UserIcon';
import { ChevronDownIcon } from '../../icons/ChevronDownIcon';
import { SearchIcon } from '../../icons/SearchIcon';
import type { StremioMetaPreview } from '../../lib/stremioAddon';

type NetflixNavItem = {
  key: string;
  label: string;
  onClick: () => void;
};

type NetflixTopBarProps = {
  query: string;
  isSearchMenuOpen: boolean;
  isNetflixSearchOpen: boolean;
  searchHistory: string[];
  searchSuggestions: string[];
  searchResults?: StremioMetaPreview[];
  onSelectResult?: (result: StremioMetaPreview) => void;
  activeNav: string;
  navItems: NetflixNavItem[];
  searchMenuRef: RefObject<HTMLDivElement | null>;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  onToggleSearch: () => void;
  onSelectQuery: (value: string) => void;
  onClearHistory: () => void;
  onOpenAccount: () => void;
};

export function NetflixTopBar({
  query,
  isSearchMenuOpen,
  isNetflixSearchOpen,
  searchHistory,
  searchSuggestions,
  searchResults,
  onSelectResult,
  activeNav,
  navItems,
  searchMenuRef,
  onQueryChange,
  onSubmit,
  onToggleSearch,
  onSelectQuery,
  onClearHistory,
  onOpenAccount,
}: NetflixTopBarProps) {
  return (
    <div className="netflix-topbar">
      <div className="netflix-topbar-left"></div>

      <div className="netflix-topbar-center">
        <nav className={`netflix-nav ${isNetflixSearchOpen ? 'is-search-open' : ''}`}>
          <div
            ref={searchMenuRef}
            className={`netflix-search-wrap netflix-nav-search ${isNetflixSearchOpen ? 'is-open' : ''}`}
          >
            <button
              type="button"
              className="netflix-icon-btn"
              aria-label="Search"
              onClick={onToggleSearch}
            >
              <SearchIcon size={18} />
            </button>

            {isNetflixSearchOpen ? (
              <input
                value={query}
                onChange={(event) => {
                  onQueryChange(event.target.value);
                }}
                onFocus={() => onQueryChange(query)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onSubmit();
                  }
                }}
                placeholder="Search"
                className="netflix-search-input"
              />
            ) : null}

            {isSearchMenuOpen && (searchHistory.length > 0 || searchSuggestions.length > 0 || (searchResults && searchResults.length > 0)) ? (
              <div className="netflix-search-menu">
                {searchHistory.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-wide text-white/60">
                        Search history
                      </div>
                      <button
                        type="button"
                        className="text-xs text-white/60 hover:text-white/80"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onClearHistory();
                        }}
                      >
                        Clear
                      </button>
                    </div>
                    <div className="space-y-1">
                      {searchHistory.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="w-full rounded-xl px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10"
                          onClick={() => onSelectQuery(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {searchSuggestions.length > 0 ? (
                  <div className={searchHistory.length > 0 ? 'mt-4 space-y-2' : 'space-y-2'}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-white/60">
                      Search suggestions
                    </div>
                    <div className="space-y-1">
                      {searchSuggestions.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="w-full rounded-xl px-3 py-2 text-left text-sm text-white/85 hover:bg-white/10"
                          onClick={() => onSelectQuery(item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {searchResults && searchResults.length > 0 ? (
                  <div className={(searchHistory.length > 0 || searchSuggestions.length > 0) ? 'mt-4 space-y-2' : 'space-y-2'}>
                    <div className="text-xs font-semibold uppercase tracking-wide text-white/60">
                      Results
                    </div>
                    <div className="space-y-1">
                      {searchResults.map((result) => (
                        <button
                          key={`${result.type}:${result.id}`}
                          type="button"
                          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/10"
                          onClick={() => onSelectResult?.(result)}
                        >
                          {result.poster ? (
                            <img
                              src={result.poster.startsWith('//') ? `https:${result.poster}` : result.poster}
                              alt=""
                              className="h-12 w-8 flex-shrink-0 rounded-md object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="grid h-12 w-8 flex-shrink-0 place-items-center rounded-md bg-white/10 text-xs text-white/40">
                              ?
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-white/90">{result.name}</div>
                            <div className="text-xs text-white/50">
                              {result.type}{result.year ? ` · ${result.year}` : ''}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {navItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={
                'netflix-nav-item' +
                (item.key === 'home' && activeNav === 'home'
                  ? ' is-active'
                  : item.key === 'my' && activeNav === 'library'
                    ? ' is-active'
                    : '')
              }
              onClick={item.onClick}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="netflix-topbar-right">
        <button
          type="button"
          className="netflix-profile"
          aria-label="Profile"
          onClick={onOpenAccount}
        >
          <span className="netflix-profile-icon" aria-hidden="true">
            <UserIcon />
          </span>
          <ChevronDownIcon size={12} />
        </button>
      </div>
    </div>
  );
}
