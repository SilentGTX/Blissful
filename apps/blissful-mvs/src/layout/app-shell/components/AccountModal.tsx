import { useEffect, useRef } from 'react';
import { Avatar, Button } from '@heroui/react';
import type { StremioApiUser } from '../../../lib/stremioApi';
import { renderProfileAvatar } from '../../../lib/profileAvatars';

type AccountModalProps = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  user: StremioApiUser | null;
  displayName: string;
  avatar?: string;
  isFullscreen: boolean;
  onLogout: () => void;
  onLogin: () => void;
  onNavigateSettings: () => void;
  onOpenHomeSettings: () => void;
  onNavigateAddons: () => void;
  onNavigateAccounts: () => void;
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
  onNavigateAddons,
  onNavigateAccounts,
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
          <Avatar
            className="h-12 w-12 cursor-pointer bg-transparent rounded-none"
            onClick={() => {
              onOpenChange(false);
              onOpenProfiles();
            }}
          >
            {avatarView.kind === 'image' ? (
              <Avatar.Image alt={displayName} src={avatarView.value} className="object-contain" />
            ) : null}
            <Avatar.Fallback className="border-none bg-transparent text-2xl leading-none">
              {avatarView.kind === 'image' ? displayName.slice(0, 1).toUpperCase() : avatarView.value}
            </Avatar.Fallback>
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">
              {displayName || user?.email || user?._id || 'Guest'}
            </div>
            <div className="text-xs text-foreground/60">Account</div>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          {user ? (
            <Button
              size="sm"
              className="rounded-full bg-white text-black"
              onPress={() => {
                onLogout();
                onOpenChange(false);
              }}
            >
              Logout
            </Button>
          ) : (
            <Button
              size="sm"
              className="rounded-full bg-white text-black"
              onPress={() => {
                onOpenChange(false);
                onLogin();
              }}
            >
              Login
            </Button>
          )}
        </div>

        <div className="mt-6 space-y-2">
          <Button
            variant="ghost"
            className="w-full justify-start rounded-2xl bg-white/20"
            onPress={() => {
              onOpenChange(false);
              onToggleFullscreen();
            }}
          >
            <span style={{ color: '#19f7d2' }}>{isFullscreen ? 'Exit full screen mode' : 'Enter full screen mode'}</span>
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start rounded-2xl bg-white/20"
            onPress={() => {
              onOpenChange(false);
              onNavigateSettings();
            }}
          >
            Settings
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start rounded-2xl bg-white/20"
            onPress={() => {
              onOpenChange(false);
              onOpenHomeSettings();
            }}
          >
            Customize Home
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start rounded-2xl bg-white/20"
            onPress={() => {
              onOpenChange(false);
              onNavigateAddons();
            }}
          >
            Addons
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start rounded-2xl bg-white/20"
            onPress={() => {
              onOpenChange(false);
              onNavigateAccounts();
            }}
          >
            Manage accounts
          </Button>
        </div>
      </div>
    </div>
  );
}
