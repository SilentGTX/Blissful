import type { UiStyle } from '../layout/app-shell/types';

// Kecflix ('netflix') is hidden for now: Settings doesn't offer it, and anyone
// still on it lands on the default instead. Flip to true to bring it back.
export const KECFLIX_ENABLED = false;

// TV replaced Classic as the default on 2026-10-31.
export const DEFAULT_UI_STYLE: UiStyle = 'tv';

// Classic was the old default, and the app saved it to the device and the
// account whether or not anyone picked it, so a stored 'classic' mostly means
// "never chose". Each device moves it to TV once, on its first load after the
// switch; choosing Classic after that sticks. This marker records that the
// device has done its one move.
export const TV_DEFAULT_MIGRATION_KEY = 'uiStyleTvDefaultMigrated';

/** Map a stored uiStyle (device or account) onto one the UI can render. */
export function normalizeUiStyle(raw: unknown, migrateClassic: boolean): UiStyle {
  // The old coverflow 'modern' theme was replaced in place by 'tv'.
  if (raw === 'tv' || raw === 'modern') return 'tv';
  if (raw === 'apple') return 'apple';
  if (raw === 'netflix') return KECFLIX_ENABLED ? 'netflix' : DEFAULT_UI_STYLE;
  if (raw === 'classic') return migrateClassic ? DEFAULT_UI_STYLE : 'classic';
  return DEFAULT_UI_STYLE;
}

/**
 * True on this device's first load after the switch, and writes the marker so
 * every later load returns false. The caller holds the answer for the whole
 * session, so both the device's stored style and the account's synced one
 * (which arrives later) get the same one-time move.
 */
export function consumeClassicMigration(storage: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  if (storage.getItem(TV_DEFAULT_MIGRATION_KEY)) return false;
  storage.setItem(TV_DEFAULT_MIGRATION_KEY, '1');
  return true;
}

export const classicMigrationPending: boolean = (() => {
  try {
    return consumeClassicMigration(localStorage);
  } catch {
    // No storage (private mode, tests): leave the stored style alone.
    return false;
  }
})();
