import { createRoute } from "@hono/zod-openapi";
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
