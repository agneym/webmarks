import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { Auth } from "../lib/auth";
import { createDrizzle } from "../db";
import { bookmark } from "../db/schema";
import { desc } from "drizzle-orm";

type Bindings = CloudflareBindings;
type Variables = { auth: Auth; logger: import("pino").Logger };

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
    title: z.string().nullable().optional().openapi({ example: "Example Domain" }),
    description: z.string().nullable().optional().openapi({ example: "An example website" }),
    image: z.string().nullable().optional().openapi({ example: "https://example.com/og.png" }),
    favicon: z.string().nullable().optional(),
    fetchStatus: z.enum(["pending", "success", "failed"]).optional().openapi({ example: "pending" }),
  })
  .openapi("Bookmark");

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

// --- Handlers ---

// Middleware: require authentication for write operations
bookmarks.use("/", async (c, next) => {
  if (c.req.method === "POST") {
    const session = await c.var.auth.api.getSession({
      headers: c.req.raw.headers,
    });
    if (!session) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  await next();
});

bookmarks.openapi(createBookmarkRoute, async (c) => {
  const { url } = c.req.valid("json");
  const id = crypto.randomUUID();
  const db = createDrizzle(c.env.webmarks);

  await db.insert(bookmark).values({ id, url, fetchStatus: "pending" });

  // Enqueue background metadata fetch
  await c.env.BOOKMARK_QUEUE.send({ bookmarkId: id, url });

  c.var.logger.info({ id, url }, "bookmark created");
  return c.json({ id, url, fetchStatus: "pending" }, 201);
});

bookmarks.openapi(listBookmarksRoute, async (c) => {
  const db = createDrizzle(c.env.webmarks);
  const rows = await db.select().from(bookmark).orderBy(desc(bookmark.createdAt));
  return c.json(rows, 200);
});

export default bookmarks;
