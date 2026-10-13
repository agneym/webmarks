/**
 * Tag suggestion rules. The bookmark collection favours a few deliberate
 * tags, so existing tags are the easy path and a new tag is only created when
 * the user explicitly asks for one.
 */

export type Tag = { id: string; name: string; bookmarkCount: number };

const byUse = (a: Tag, b: Tag) => b.bookmarkCount - a.bookmarkCount || a.name.localeCompare(b.name);

/** Existing tags to offer for `query`: prefix matches first, then substrings. */
export function suggestTags(all: Tag[], query: string, selected: string[], limit = 6): Tag[] {
  const taken = new Set(selected.map((s) => s.toLowerCase()));
  const q = query.trim().toLowerCase();
  const open = all.filter((t) => !taken.has(t.name.toLowerCase()));
  if (!q) return open.toSorted(byUse).slice(0, limit);
  const prefix = open.filter((t) => t.name.toLowerCase().startsWith(q)).toSorted(byUse);
  const inner = open
    .filter((t) => !t.name.toLowerCase().startsWith(q) && t.name.toLowerCase().includes(q))
    .toSorted(byUse);
  return [...prefix, ...inner].slice(0, limit);
}

/**
 * The tag name a "create" action would add, or null when there is nothing new
 * to create. Tag names are case-sensitive on the server, so a case-insensitive
 * match with an existing tag reuses it instead of creating a near-duplicate.
 */
export function newTagName(all: Tag[], query: string, selected: string[]): string | null {
  const name = query.trim();
  if (!name) return null;
  const lower = name.toLowerCase();
  if (all.some((t) => t.name.toLowerCase() === lower)) return null;
  if (selected.some((s) => s.toLowerCase() === lower)) return null;
  return name;
}
