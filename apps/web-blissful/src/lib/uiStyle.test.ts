import { describe, it, expect } from 'vitest';
import {
  consumeClassicMigration,
  DEFAULT_UI_STYLE,
  KECFLIX_ENABLED,
  normalizeUiStyle,
  TV_DEFAULT_MIGRATION_KEY,
} from './uiStyle';

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
  };
}

describe('normalizeUiStyle', () => {
  it('defaults to TV when nothing (or something unknown) is stored', () => {
    expect(DEFAULT_UI_STYLE).toBe('tv');
    expect(normalizeUiStyle(null, false)).toBe('tv');
    expect(normalizeUiStyle(undefined, true)).toBe('tv');
    expect(normalizeUiStyle('bogus', false)).toBe('tv');
  });

  it('moves Classic to TV only while the one-time migration is pending', () => {
    expect(normalizeUiStyle('classic', true)).toBe('tv');
    // After the move, choosing Classic sticks.
    expect(normalizeUiStyle('classic', false)).toBe('classic');
  });

  it('keeps TV, and maps the retired modern theme onto it', () => {
    expect(normalizeUiStyle('tv', true)).toBe('tv');
    expect(normalizeUiStyle('tv', false)).toBe('tv');
    expect(normalizeUiStyle('modern', false)).toBe('tv');
  });

  it('keeps Apple, including while the Classic migration is pending', () => {
    expect(normalizeUiStyle('apple', true)).toBe('apple');
    expect(normalizeUiStyle('apple', false)).toBe('apple');
  });

  it('sends Kecflix to the default while it is hidden', () => {
    const expected = KECFLIX_ENABLED ? 'netflix' : 'tv';
    expect(normalizeUiStyle('netflix', false)).toBe(expected);
    expect(normalizeUiStyle('netflix', true)).toBe(expected);
  });
});

describe('consumeClassicMigration', () => {
  it('is pending exactly once per device', () => {
    const storage = memoryStorage();
    expect(consumeClassicMigration(storage)).toBe(true);
    expect(storage.getItem(TV_DEFAULT_MIGRATION_KEY)).toBe('1');
    expect(consumeClassicMigration(storage)).toBe(false);
  });

  it('is not pending on a device that already migrated', () => {
    expect(consumeClassicMigration(memoryStorage({ [TV_DEFAULT_MIGRATION_KEY]: '1' }))).toBe(false);
  });
});
