type Listener = (src: string | null) => void;
const listeners = new Set<Listener>();
let _current: string | null = null;

export function showHeroTransition(src: string | null): void {
  _current = src;
  listeners.forEach(l => l(src));
}

export function subscribeHeroTransition(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getHeroTransition(): string | null {
  return _current;
}
