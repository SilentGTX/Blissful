// Multi-profile account storage for web + desktop. Ported from the TV app's
// `src/lib/accounts.ts` so all three clients behave identically.
//
// The auth layer stays single-token — `bliss:authToken` is the ACTIVE profile.
// This module just remembers every profile that has signed in on this device so
// the avatar menu can switch between them without retyping a password. Because
// Continue Watching / library / settings / friends / presence are all
// server-side and keyed by the token, swapping the active token is the whole
// switch: every token-keyed effect re-fetches that profile's data.

import type { BlissfulUser } from './blissfulAuthApi';

const ACCOUNTS_KEY = 'bliss:accounts';

/** A saved profile: its auth token + a cached user snapshot for the switcher UI
 *  (so the avatar/name render instantly, before /auth/me round-trips). */
export type StoredAccount = { token: string; user: BlissfulUser };

export function readAccounts(): StoredAccount[] {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is StoredAccount =>
        !!a &&
        typeof (a as StoredAccount).token === 'string' &&
        !!(a as StoredAccount).user &&
        typeof (a as StoredAccount).user.id === 'string',
    );
  } catch {
    return [];
  }
}

export function writeAccounts(accounts: StoredAccount[]): void {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    /* quota / private mode — the switcher just won't persist this round */
  }
}

/** Upsert by user id — a re-login of the same account refreshes its token +
 *  profile in place (never duplicates); a new account appends. Insertion order
 *  is preserved so the switcher list is stable. Returns a new array. */
export function upsertAccount(accounts: StoredAccount[], acc: StoredAccount): StoredAccount[] {
  const idx = accounts.findIndex((a) => a.user.id === acc.user.id);
  if (idx === -1) return [...accounts, acc];
  const next = accounts.slice();
  next[idx] = acc;
  return next;
}

/** Drop one profile from the switcher (signing it out of this device). */
export function removeAccount(accounts: StoredAccount[], userId: string): StoredAccount[] {
  return accounts.filter((a) => a.user.id !== userId);
}

/** Keep the cached snapshot fresh after a profile edit (rename / new avatar),
 *  so the switcher doesn't show a stale name. No-op when the user isn't saved. */
export function refreshAccountUser(accounts: StoredAccount[], user: BlissfulUser): StoredAccount[] {
  const idx = accounts.findIndex((a) => a.user.id === user.id);
  if (idx === -1) return accounts;
  const next = accounts.slice();
  next[idx] = { ...next[idx], user };
  return next;
}
