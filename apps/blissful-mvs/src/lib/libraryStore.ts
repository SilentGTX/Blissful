export type LibraryEntry = {
  type: string;
  id: string;
  name: string;
  poster?: string;
  addedAt: number;
};

const KEY = 'blissfulLibraryV1';

function readAll(): LibraryEntry[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as LibraryEntry[];
  } catch {
    return [];
  }
}

function writeAll(items: LibraryEntry[]): void {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function isInLibrary(params: { type: string; id: string }): boolean {
  return readAll().some((e) => e.type === params.type && e.id === params.id);
}

export function toggleLibrary(entry: Omit<LibraryEntry, 'addedAt'>): boolean {
  const items = readAll();
  const idx = items.findIndex((e) => e.type === entry.type && e.id === entry.id);
  if (idx >= 0) {
    items.splice(idx, 1);
    writeAll(items);
    return false;
  }
  writeAll([{ ...entry, addedAt: Date.now() }, ...items]);
  return true;
}
