import { createRoute, z } from "@hono/zod-openapi";
import { createDrizzle } from "../../db";
import { bookmark } from "../../db/schema";
import { and, eq } from "drizzle-orm";
import { BookmarkSchema, BookmarkIdParamSchema, ErrorSchema } from "./schemas";

// --- Schema ---

const UpdateBookmarkBodySchema = z
  .object({
    title: z.string().optional().openapi({ example: "Updated title" }),
    description: z.string().optional().openapi({ example: "Updated description" }),
  })
  .openapi("UpdateBookmark");

// --- Route definition ---

export const updateBookmarkRoute = createRoute({
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

// --- Handler ---

export async function updateBookmarkHandler(c: any) {
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
}
