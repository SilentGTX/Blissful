// Compact relative-time formatter for "last seen N ago" labels.
//
// Outputs are intentionally short -- the sidebar row is narrow and
// crammed with name + status + icons, so we collapse to a handful of
// buckets instead of trying to be perfectly grammatical.

export function formatRelativeTime(epochMs: number | null | undefined): string {
  if (epochMs == null || !Number.isFinite(epochMs)) return '';
  const delta = Date.now() - epochMs;
  if (delta < 60_000) return 'just now';
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} wk ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} mo ago`;
  const years = Math.floor(days / 365);
  return `${years} yr ago`;
}
