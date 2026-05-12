import { useEffect } from 'react';

export function useNetflixReveal(
  isNetflix: boolean,
  rootRef: React.RefObject<HTMLDivElement | null>,
  deps: Array<string | number | boolean | undefined>
) {
  useEffect(() => {
    if (!isNetflix) return;
    const root = rootRef.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('.netflix-reveal'));
    if (targets.length === 0) return;

    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2, rootMargin: '0px 0px -10% 0px' }
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [isNetflix, rootRef, ...deps]);
}
