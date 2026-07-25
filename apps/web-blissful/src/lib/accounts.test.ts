import { describe, it, expect } from 'vitest';
import { refreshAccountUser, removeAccount, upsertAccount, type StoredAccount } from './accounts';
import type { BlissfulUser } from './blissfulAuthApi';

const user = (id: string, displayName = id): BlissfulUser =>
  ({ id, username: id, displayName } as BlissfulUser);
const acc = (id: string, token = `tok-${id}`): StoredAccount => ({ token, user: user(id) });

describe('upsertAccount', () => {
  it('appends a new profile, keeping switcher order stable', () => {
    const list = upsertAccount(upsertAccount([], acc('a')), acc('b'));
    expect(list.map((a) => a.user.id)).toEqual(['a', 'b']);
  });

  it('refreshes an existing profile IN PLACE on re-login (no duplicate row)', () => {
    // A second sign-in with the same account issues a NEW token; the switcher
    // must carry that token forward, not add a second "a".
    const list = upsertAccount([acc('a'), acc('b')], { token: 'tok-a2', user: user('a') });
    expect(list.map((x) => x.user.id)).toEqual(['a', 'b']);
    expect(list[0].token).toBe('tok-a2');
  });

  it('does not mutate the input', () => {
    const before = [acc('a')];
    upsertAccount(before, acc('b'));
    expect(before).toHaveLength(1);
  });
});

describe('removeAccount', () => {
  it('drops only the named profile', () => {
    expect(removeAccount([acc('a'), acc('b')], 'a').map((x) => x.user.id)).toEqual(['b']);
  });

  it('is a no-op for an unknown id', () => {
    expect(removeAccount([acc('a')], 'zz').map((x) => x.user.id)).toEqual(['a']);
  });
});

describe('refreshAccountUser', () => {
  it('updates the cached snapshot after a profile edit', () => {
    const list = refreshAccountUser([acc('a'), acc('b')], user('a', 'Renamed'));
    expect(list[0].user.displayName).toBe('Renamed');
    expect(list[0].token).toBe('tok-a'); // token untouched
  });

  it('ignores a user that is not in the switcher', () => {
    const before = [acc('a')];
    expect(refreshAccountUser(before, user('zz'))).toBe(before);
  });
});
