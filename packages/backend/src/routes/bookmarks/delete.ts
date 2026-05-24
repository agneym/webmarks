import { createRoute, z } from "@hono/zod-openapi";
import { createDrizzle } from "../../db";
import { bookmark } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { BookmarkIdParamSchema, ErrorSchema } from "./schemas";

// --- Route definition ---

export const deleteBookmarkRoute = createRoute({
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

// --- Handler ---

export async function deleteBookmarkHandler(c: any) {
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
}
