// Cinemeta gives an ongoing (still-airing) series an open-ended range like
// "2022–" — a start year then a trailing en-dash with no end year. Render that as
// "2022–Now". Movies and ended series ("2019", "2016–2022") pass through unchanged.
export function formatReleaseInfo(info: string | null | undefined): string {
  if (!info) return '';
  const t = info.trim();
  // Ends in a hyphen / en-dash / em-dash with nothing after → still releasing.
  if (/[-–—]\s*$/.test(t)) return t.replace(/\s*[-–—]\s*$/, '–Now');
  return t;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// "March 6, 2026" — the Detail page's release-date format (shared with the Home hero).
export function formatFullDate(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
