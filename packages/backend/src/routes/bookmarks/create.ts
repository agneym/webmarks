import { createRoute, z } from "@hono/zod-openapi";
import { v7 as uuidv7 } from "uuid";
import { createDrizzle } from "../../db";
import { bookmark } from "../../db/schema";
import { BookmarkSchema, ErrorSchema } from "./schemas";

// --- Schema ---

const CreateBookmarkBodySchema = z
  .object({
    url: z.url().openapi({ example: "https://example.com" }),
  })
  .openapi("CreateBookmark");

// --- Route definition ---

export const createBookmarkRoute = createRoute({
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

// --- Handler ---

export async function createBookmarkHandler(c: any) {
  const { url } = c.req.valid("json");
  const userId = c.get("userId");
  const id = uuidv7();
  const db = createDrizzle(c.env.webmarks);

  await db.insert(bookmark).values({ id, userId, url, fetchStatus: "pending" });

  // Enqueue background metadata fetch
  await c.env.BOOKMARK_QUEUE.send({ bookmarkId: id, url });

  c.var.logger.info({ id, userId, url }, "bookmark created");
  return c.json({ id, userId, url, fetchStatus: "pending" }, 201);
}
