import { test as base, type Page } from '@playwright/test';

// Real Blissful auth (NOT Stremio — Stremio is only the optional "sync with
// Stremio" import). Registers throwaway accounts on the deployed blissful-storage
// and seeds the token so a page boots logged in. Lets the auth-gated features
// (library, friends, presence, party invites, addon install) be tested for REAL.

const STORAGE_HTTP = process.env.STORAGE_HTTP || 'https://blissful.budinoff.com/storage';
const TOKEN_KEY = 'bliss:authToken';

export type TestAccount = {
  token: string;
  id: string;
  username: string;
  displayName: string;
  password: string;
};

/** Register a fresh throwaway Blissful account (username is lowercase a-z0-9_). */
export async function registerAccount(tag = 'e2e'): Promise<TestAccount> {
  const username = `${tag}_${Math.random().toString(36).slice(2, 11)}`;
  const password = 'e2eP@ss' + Math.random().toString(36).slice(2, 10);
  const displayName = `E2E ${username}`;
  const res = await fetch(`${STORAGE_HTTP}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, displayName }),
  });
  if (!res.ok) throw new Error(`register failed (${res.status}): ${(await res.text()).slice(0, 140)}`);
  const { token, user } = await res.json();
  return { token, id: user.id, username, displayName, password };
}

/** Bearer-token fetch against blissful-storage. */
export async function api<T = unknown>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${STORAGE_HTTP}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${(await res.text()).slice(0, 140)}`);
  return (await res.json()) as T;
}

/** Seed a token so the app boots logged in on the next navigation. */
export async function loginAs(page: Page, token: string) {
  await page.addInitScript(({ key, t }) => localStorage.setItem(key, t), { key: TOKEN_KEY, t: token });
}

export const test = base.extend<{ account: TestAccount; loggedInPage: Page }>({
  account: async ({}, use) => {
    await use(await registerAccount());
  },
  loggedInPage: async ({ page, account }, use) => {
    await loginAs(page, account.token);
    await use(page);
  },
});

export { expect } from '@playwright/test';
