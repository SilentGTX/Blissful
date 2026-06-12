import { createMMKV } from 'react-native-mmkv';

// Synchronous key-value store (plan D7) — replaces the web app's localStorage.
// Auth token, player settings, progress, etc. live here under bliss* keys.
// react-native-mmkv v4 (Nitro) uses createMMKV() rather than `new MMKV()`.
const mmkv = createMMKV({ id: 'bliss' });

export const kv = {
  get(key: string): string | null {
    return mmkv.getString(key) ?? null;
  },
  set(key: string, value: string): void {
    mmkv.set(key, value);
  },
  remove(key: string): void {
    mmkv.remove(key);
  },
};
