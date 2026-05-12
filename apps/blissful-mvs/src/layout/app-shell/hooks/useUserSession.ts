import { useEffect } from 'react';
import { getUser, type StremioApiUser } from '../../../lib/stremioApi';

type UseUserSessionParams = {
  authKey: string | null;
  setAuthKey: (value: string | null) => void;
  setUser: (value: StremioApiUser | null) => void;
};

export function useUserSession({ authKey, setAuthKey, setUser }: UseUserSessionParams) {
  useEffect(() => {
    if (!authKey) return;

    let cancelled = false;

    getUser({ authKey })
      .then((freshUser) => {
        if (cancelled) return;
        setUser(freshUser);
        localStorage.setItem('stremioUser', JSON.stringify(freshUser));
      })
      .catch(() => {
        if (cancelled) return;
        localStorage.removeItem('stremioAuthKey');
        localStorage.removeItem('stremioUser');
        setAuthKey(null);
        setUser(null);
      });

    return () => {
      cancelled = true;
    };
  }, [authKey, setAuthKey, setUser]);
}
