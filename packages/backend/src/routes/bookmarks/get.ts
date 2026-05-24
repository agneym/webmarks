import { createRoute } from "@hono/zod-openapi";
import { createDrizzle } from "../../db";
import { bookmark } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { BookmarkSchema, BookmarkIdParamSchema, ErrorSchema } from "./schemas";

// --- Route definition ---

export const getBookmarkRoute = createRoute({
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

// --- Handler ---

export async function getBookmarkHandler(c: any) {
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
}
