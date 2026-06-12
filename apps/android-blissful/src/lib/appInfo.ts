// App identity for the Settings -> About panel.
//
// The desktop SettingsPage reads the version from the native shell
// (desktop.getAppVersion()). On RN that bridge doesn't exist, and
// expo-constants is NOT a direct dependency of this app (so we can't import
// Constants.expoConfig.version without adding it to package.json). We keep a
// hand-maintained constant here, sourced from apps/android-blissful/package.json
// ("version": "1.0.0"). Bump this when the app version bumps.
//
// FOLLOW-UP: when expo-constants (or expo-application) is added as a dep, swap
// APP_VERSION for Constants.expoConfig?.version ?? '...' so it stays in sync
// with app.json automatically.
export const APP_NAME = 'Blissful';
export const APP_TAGLINE = 'A native Stremio client for movies and TV.';
export const APP_VERSION = '1.0.0';
