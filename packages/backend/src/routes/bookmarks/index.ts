import { OpenAPIHono } from "@hono/zod-openapi";
import { v7 as uuidv7 } from "uuid";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";

import type { Auth } from "../../lib/auth";
import {
  DEFAULT_SORT,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
  isSortOrder,
  type CursorPayload,
  type SortOrder,
} from "../../lib/cursor";
import { createDrizzle } from "../../db";
import { bookmark } from "../../db/schema";
import { tag, bookmarkTag } from "../../db/schema";

import { buildKeysetPredicate, buildOrderBy, sortKeyOf } from "./keyset";

import { createBookmarkRoute } from "./create";
import { listBookmarksRoute } from "./list";
import { getBookmarkRoute } from "./get";
import { updateBookmarkRoute } from "./update";
import { deleteBookmarkRoute } from "./delete";
import { setBookmarkTagsRoute, getBookmarkTagsRoute } from "./tags";
import { attachTagsToBookmarks } from "./attach-tags";

type Bindings = CloudflareBindings;
type Variables = { auth: Auth; logger: import("pino").Logger; userId?: string };

const bookmarks = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// --- Optional auth (public can read; mutations require a session) ---

bookmarks.use("*", async (c, next) => {
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (session) {
    c.set("userId", session.user.id);
  }
  await next();
});

// --- Route handlers ---

// POST / — create a bookmark (enqueues background metadata fetch)
bookmarks.openapi(createBookmarkRoute, async (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { url, visibility } = c.req.valid("json");
  const id = uuidv7();
  const db = createDrizzle(c.env.webmarks);

  // Check for duplicate URL for this user
  const [existing] = await db
    .select({ id: bookmark.id })
    .from(bookmark)
    .where(and(eq(bookmark.userId, userId), eq(bookmark.url, url)))
    .limit(1);

  if (existing) {
    return c.json({ error: "Bookmark already exists for this URL" }, 409);
  }

  const [row] = await db
    .insert(bookmark)
    .values({
      id,
      userId,
      url,
      fetchStatus: "pending",
      visibility: visibility ?? "public",
    })
    .returning();

  if (!row) {
    throw new Error("Failed to create bookmark");
  }

  // Enqueue background metadata fetch
  await c.env.BOOKMARK_QUEUE.send({ bookmarkId: id, url });

  const [withTags] = await attachTagsToBookmarks(db, [row]);

  c.var.logger.info({ id, userId, url, visibility: row.visibility }, "bookmark created");
  return c.json(withTags, 201);
});

// GET / — list bookmarks
// - Unauthenticated: public bookmarks only
// - Authenticated: caller's bookmarks (optionally filtered by visibility)
bookmarks.openapi(listBookmarksRoute, async (c) => {
  const userId = c.get("userId");
  const db = createDrizzle(c.env.webmarks);

  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "50"), 1), 100);
  const sortParam = c.req.query("sort") ?? DEFAULT_SORT;
  const sort: SortOrder = isSortOrder(sortParam) ? sortParam : DEFAULT_SORT;
  const q = c.req.query("q");
  const tagFilter = c.req.query("tag");
  const fetchStatus = c.req.query("fetchStatus");
  const visibilityFilter = c.req.query("visibility") as "public" | "private" | undefined;

  // Decode the cursor before touching the DB so a bad one is a cheap 400.
  // The cursor carries its own sort, so a mismatch can't silently skip rows.
  const rawCursor = c.req.query("cursor");
  let cursor: CursorPayload | undefined;
  if (rawCursor !== undefined) {
    try {
      cursor = decodeCursor(rawCursor, sort);
    } catch (err) {
      if (err instanceof InvalidCursorError) {
        return c.json({ error: err.message }, 400);
      }
      throw err;
    }
  }

  // Build WHERE conditions
  const conditions: ReturnType<typeof eq>[] = [];

  if (userId) {
    conditions.push(eq(bookmark.userId, userId));
    if (visibilityFilter) {
      conditions.push(eq(bookmark.visibility, visibilityFilter));
    }
  } else {
    // Public feed — anyone may read public bookmarks (private filter is ignored)
    conditions.push(eq(bookmark.visibility, "public"));
  }

  // Text search across title, description, and URL
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        like(bookmark.title, pattern),
        like(bookmark.description, pattern),
        like(bookmark.url, pattern),
      )!,
    );
  }

  // Filter by fetch status
  if (fetchStatus) {
    conditions.push(eq(bookmark.fetchStatus, fetchStatus as "pending" | "success" | "failed"));
  }

  // Filter by tag name -> subquery for bookmark IDs with that tag
  if (tagFilter) {
    const taggedIds = db
      .select({ bookmarkId: bookmarkTag.bookmarkId })
      .from(bookmarkTag)
      .innerJoin(tag, eq(bookmarkTag.tagId, tag.id))
      .where(
        userId ? and(eq(tag.userId, userId), eq(tag.name, tagFilter)) : eq(tag.name, tagFilter),
      );
    conditions.push(inArray(bookmark.id, taggedIds));
  }

  // Filters define the whole result set; `total` counts all of it, so callers
  // get a stable number on every page.
  const filters = and(...conditions);

  const [countRow] = await db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(bookmark)
    .where(filters);
  const total = countRow?.total ?? 0;

  // Keyset seek narrows the result set to this page: everything after the
  // cursor position in this sort's order.
  const where = cursor ? and(filters, buildKeysetPredicate(sort, cursor.k, cursor.i)) : filters;

  // Fetch one extra row: its presence is what tells us another page exists,
  // without a second round trip.
  const rows = await db
    .select()
    .from(bookmark)
    .where(where)
    .orderBy(...buildOrderBy(sort))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  const nextCursor =
    hasMore && last ? encodeCursor({ s: sort, k: sortKeyOf(last, sort), i: last.id }) : null;

  const withTags = await attachTagsToBookmarks(db, page);
  return c.json({ bookmarks: withTags, total, limit, nextCursor, hasMore }, 200);
});

// GET /:id — get a single bookmark (public ok; private requires owner)
bookmarks.openapi(getBookmarkRoute, async (c) => {
  const { id } = c.req.valid("param");
  const userId = c.get("userId");
  const db = createDrizzle(c.env.webmarks);

  const [row] = await db.select().from(bookmark).where(eq(bookmark.id, id)).limit(1);

  if (!row) {
    return c.json({ error: "Bookmark not found" }, 404);
  }

  const isOwner = userId !== undefined && row.userId === userId;
  if (row.visibility === "private" && !isOwner) {
    return c.json({ error: "Bookmark not found" }, 404);
  }

  const [withTags] = await attachTagsToBookmarks(db, [row]);
  return c.json(withTags, 200);
});

// PATCH /:id — update title/description/visibility
bookmarks.openapi(updateBookmarkRoute, async (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const db = createDrizzle(c.env.webmarks);

  // Only set fields that were actually provided
  const updates: Partial<{
    title: string | null;
    description: string | null;
    visibility: "public" | "private";
  }> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;
  if (body.visibility !== undefined) updates.visibility = body.visibility;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const [row] = await db
    .update(bookmark)
    .set(updates)
    .where(and(eq(bookmark.id, id), eq(bookmark.userId, userId)))
    .returning();

  if (!row) {
    return c.json({ error: "Bookmark not found" }, 404);
  }

  const [withTags] = await attachTagsToBookmarks(db, [row]);

  c.var.logger.info({ id, userId }, "bookmark updated");
  return c.json(withTags, 200);
});

// DELETE /:id — delete a bookmark
bookmarks.openapi(deleteBookmarkRoute, async (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.valid("param");
  const db = createDrizzle(c.env.webmarks);

  const result = await db
    .delete(bookmark)
    .where(and(eq(bookmark.id, id), eq(bookmark.userId, userId)))
    .returning({ id: bookmark.id });

  if (result.length === 0) {
    return c.json({ error: "Bookmark not found" }, 404);
  }

  c.var.logger.info({ id, userId }, "bookmark deleted");
  return c.json({ ok: true }, 200);
});

// ── Tag endpoints ─────────────────────────────────────────────────────

// PUT /:id/tags — replace all tags for a bookmark
bookmarks.openapi(setBookmarkTagsRoute, async (c) => {
  const userId = c.get("userId");
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { id } = c.req.valid("param");
  const { tags: tagNames } = c.req.valid("json");
  const db = createDrizzle(c.env.webmarks);

  // Verify bookmark exists and belongs to user
  const [bm] = await db
    .select({ id: bookmark.id })
    .from(bookmark)
    .where(and(eq(bookmark.id, id), eq(bookmark.userId, userId)))
    .limit(1);
  if (!bm) {
    return c.json({ error: "Bookmark not found" }, 404);
  }

  // Upsert tags: insert any new ones, get IDs for all
  const trimmedNames = [...new Set(tagNames.map((n) => n.trim()).filter(Boolean))];

  if (trimmedNames.length > 0) {
    // Batch insert — skip if already exists for this user
    await db
      .insert(tag)
      .values(trimmedNames.map((name) => ({ id: uuidv7(), name, userId })))
      .onConflictDoNothing();
  }

  // Fetch IDs for all requested tags (newly inserted + existing)
  const existingTags =
    trimmedNames.length > 0
      ? await db
          .select({ id: tag.id })
          .from(tag)
          .where(and(eq(tag.userId, userId), inArray(tag.name, trimmedNames)))
      : [];
  const tagIds = existingTags.map((t) => t.id);

  // Replace all bookmark-tag associations in a transaction
  await db.delete(bookmarkTag).where(eq(bookmarkTag.bookmarkId, id));
  if (tagIds.length > 0) {
    await db.insert(bookmarkTag).values(tagIds.map((tagId) => ({ bookmarkId: id, tagId })));
  }

  // Return the final tag list
  const finalTags =
    tagIds.length > 0 ? await db.select().from(tag).where(inArray(tag.id, tagIds)) : [];

  return c.json({ tags: finalTags }, 200);
});

// GET /:id/tags — get tags for a bookmark (public ok when bookmark is public)
bookmarks.openapi(getBookmarkTagsRoute, async (c) => {
  const { id } = c.req.valid("param");
  const userId = c.get("userId");
  const db = createDrizzle(c.env.webmarks);

  const [bm] = await db
    .select({ id: bookmark.id, userId: bookmark.userId, visibility: bookmark.visibility })
    .from(bookmark)
    .where(eq(bookmark.id, id))
    .limit(1);
  if (!bm) {
    return c.json({ error: "Bookmark not found" }, 404);
  }

  const isOwner = userId !== undefined && bm.userId === userId;
  if (bm.visibility === "private" && !isOwner) {
    return c.json({ error: "Bookmark not found" }, 404);
  }

  const tags = await db
    .select({ id: tag.id, name: tag.name })
    .from(tag)
    .innerJoin(bookmarkTag, eq(tag.id, bookmarkTag.tagId))
    .where(eq(bookmarkTag.bookmarkId, id));

  return c.json({ tags }, 200);
});

export default bookmarks;
