import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { pause, resume, setFocus, navigateByDirection } from '@noriginmedia/norigin-spatial-navigation';
import { renderProfileAvatar } from '../lib/profileAvatars';
import { useTvFocusable } from '../spatial/useTvFocusable';

type TvTopBarProps = {
  displayName?: string | null;
  userHandle?: string | null;
  avatar?: string;
  isLoggedIn?: boolean;
  onSettings?: () => void;
  onCustomizeHome?: () => void;
  onLogin?: () => void;
  onLogout?: () => void;
  onToggleFullscreen?: () => void;
};

type MenuItem = { label: string; onPress?: () => void; accent?: boolean; danger?: boolean };

type AvatarView = { kind: string; value: string };

function ProfileMenu({
  displayName,
  userHandle,
  avatarView,
  items,
  onClose,
}: {
  displayName: string;
  userHandle?: string | null;
  avatarView: AvatarView;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Self-contained focus: pause the spatial engine, native-focus the first
  // item, and drive Up/Down/Enter/Esc with the menu's own keyboard handler.
  useEffect(() => {
    pause();
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => resume();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const buttons = Array.from(ref.current?.querySelectorAll('button') ?? []) as HTMLButtonElement[];
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      buttons[(idx + 1) % buttons.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      buttons[(idx - 1 + buttons.length) % buttons.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // don't let the global Back handler also fire
      onClose();
    }
  };

  return (
    <div ref={ref} className="tv-profile-menu" role="menu" onKeyDown={onKeyDown}>
      <div className="tv-profile-menu-head">
        {avatarView.kind === 'image' ? (
          <img src={avatarView.value} alt="" className="tv-profile-menu-avatar" />
        ) : (
          <div className="tv-profile-menu-avatar tv-profile-menu-avatar-letter">{avatarView.value}</div>
        )}
        <div className="tv-profile-menu-name">
          <div>{displayName}</div>
          {userHandle ? <div className="tv-profile-menu-handle">{userHandle}</div> : null}
        </div>
      </div>
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          className={
            'tv-profile-menu-item' + (it.accent ? ' is-accent' : '') + (it.danger ? ' is-danger' : '')
          }
          onClick={() => {
            it.onPress?.();
            onClose();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Standalone TV top bar (the desktop TopNav is hidden on TV). A centered
 * liquid-glass search pill + a profile avatar at the right that opens a focusable
 * menu (Fullscreen / Settings / Customize Home / Logout). The search field
 * native-focuses on D-pad focus so the Android keyboard opens.
 */
export function TvTopBar({
  displayName,
  userHandle,
  avatar,
  isLoggedIn,
  onSettings,
  onCustomizeHome,
  onLogin,
  onLogout,
  onToggleFullscreen,
}: TvTopBarProps) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusInput = () => inputRef.current?.focus();
  // IMPORTANT: only native-focus the input on OK (onPress), NOT on D-pad arrival.
  // Native-focusing on arrival fired the input's onFocus→pause(), freezing the
  // spatial engine the instant you landed on search — a dead-end. Now the pill
  // is a normal spatial stop; OK opens the keyboard, arrows/Back leave it.
  // Stable focusKeys so the two top-bar controls can target each other
  // deterministically (Norigin's center-distance geometry favors the wide,
  // centered search pill and orphans the far-right profile avatar — UP from
  // content always lands on search, and RIGHT from search is undiscoverable /
  // unreliable when a right-side panel sits between them on Discover).
  const SEARCH_KEY = 'tv-search';
  const PROFILE_KEY = 'tv-profile';
  // Search pill: RIGHT always jumps to the profile avatar (return false to skip
  // Norigin's geometric move). LEFT/UP/DOWN fall through to geometry (LEFT -> nav
  // rail, DOWN -> content/hero).
  const { ref, focusKey } = useTvFocusable({
    onPress: focusInput,
    focusKey: SEARCH_KEY,
    onArrowPress: (dir) => {
      if (dir === 'right') {
        setFocus(PROFILE_KEY);
        return false;
      }
      return true;
    },
  });
  // Profile avatar: LEFT jumps back to the search pill; DOWN drops into the
  // content below (so the avatar isn't a dead-end). UP/RIGHT fall through.
  const profileFocus = useTvFocusable({
    onPress: () => setMenuOpen(true),
    focusKey: PROFILE_KEY,
    onArrowPress: (dir) => {
      if (dir === 'left') {
        setFocus(SEARCH_KEY);
        return false;
      }
      if (dir === 'down') {
        navigateByDirection('down', {});
        return false;
      }
      return true;
    },
  });

  // Leave the search field: blur (fires onBlur→resume so the engine un-pauses),
  // resume defensively, put spatial focus back on the pill, and optionally step
  // down so a single ArrowDown both exits typing AND moves to the hero below.
  const leaveSearch = (moveDown = false) => {
    inputRef.current?.blur();
    resume();
    setFocus(focusKey);
    if (moveDown) navigateByDirection('down', {});
  };

  const submit = () => {
    const v = value.trim();
    if (v) navigate(`/search?search=${encodeURIComponent(v)}`);
  };

  const initial = (displayName ?? 'G').charAt(0).toUpperCase();
  const avatarView = renderProfileAvatar(avatar, initial) as AvatarView;

  const items: MenuItem[] = [
    ...(onToggleFullscreen
      ? [{ label: 'Enter full screen mode', onPress: onToggleFullscreen, accent: true }]
      : []),
    { label: 'Settings', onPress: onSettings },
    { label: 'Customize Home', onPress: onCustomizeHome },
    isLoggedIn
      ? { label: 'Logout', onPress: onLogout, danger: true }
      : { label: 'Login', onPress: onLogin, accent: true },
  ];

  return (
    <div className="tv-topbar">
      <div ref={ref} className="tv-topbar-search">
        <svg
          className="tv-topbar-search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M21 21l-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />
        </svg>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => pause()}
          onBlur={() => resume()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
              leaveSearch();
              return;
            }
            // Any of these means "done typing" — release the paused engine and
            // hand the D-pad back. ArrowDown also steps to the hero in one press.
            if (e.key === 'Escape' || e.key === 'ArrowUp') {
              e.preventDefault();
              leaveSearch();
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              leaveSearch(true);
            }
            // ArrowLeft/Right fall through to the input for cursor movement.
          }}
          placeholder="Search movies, series, actors…"
        />
      </div>

      <button
        ref={profileFocus.ref}
        type="button"
        className="tv-topbar-profile"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="Profile"
      >
        {avatarView.kind === 'image' ? (
          <img src={avatarView.value} alt="" className="h-full w-full rounded-full object-cover" />
        ) : (
          initial
        )}
      </button>

      {menuOpen ? (
        <>
          <div className="tv-profile-menu-backdrop" onClick={() => setMenuOpen(false)} />
          <ProfileMenu
            displayName={displayName ?? 'Profile'}
            userHandle={userHandle}
            avatarView={avatarView}
            items={items}
            onClose={() => setMenuOpen(false)}
          />
        </>
      ) : null}
    </div>
  );
}
