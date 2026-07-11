import { createRoute, z } from "@hono/zod-openapi";
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
