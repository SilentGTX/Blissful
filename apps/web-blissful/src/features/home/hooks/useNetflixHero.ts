import { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem } from '../../../types/media';
import type { StremioMetaDetail } from '../../../lib/stremioAddon';
import { fetchMeta } from '../../../lib/stremioAddon';

type NetflixHeroState = {
  hero: MediaItem | undefined;
  heroMeta: StremioMetaDetail | null;
  heroPrev: MediaItem | null;
  heroPrevMeta: StremioMetaDetail | null;
  heroIsFading: boolean;
  heroFadeIn: boolean;
};

export function useNetflixHero(
  isNetflix: boolean,
  movieItems: MediaItem[],
  seriesItems: MediaItem[]
): NetflixHeroState {
  const [heroPick, setHeroPick] = useState<MediaItem | null>(null);
  const [heroPrev, setHeroPrev] = useState<MediaItem | null>(null);
  const [heroPrevMeta, setHeroPrevMeta] = useState<StremioMetaDetail | null>(null);
  const [heroIsFading, setHeroIsFading] = useState(false);
  const [heroFadeIn, setHeroFadeIn] = useState(false);
  const heroMetaCacheRef = useRef<Map<string, StremioMetaDetail>>(new Map());

  const heroCandidates = useMemo(() => {
    const combined = [...movieItems, ...seriesItems].filter((item) => item.posterUrl);
    return combined.slice(0, 24);
  }, [movieItems, seriesItems]);

  const baseHero = movieItems[0] ?? seriesItems[0];
  const hero = isNetflix ? heroPick ?? heroCandidates[0] ?? baseHero : baseHero;
  const [heroMeta, setHeroMeta] = useState<StremioMetaDetail | null>(null);

  useEffect(() => {
    if (!isNetflix) {
      setHeroPick(null);
      setHeroPrev(null);
      setHeroPrevMeta(null);
      setHeroIsFading(false);
      setHeroFadeIn(false);
      return;
    }
    if (heroCandidates.length === 0) {
      setHeroPick(null);
      return;
    }
    setHeroPick((prev) => {
      if (prev && heroCandidates.some((item) => item.id === prev.id)) return prev;
      const next = heroCandidates[Math.floor(Math.random() * heroCandidates.length)];
      return next ?? heroCandidates[0];
    });
    setHeroFadeIn(true);
  }, [heroCandidates, isNetflix]);

  useEffect(() => {
    if (!isNetflix) return;
    if (!hero) return;
    if (!heroIsFading) {
      setHeroFadeIn(true);
    }
  }, [hero, heroIsFading, isNetflix]);

  useEffect(() => {
    if (!isNetflix || heroCandidates.length < 2) return;
    const pickNext = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      setHeroPick((prev) => {
        if (heroCandidates.length === 0) return prev;
        let next = prev;
        for (let i = 0; i < 6; i += 1) {
          const candidate = heroCandidates[Math.floor(Math.random() * heroCandidates.length)];
          if (!prev || candidate.id !== prev.id) {
            next = candidate;
            break;
          }
        }
        if (prev && next && prev.id !== next.id) {
          setHeroPrev(prev);
          setHeroPrevMeta(heroMetaCacheRef.current.get(prev.id) ?? heroMeta);
        }
        return next ?? prev ?? heroCandidates[0];
      });
      setHeroFadeIn(false);
      setHeroIsFading(true);
      window.requestAnimationFrame(() => setHeroFadeIn(true));
      window.setTimeout(() => {
        setHeroPrev(null);
        setHeroPrevMeta(null);
        setHeroIsFading(false);
      }, 1600);
    };

    const interval = window.setInterval(pickNext, 8000);
    return () => window.clearInterval(interval);
  }, [heroCandidates, heroMeta, isNetflix]);

  useEffect(() => {
    if (!hero) {
      setHeroMeta(null);
      return;
    }
    const cached = heroMetaCacheRef.current.get(hero.id);
    if (cached) {
      setHeroMeta(cached);
    } else {
      setHeroMeta(null);
    }
    let cancelled = false;

    const loadHeroMeta = async () => {
      try {
        const resp = await fetchMeta({ type: hero.type, id: hero.id });
        if (cancelled) return;
        heroMetaCacheRef.current.set(hero.id, resp);
        setHeroMeta(resp);
      } catch {
        if (!cancelled) setHeroMeta(null);
      }
    };

    void loadHeroMeta();

    return () => {
      cancelled = true;
    };
  }, [hero]);

  return {
    hero,
    heroMeta,
    heroPrev,
    heroPrevMeta,
    heroIsFading,
    heroFadeIn,
  };
}
