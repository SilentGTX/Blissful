import { useEffect } from 'react';
import type { HomeRowPrefs } from '../../../lib/homeRows';
import { datastoreGetCollection } from '../../../lib/stremioApi';
import { readStoredHomePrefs } from '../utils';

export function useHomePrefsSync(
  authKey: string | null,
  setHomeRowPrefs: (value: HomeRowPrefs) => void
) {
  useEffect(() => {
    if (!authKey) {
      setHomeRowPrefs(readStoredHomePrefs() ?? { order: [], hidden: [] });
      return;
    }

    let cancelled = false;

    datastoreGetCollection<HomeRowPrefs>({ authKey, collection: 'blissful_home' })
      .then((items) => {
        if (cancelled) return;
        const stored = items.find((item) => item._id === 'home');
        if (stored?.data) {
          setHomeRowPrefs({
            order: stored.data.order ?? [],
            hidden: stored.data.hidden ?? [],
          });
          return;
        }
        const local = readStoredHomePrefs();
        if (local) setHomeRowPrefs(local);
      })
      .catch(() => {
        if (cancelled) return;
        setHomeRowPrefs(readStoredHomePrefs() ?? { order: [], hidden: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [authKey, setHomeRowPrefs]);
}
