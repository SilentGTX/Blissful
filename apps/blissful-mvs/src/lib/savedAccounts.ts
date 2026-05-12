import type { StremioApiUser } from './stremioApi';

export type SavedAccount = {
  userId: string;
  email: string;
  authKey: string;
  lastUsedAt: string;
  displayName?: string;
  avatar?: string;
};

export type AccountProfile = {
  displayName: string;
  avatar?: string;
};

const SAVED_ACCOUNTS_KEY = 'stremioSavedAccounts';

export function getSavedAccounts(): SavedAccount[] {
  try {
    const raw = localStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedAccount[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.userId === 'string' && typeof item.authKey === 'string');
  } catch {
    return [];
  }
}

function writeSavedAccounts(accounts: SavedAccount[]) {
  localStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(accounts));
}

export function upsertSavedAccount(authKey: string, user: StremioApiUser, profile?: Partial<AccountProfile>) {
  const current = getSavedAccounts();
  const userId = user._id;
  const email = user.email ?? user._id;
  // Prefer authKey match so we never accidentally overwrite a different profile
  // that happens to share the same Stremio userId (same account, different session).
  let existingIndex = current.findIndex((item) => item.authKey === authKey);
  if (existingIndex < 0) {
    existingIndex = current.findIndex((item) => item.userId === userId);
  }
  const existing = existingIndex >= 0 ? current[existingIndex] : null;
  const next: SavedAccount = {
    userId,
    email,
    authKey,
    lastUsedAt: existing?.lastUsedAt ?? new Date().toISOString(),
    displayName: profile?.displayName ?? existing?.displayName,
    avatar: profile?.avatar ?? existing?.avatar,
  };

  if (existingIndex >= 0) {
    const updated = current.slice();
    updated[existingIndex] = next;
    writeSavedAccounts(updated);
    return;
  }

  writeSavedAccounts([...current, next]);
}

export function removeSavedAccount(authKey: string) {
  const current = getSavedAccounts();
  writeSavedAccounts(current.filter((item) => item.authKey !== authKey));
}

export function updateSavedAccountProfile(authKey: string, profile: Partial<AccountProfile>) {
  const current = getSavedAccounts();
  const next = current.map((item) => {
    if (item.authKey !== authKey) return item;
    return {
      ...item,
      displayName: profile.displayName ?? item.displayName,
      avatar: profile.avatar ?? item.avatar,
    };
  });
  writeSavedAccounts(next);
}
