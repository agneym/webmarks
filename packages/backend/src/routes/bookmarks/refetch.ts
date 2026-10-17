import { createRoute } from "@hono/zod-openapi";
import { BookmarkSchema, BookmarkIdParamSchema, ErrorSchema } from "./schemas";

// --- Route definition ---

export const refetchBookmarkRoute = createRoute({
  method: "post",
  path: "/{id}/refetch",
  tags: ["Bookmarks"],
  security: [{ bearerAuth: [] }],
  description:
    "Retry the background metadata fetch. Sets the bookmark back to `pending` and re-enqueues it; " +
    "use it for bookmarks whose fetch `failed`.",
  request: {
    params: BookmarkIdParamSchema,
  },
  responses: {
    202: {
      content: {
        "application/json": {
          schema: BookmarkSchema,
        },
      },
      description: "Refetch queued",
    },
    401: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Unauthorized",
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
