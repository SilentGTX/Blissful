import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSeekCoalescer, isBufferingState } from './playerBuffering';

const base = { readyState: 4, paused: false, seeking: false, ended: false };

describe('isBufferingState', () => {
  it('is buffering while playing without future data', () => {
    expect(isBufferingState({ ...base, readyState: 0 })).toBe(true);
    expect(isBufferingState({ ...base, readyState: 2 })).toBe(true);
  });
  it('is not buffering while playing with future data', () => {
    expect(isBufferingState({ ...base, readyState: 3 })).toBe(false);
    expect(isBufferingState({ ...base, readyState: 4 })).toBe(false);
  });
  it('treats a paused frame (HAVE_CURRENT_DATA) as ready', () => {
    expect(isBufferingState({ ...base, paused: true, readyState: 2 })).toBe(false);
  });
  it('still buffers when paused with no frame at all', () => {
    expect(isBufferingState({ ...base, paused: true, readyState: 1 })).toBe(true);
    expect(isBufferingState({ ...base, paused: true, readyState: 0 })).toBe(true);
  });
  it('a paused seek needs future data before it counts as loaded', () => {
    expect(isBufferingState({ ...base, paused: true, seeking: true, readyState: 2 })).toBe(true);
    expect(isBufferingState({ ...base, paused: true, seeking: true, readyState: 4 })).toBe(false);
  });
  it('never buffers once ended', () => {
    expect(isBufferingState({ ...base, ended: true, readyState: 1 })).toBe(false);
    expect(isBufferingState({ ...base, ended: true, paused: true, readyState: 0 })).toBe(false);
  });
});

describe('createSeekCoalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies a burst of relative seeks once, accumulating from the pending target', () => {
    const apply = vi.fn();
    const c = createSeekCoalescer({ apply, delayMs: 200 });
    // currentTime stays 100 for the whole burst: it only moves when applied.
    expect(c.seekBy(5, 100, 1000)).toBe(105);
    expect(c.seekBy(5, 100, 1000)).toBe(110);
    expect(c.seekBy(5, 100, 1000)).toBe(115);
    vi.advanceTimersByTime(199);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(115);
  });

  it('restarts the quiet window on every input', () => {
    const apply = vi.fn();
    const c = createSeekCoalescer({ apply, delayMs: 200 });
    c.seekBy(5, 0, 100);
    vi.advanceTimersByTime(150);
    c.seekBy(5, 0, 100);
    vi.advanceTimersByTime(150);
    expect(apply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(10);
  });

  it('clamps to [0, duration]', () => {
    const apply = vi.fn();
    const c = createSeekCoalescer({ apply });
    expect(c.seekBy(-30, 10, 100)).toBe(0);
    expect(c.seekBy(500, 10, 100)).toBe(100);
    vi.runAllTimers();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(100);
  });

  it('does not clamp the upper bound when the duration is unknown', () => {
    const c = createSeekCoalescer({ apply: vi.fn() });
    expect(c.seekBy(30, 10, NaN)).toBe(40);
    expect(c.seekBy(30, 10)).toBe(70);
  });

  it('seekTo replaces the pending target', () => {
    const apply = vi.fn();
    const c = createSeekCoalescer({ apply });
    c.seekBy(5, 100, 1000);
    expect(c.seekTo(300, 1000)).toBe(300);
    vi.runAllTimers();
    expect(apply).toHaveBeenCalledWith(300);
  });

  it('flush applies immediately and only once', () => {
    const apply = vi.fn();
    const c = createSeekCoalescer({ apply });
    c.seekBy(5, 10, 100);
    c.flush();
    expect(apply).toHaveBeenCalledWith(15);
    c.flush();
    vi.runAllTimers();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(c.hasPending()).toBe(false);
  });

  it('starts a fresh accumulation from `from` after applying', () => {
    const apply = vi.fn();
    const c = createSeekCoalescer({ apply });
    c.seekBy(5, 10, 100);
    vi.runAllTimers();
    c.seekBy(5, 15, 100);
    vi.runAllTimers();
    expect(apply.mock.calls).toEqual([[15], [20]]);
  });

  it('cancel drops the pending seek', () => {
    const apply = vi.fn();
    const c = createSeekCoalescer({ apply });
    c.seekBy(5, 10, 100);
    c.cancel();
    vi.runAllTimers();
    expect(apply).not.toHaveBeenCalled();
    expect(c.hasPending()).toBe(false);
  });
});
