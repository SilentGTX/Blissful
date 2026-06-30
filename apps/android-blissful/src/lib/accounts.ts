// Multi-profile account storage. The app is single-token at the auth layer
// (`bliss:authToken` is the ACTIVE profile), but a TV is shared, so we persist
// every signed-in account here and let the avatar menu switch between them
// instantly. Because Continue Watching / library / settings / presence are all
// server-side and keyed by the token, switching the active token is all it
// takes — the token-keyed effects (HomeScreen, AuthContext settings hydrate,
// UserSocketContext) re-fetch that profile's data automatically.
import { kv } from './storage';
import type { BlissfulUser } from '@blissful/core';

const ACCOUNTS_KEY = 'bliss:accounts';

/** A saved profile: its auth token + a cached user snapshot for the switcher UI
 *  (so the avatar/name render instantly, before /auth/me round-trips). */
export type StoredAccount = { token: string; user: BlissfulUser };

export function readAccounts(): StoredAccount[] {
  try {
    const raw = kv.get(ACCOUNTS_KEY);
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
    kv.set(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    /* ignore — switcher just won't persist this round */
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
