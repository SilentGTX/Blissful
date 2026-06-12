import { useEffect, useRef } from 'react';
import { BlissAvatar, BlissButton } from '../../../components/base';
import type { CompatUser } from '../../../context/AuthProvider';
import { renderProfileAvatar } from '../../../lib/profileAvatars';

type AccountModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  user: CompatUser | null;
  displayName: string;
  avatar?: string;
  isFullscreen: boolean;
  onLogout: () => void;
  onLogin: () => void;
  onNavigateSettings: () => void;
  onOpenHomeSettings: () => void;
  onOpenProfiles: () => void;
  onToggleFullscreen: () => void;
};

export function AccountModal({
  isOpen,
  onOpenChange,
  user,
  displayName,
  avatar,
  isFullscreen,
  onLogout,
  onLogin,
  onNavigateSettings,
  onOpenHomeSettings,
  onOpenProfiles,
  onToggleFullscreen,
}: AccountModalProps) {
  const avatarView = renderProfileAvatar(avatar, displayName.slice(0, 1).toUpperCase());
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    // Delay listener to avoid catching the same click that opened it
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 10);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [isOpen, onOpenChange]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onOpenChange]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-md">
      <div
        ref={panelRef}
        className="absolute right-4 solid-surface w-[320px] rounded-[24px] bg-white/20 p-5"
        style={{ top: 'calc(var(--horizontal-nav-bar-size) + var(--horizontal-nav-margin) * 2 + env(safe-area-inset-top) + 0.25rem)' }}
      >
        <div className="flex items-center gap-3">
          <BlissAvatar
            className="h-12 w-12 cursor-pointer"
            onClick={() => {
              onOpenChange(false);
              onOpenProfiles();
            }}
          >
            {avatarView.kind === 'image' ? (
              <BlissAvatar.Image alt={displayName} src={avatarView.value} />
            ) : null}
            <BlissAvatar.Fallback className="text-2xl leading-none">
              {avatarView.kind === 'image' ? displayName.slice(0, 1).toUpperCase() : avatarView.value}
            </BlissAvatar.Fallback>
          </BlissAvatar>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">
              {displayName || user?.username || user?.email || user?._id || 'Guest'}
            </div>
            <div className="text-xs text-foreground/60">Account</div>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {user ? (
            <BlissButton
              size="sm"
              tone="solid"
              onPress={() => {
                onLogout();
                onOpenChange(false);
              }}
            >
              Logout
            </BlissButton>
          ) : (
            <BlissButton
              size="sm"
              tone="solid"
              onPress={() => {
                onOpenChange(false);
                onLogin();
              }}
            >
              Login
            </BlissButton>
          )}
        </div>

        <div className="mt-6 space-y-2">
          {/* Full-screen toggle. Stays a BlissButton so its padding/height
              line up with the rows below; justify-between puts the label
              left and an accent toggle right. The menu stays open on press
              so the toggle visibly flips — `isFullscreen` updates from the
              shell/document fullscreenchange event, so it reflects the real
              state (incl. F11 / Esc done outside this menu). */}
          <BlissButton
            variant="ghost"
            className="w-full justify-between rounded-2xl bg-white/20"
            onPress={() => onToggleFullscreen()}
          >
            <span>Full screen mode</span>
            <span
              aria-hidden
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${isFullscreen ? 'bg-[var(--bliss-accent)]' : 'bg-white/25'}`}
            >
              <span
                className={`absolute top-1 h-4 w-4 rounded-full transition-all ${isFullscreen ? 'left-6 bg-black' : 'left-1 bg-white'}`}
              />
            </span>
          </BlissButton>
          <BlissButton
            variant="ghost"
            className="w-full justify-start rounded-2xl bg-white/20"
            onPress={() => {
              onOpenChange(false);
              onNavigateSettings();
            }}
          >
            Settings
          </BlissButton>
          <BlissButton
            variant="ghost"
            className="w-full justify-start rounded-2xl bg-white/20"
            onPress={() => {
              onOpenChange(false);
              onOpenHomeSettings();
            }}
          >
            Customize Home
          </BlissButton>
        </div>
      </div>
    </div>
  );
}
