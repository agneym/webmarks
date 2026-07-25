import { inArray, eq } from "drizzle-orm";
import type { createDrizzle } from "../../db";
import { tag, bookmarkTag } from "../../db/schema";

type Db = ReturnType<typeof createDrizzle>;

export type BookmarkTag = { id: string; name: string };

/**
 * Batch-load tags for a set of bookmark IDs.
 * Returns a map of bookmarkId → tags (empty array when none).
 */
export async function loadTagsByBookmarkIds(
  db: Db,
  bookmarkIds: string[],
): Promise<Map<string, BookmarkTag[]>> {
  const tagsByBookmark = new Map<string, BookmarkTag[]>();
  for (const id of bookmarkIds) {
    tagsByBookmark.set(id, []);
  }

  if (bookmarkIds.length === 0) {
    return tagsByBookmark;
  }

  const rows = await db
    .select({
      bookmarkId: bookmarkTag.bookmarkId,
      id: tag.id,
      name: tag.name,
    })
    .from(bookmarkTag)
    .innerJoin(tag, eq(bookmarkTag.tagId, tag.id))
    .where(inArray(bookmarkTag.bookmarkId, bookmarkIds));

  for (const row of rows) {
    const list = tagsByBookmark.get(row.bookmarkId) ?? [];
    list.push({ id: row.id, name: row.name });
    tagsByBookmark.set(row.bookmarkId, list);
  }

  return tagsByBookmark;
}

/**
 * Attach a `tags` array to each bookmark row.
 */
export async function attachTagsToBookmarks<T extends { id: string }>(
  db: Db,
  bookmarks: T[],
): Promise<Array<T & { tags: BookmarkTag[] }>> {
  const tagsByBookmark = await loadTagsByBookmarkIds(
    db,
    bookmarks.map((b) => b.id),
  );

  return bookmarks.map((b) => ({
    ...b,
    tags: tagsByBookmark.get(b.id) ?? [],
  }));
}
