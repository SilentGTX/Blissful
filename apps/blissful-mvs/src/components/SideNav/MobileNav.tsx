import { useState, useRef, useCallback, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import type { LibraryItem } from '../../lib/mediaTypes';
import type { SideNavView, SideNavProps } from './types';
import { ICONS } from './utils';
import { MobileNavItem, MobileContinueItem, MobileFriendsItem } from './NavItem';
import { normalizeStremioImage } from '../../lib/mediaTypes';
import { proxiedImage } from '../../lib/imageProxy';
import { getContinueSubtitle } from './utils';
import { TrashIcon } from '../../icons/TrashIcon';
import { StremioLogo } from '../../icons/StremioLogo';
import BottomDrawer from '../BottomDrawer';
import { FriendsAccordion } from '../Friends';
import { useFriends } from '../../context/FriendsProvider';
import { useAuth } from '../../context/AuthProvider';

export type MobileNavProps = Pick<
  SideNavProps,
  'active' | 'onChange' | 'onOpenLogin' | 'onOpenJoinParty' | 'continueWatching' | 'continueSyncError' | 'userLabel' | 'onOpenContinueItem' | 'onRemoveContinueItem'
>;

// Swipeable item with iOS-style swipe to delete
type SwipeableItemProps = {
  item: LibraryItem;
  onOpen: () => void;
  onRemove: (item: LibraryItem) => void;
};

function SwipeableContinueItem({ item, onOpen, onRemove }: SwipeableItemProps) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const deleteThreshold = -80; // Swipe left threshold to reveal delete button

  const poster = normalizeStremioImage(item.poster);
  const progress = item.state?.duration
    ? Math.min(100, Math.max(0, ((item.state?.timeOffset ?? 0) / item.state.duration) * 100))
    : null;
  const subtitle = getContinueSubtitle(item);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    currentXRef.current = startXRef.current;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    currentXRef.current = e.touches[0].clientX;
    const diff = currentXRef.current - startXRef.current;

    // Only allow swiping left (negative offset), limit to delete button width
    if (diff < 0) {
      setOffset(Math.max(diff, deleteThreshold));
    } else {
      // Swiping right - reset to 0
      setOffset(0);
    }
  }, [isDragging]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    // Snap to either open or closed based on threshold
    if (offset < deleteThreshold / 2) {
      setOffset(deleteThreshold);
    } else {
      setOffset(0);
    }
  }, [offset]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove(item);
  }, [onRemove, item]);

  // Calculate opacity based on swipe offset (0 to 1)
  const backgroundOpacity = Math.min(1, Math.max(0, Math.abs(offset) / Math.abs(deleteThreshold)));

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden">
      {/* Background layer with delete button - only visible when swiped */}
      <div
        className="absolute inset-y-0 right-0 flex items-center justify-end pr-4 pointer-events-none"
        style={{
          background: `linear-gradient(to right, transparent, rgba(239, 68, 68, ${0.2 * backgroundOpacity}))`,
          width: `${Math.abs(deleteThreshold)}px`,
          right: 0,
          opacity: backgroundOpacity,
          transition: isDragging ? 'none' : 'opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <button
          type="button"
          onClick={handleDeleteClick}
          className="grid h-12 w-12 place-items-center rounded-full bg-red-500 text-white shadow-lg transition-transform active:scale-95 pointer-events-auto"
          aria-label="Delete"
          style={{
            transform: `scale(${0.8 + 0.2 * backgroundOpacity})`,
            transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <TrashIcon size={20} />
        </button>
      </div>

      {/* Foreground item card */}
      <div
        className="relative z-10 w-full cursor-pointer rounded-2xl bg-white/6 p-3 text-left active:bg-white/10"
        style={{
          transform: `translateX(${offset}px)`,
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={() => {
          if (offset === 0) {
            onOpen();
          } else {
            // Close if swiped open and tapped
            setOffset(0);
          }
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 overflow-hidden rounded-xl bg-white/10">
            {poster ? <img src={proxiedImage(poster)} alt="" className="h-full w-full object-cover" /> : null}
          </div>
          <div className="min-w-0 flex-1 pr-2">
            <div className="truncate text-[13px] sm:text-sm font-medium text-foreground/90">{item.name}</div>
            <div className="mt-1 text-[11px] sm:text-xs flex items-center gap-1.5 min-w-0">
              {subtitle.epLabel && (
                <span className="text-foreground/80 shrink-0">{subtitle.epLabel} · </span>
              )}
              <span className={`truncate ${subtitle.isExternal ? 'text-orange-400 font-semibold' : 'text-foreground/60'}`}>
                {subtitle.text}
              </span>
              {subtitle.source === 'stremio' ? (
                <>
                  <span className="text-foreground/80 shrink-0">·</span>
                  <StremioLogo size={12} className="shrink-0" />
                </>
              ) : null}
            </div>
            {progress !== null ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-[var(--bliss-accent)]" style={{ width: `${progress}%` }} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MobileNav(props: MobileNavProps) {
  const [isMobileContinueOpen, setIsMobileContinueOpen] = useState(false);
  const [isMobileFriendsOpen, setIsMobileFriendsOpen] = useState(false);
  const location = useLocation();
  // Surface unread / actionable count on the Friends pill — incoming
  // friend requests are the standard "needs attention" signal.
  const { incoming: friendsIncoming } = useFriends();

  // Close the bottom drawers on navigation (e.g. "View profile" from
  // the Friends drawer routes to /profile/:id) so the sheet doesn't
  // linger over the new page.
  useEffect(() => {
    setIsMobileFriendsOpen(false);
    setIsMobileContinueOpen(false);
  }, [location.pathname]);
  // userLabel falls back to 'Guest' upstream — check the raw token.
  const { authKey } = useAuth();
  const isSignedIn = Boolean(authKey);

  const handleNavChange = (view: SideNavView) => {
    props.onChange(view);
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden [@media(max-height:370px)]:!block">
        <div className="solid-surface flex h-[80px] items-center justify-around rounded-[28px] bg-white/6 px-2 shadow-lg backdrop-blur-xl border border-white/10">
          <MobileNavItem
            label="Home"
            icon={ICONS.home}
            active={props.active === 'home'}
            onPress={() => handleNavChange('home')}
          />
          <MobileNavItem
            label="Discover"
            icon={ICONS.discover}
            active={props.active === 'discover'}
            onPress={() => handleNavChange('discover')}
          />
          <MobileNavItem
            label="Library"
            icon={ICONS.library}
            active={props.active === 'library'}
            onPress={() => handleNavChange('library')}
          />
          <MobileNavItem
            label="Party"
            icon={ICONS.watchParty}
            active={false}
            onPress={() => props.onOpenJoinParty()}
          />
          <MobileFriendsItem
            count={friendsIncoming.length}
            onPress={() => {
              if (!isSignedIn) {
                props.onOpenLogin();
                return;
              }
              setIsMobileFriendsOpen(true);
            }}
          />
          <MobileContinueItem
            count={props.continueWatching.length}
            onPress={() => {
              if (!props.userLabel) {
                props.onOpenLogin();
                return;
              }
              setIsMobileContinueOpen(true);
            }}
          />
        </div>
      </nav>

      <BottomDrawer
        isOpen={isMobileContinueOpen}
        onClose={() => setIsMobileContinueOpen(false)}
        title="Continue Watching"
        bodyClassName="pt-2 pb-4"
        className="bg-white/6 px-6"
      >
        {props.continueWatching.length === 0 ? (
          <div className="text-sm text-foreground/70 pb-4">
            {props.userLabel ? 'Nothing in progress yet.' : 'Login to sync progress'}
          </div>
        ) : (
          (() => {
            const pages: LibraryItem[][] = [];
            for (let i = 0; i < props.continueWatching.length; i += 3) {
              pages.push(props.continueWatching.slice(i, i + 3));
            }
            return (
              <div className="h-[255px] overflow-auto pr-1 hide-scrollbar snap-y snap-mandatory scroll-smooth">
                {pages.map((page, pageIdx) => (
                  <div
                    key={`page-${pageIdx}`}
                    className="snap-start snap-stop-always flex h-[255px] flex-col justify-start gap-2"
                  >
                    {page.map((item) => (
                      <SwipeableContinueItem
                        key={item._id}
                        item={item}
                        onOpen={() => {
                          setIsMobileContinueOpen(false);
                          props.onOpenContinueItem(item, { source: 'mobile' });
                        }}
                        onRemove={props.onRemoveContinueItem}
                      />
                    ))}
                  </div>
                ))}
              </div>
            );
          })()
        )}
      </BottomDrawer>

      <BottomDrawer
        isOpen={isMobileFriendsOpen}
        onClose={() => setIsMobileFriendsOpen(false)}
        bodyClassName="pt-2 pb-4"
        className="bg-white/6 px-6"
      >
        {/* Match the Continue Watching drawer shape: empty / logged-
            out states are flat text, signed-in renders the
            FriendsAccordion. `min-h-[260px]` only on the signed-in
            branch because FriendsAccordion's `flex-1` layout
            collapses to 0 without a parent height — without it, even
            the accordion's own empty-state message disappears. */}
        {isSignedIn ? (
          <div className="flex min-h-[260px] max-h-[70vh] flex-col overflow-auto pr-1 hide-scrollbar">
            <FriendsAccordion />
          </div>
        ) : (
          <div className="text-sm text-foreground/70 pb-4">
            Login to see and add friends
          </div>
        )}
      </BottomDrawer>
    </>
  );
}
