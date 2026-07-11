import { OpenAPIHono } from "@hono/zod-openapi";
import { v7 as uuidv7 } from "uuid";
import { and, desc, eq } from "drizzle-orm";

import type { Auth } from "../../lib/auth";
import { createDrizzle } from "../../db";
import { bookmark } from "../../db/schema";

import { createBookmarkRoute } from "./create";
import { listBookmarksRoute } from "./list";
import { getBookmarkRoute } from "./get";
import { updateBookmarkRoute } from "./update";
import { deleteBookmarkRoute } from "./delete";

type Bindings = CloudflareBindings;
type Variables = { auth: Auth; logger: import("pino").Logger; userId: string };

const bookmarks = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// --- Auth middleware (applies to all bookmark routes) ---

bookmarks.use("*", async (c, next) => {
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("userId", session.user.id);
  await next();
});

// --- Route handlers ---

// POST / — create a bookmark (enqueues background metadata fetch)
bookmarks.openapi(createBookmarkRoute, async (c) => {
  const { url } = c.req.valid("json");
  const userId = c.get("userId");
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
    .values({ id, userId, url, fetchStatus: "pending" })
    .returning();

  if (!row) {
    throw new Error("Failed to create bookmark");
  }

  // Enqueue background metadata fetch
  await c.env.BOOKMARK_QUEUE.send({ bookmarkId: id, url });

  c.var.logger.info({ id, userId, url }, "bookmark created");
  return c.json(row, 201);
});

// GET / — list user's bookmarks (newest first, with pagination)
bookmarks.openapi(listBookmarksRoute, async (c) => {
  const userId = c.get("userId");
  const db = createDrizzle(c.env.webmarks);

  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "50"), 1), 100);
  const offset = Math.max(Number(c.req.query("offset") ?? "0"), 0);

  const rows = await db
    .select()
    .from(bookmark)
    .where(eq(bookmark.userId, userId))
    .orderBy(desc(bookmark.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(rows, 200);
});

// GET /:id — get a single bookmark
bookmarks.openapi(getBookmarkRoute, async (c) => {
  const { id } = c.req.valid("param");
  const userId = c.get("userId");
  const db = createDrizzle(c.env.webmarks);

  const [row] = await db
    .select()
    .from(bookmark)
    .where(and(eq(bookmark.id, id), eq(bookmark.userId, userId)))
    .limit(1);

  if (!row) {
    return c.json({ error: "Bookmark not found" }, 404);
  }
  return c.json(row, 200);
});

// PATCH /:id — update title/description
bookmarks.openapi(updateBookmarkRoute, async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");
  const userId = c.get("userId");
  const db = createDrizzle(c.env.webmarks);

  // Only set fields that were actually provided
  const updates: Partial<{ title: string | null; description: string | null }> = {};
  if (body.title !== undefined) updates.title = body.title;
  if (body.description !== undefined) updates.description = body.description;

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

  c.var.logger.info({ id, userId }, "bookmark updated");
  return c.json(row, 200);
});

// DELETE /:id — delete a bookmark
bookmarks.openapi(deleteBookmarkRoute, async (c) => {
  const { id } = c.req.valid("param");
  const userId = c.get("userId");
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

export default bookmarks;
