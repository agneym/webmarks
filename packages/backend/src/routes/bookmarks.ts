import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Auth } from "../lib/auth";
import { createDrizzle } from "../db";
import { bookmark } from "../db/schema";
import { and, desc, eq } from "drizzle-orm";

type Bindings = CloudflareBindings;
type Variables = { auth: Auth; logger: import("pino").Logger; userId: string };

const bookmarks = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// --- Schemas ---

const CreateBookmarkBodySchema = z
  .object({
    url: z.url().openapi({ example: "https://example.com" }),
  })
  .openapi("CreateBookmark");

const BookmarkSchema = z
  .object({
    id: z.uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    url: z.url().openapi({ example: "https://example.com" }),
    userId: z.string().openapi({ example: "user_abc123" }),
    title: z.string().nullable().optional().openapi({ example: "Example Domain" }),
    description: z.string().nullable().optional().openapi({ example: "An example website" }),
    image: z.string().nullable().optional().openapi({ example: "https://example.com/og.png" }),
    favicon: z.string().nullable().optional(),
    fetchStatus: z.enum(["pending", "success", "failed"]).optional().openapi({ example: "pending" }),
  })
  .openapi("Bookmark");

const BookmarkIdParamSchema = z.object({
  id: z.string().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
});

const UpdateBookmarkBodySchema = z
  .object({
    title: z.string().optional().openapi({ example: "Updated title" }),
    description: z.string().optional().openapi({ example: "Updated description" }),
  })
  .openapi("UpdateBookmark");

const ErrorSchema = z
  .object({
    error: z.string().openapi({ example: "Unauthorized" }),
  })
  .openapi("Error");

// --- Routes ---

const createBookmarkRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateBookmarkBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: BookmarkSchema,
        },
      },
      description: "Bookmark created",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Invalid request",
    },
    401: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Unauthorized",
    },
  },
});

const listBookmarksRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.array(BookmarkSchema),
        },
      },
      description: "List of bookmarks",
    },
  },
});

const getBookmarkRoute = createRoute({
  method: "get",
  path: "/{id}",
  request: {
    params: BookmarkIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: BookmarkSchema,
        },
      },
      description: "Single bookmark",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Bookmark not found",
    },
  },
});

const updateBookmarkRoute = createRoute({
  method: "patch",
  path: "/{id}",
  request: {
    params: BookmarkIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: UpdateBookmarkBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: BookmarkSchema,
        },
      },
      description: "Bookmark updated",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Invalid request",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Bookmark not found",
    },
  },
});

const deleteBookmarkRoute = createRoute({
  method: "delete",
  path: "/{id}",
  request: {
    params: BookmarkIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean().openapi({ example: true }) }),
        },
      },
      description: "Bookmark deleted",
    },
    404: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Bookmark not found",
    },
  },
});

// --- Handlers ---

// Middleware: require authentication for all bookmark operations
bookmarks.use("/", async (c, next) => {
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  // Stash userId for downstream handlers
  c.set("userId", session.user.id);
  await next();
});

bookmarks.openapi(createBookmarkRoute, async (c) => {
  const { url } = c.req.valid("json");
  const userId = c.get("userId");
  const id = crypto.randomUUID();
  const db = createDrizzle(c.env.webmarks);

  await db.insert(bookmark).values({ id, userId, url, fetchStatus: "pending" });

  // Enqueue background metadata fetch
  await c.env.BOOKMARK_QUEUE.send({ bookmarkId: id, url });

  c.var.logger.info({ id, userId, url }, "bookmark created");
  return c.json({ id, userId, url, fetchStatus: "pending" }, 201);
});

bookmarks.openapi(listBookmarksRoute, async (c) => {
  const userId = c.get("userId");
  const db = createDrizzle(c.env.webmarks);
  const rows = await db
    .select()
    .from(bookmark)
    .where(eq(bookmark.userId, userId))
    .orderBy(desc(bookmark.createdAt));
  return c.json(rows, 200);
});

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
