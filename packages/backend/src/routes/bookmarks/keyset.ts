import { asc, desc, sql, type SQL } from "drizzle-orm";

import { bookmark } from "../../db/schema";
import type { SortOrder } from "../../lib/cursor";

/**
 * Keyset (seek) pagination support for the bookmark list.
 *
 * Every ordering ends in `id`, so the sort is total — without a unique
 * tiebreaker, rows sharing a sort key (same created_at, same title) can be
 * repeated or skipped between pages.
 */

/** NULL titles compare as '' so the sort key is always comparable in a cursor. */
const titleKey = sql`coalesce(${bookmark.title}, '')`;

/** ORDER BY clause matching each sort's keyset predicate. */
export function buildOrderBy(sort: SortOrder): SQL[] {
  switch (sort) {
    case "oldest":
      return [asc(bookmark.createdAt), asc(bookmark.id)];
    case "title":
      return [asc(titleKey), asc(bookmark.id)];
    case "title_desc":
      return [desc(titleKey), desc(bookmark.id)];
    case "updated":
      return [desc(bookmark.updatedAt), desc(bookmark.id)];
    case "newest":
    default:
      return [desc(bookmark.createdAt), desc(bookmark.id)];
  }
}

/** True when the sort walks its key in descending order. */
function isDescending(sort: SortOrder): boolean {
  return sort === "newest" || sort === "title_desc" || sort === "updated";
}

/** The column a sort orders by, as it appears in both ORDER BY and the predicate. */
function sortColumn(sort: SortOrder): SQL {
  switch (sort) {
    case "updated":
      return sql`${bookmark.updatedAt}`;
    case "title":
    case "title_desc":
      return titleKey;
    case "newest":
    case "oldest":
    default:
      return sql`${bookmark.createdAt}`;
  }
}

/**
 * Rows strictly after the cursor position in this sort order:
 * `key < k OR (key = k AND id < i)` for descending sorts, mirrored for ascending.
 */
export function buildKeysetPredicate(sort: SortOrder, key: string | number, id: string): SQL {
  const column = sortColumn(sort);
  const comparison = isDescending(sort) ? sql`<` : sql`>`;
  return sql`(${column} ${comparison} ${key} OR (${column} = ${key} AND ${bookmark.id} ${comparison} ${id}))`;
}

/** The cursor key for a row: matches exactly what the predicate compares against. */
export function sortKeyOf(
  row: { createdAt: Date; updatedAt: Date; title: string | null },
  sort: SortOrder,
): string | number {
  switch (sort) {
    case "title":
    case "title_desc":
      return row.title ?? "";
    case "updated":
      return row.updatedAt.getTime();
    case "newest":
    case "oldest":
    default:
      return row.createdAt.getTime();
  }
}
