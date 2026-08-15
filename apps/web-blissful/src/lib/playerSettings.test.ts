import { describe, it, expect } from 'vitest';
import { PLAYER_LANGUAGE_OPTIONS, PINNED_LANGUAGE_CODES } from './playerSettings';

describe('PLAYER_LANGUAGE_OPTIONS ordering', () => {
  it('leads with None, then English, then Bulgarian', () => {
    expect(PLAYER_LANGUAGE_OPTIONS[0].value).toBeNull();
    expect(PLAYER_LANGUAGE_OPTIONS.slice(1, 3).map((o) => o.value)).toEqual(['eng', 'bul']);
  });

  it('keeps the remaining languages alphabetical by label', () => {
    const rest = PLAYER_LANGUAGE_OPTIONS.slice(1 + PINNED_LANGUAGE_CODES.length).map((o) => o.label);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  it('does not duplicate or drop any language', () => {
    const values = PLAYER_LANGUAGE_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});
