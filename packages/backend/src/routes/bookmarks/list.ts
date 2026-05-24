import { createRoute, z } from "@hono/zod-openapi";
import { createDrizzle } from "../../db";
import { bookmark } from "../../db/schema";
import { desc, eq } from "drizzle-orm";
import { BookmarkSchema } from "./schemas";

// --- Route definition ---

export const listBookmarksRoute = createRoute({
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

// --- Handler ---

export async function listBookmarksHandler(c: any) {
  const userId = c.get("userId");
  const db = createDrizzle(c.env.webmarks);
  const rows = await db
    .select()
    .from(bookmark)
    .where(eq(bookmark.userId, userId))
    .orderBy(desc(bookmark.createdAt));
  return c.json(rows, 200);
}
