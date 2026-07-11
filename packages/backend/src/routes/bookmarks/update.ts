import { createRoute, z } from "@hono/zod-openapi";
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
