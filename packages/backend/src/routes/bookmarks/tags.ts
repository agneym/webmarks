import { createRoute, z } from "@hono/zod-openapi";
import { BookmarkIdParamSchema, TagSchema, ErrorSchema } from "./schemas";

// ── Schemas ────────────────────────────────────────────────────────────

const SetTagsBodySchema = z
  .object({
    tags: z
      .array(z.string().min(1))
      .max(50)
      .openapi({
        example: ["work", "important"],
        description: "List of tag names. Replaces all existing tags for this bookmark.",
      }),
  })
  .openapi("SetBookmarkTags");

const BookmarkTagsResponseSchema = z
  .object({
    tags: z.array(TagSchema),
  })
  .openapi("BookmarkTagsResponse");

// ── Route definitions ──────────────────────────────────────────────────

export const setBookmarkTagsRoute = createRoute({
  method: "put",
  path: "/{id}/tags",
  request: {
    params: BookmarkIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: SetTagsBodySchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: BookmarkTagsResponseSchema,
        },
      },
      description: "Tags updated successfully",
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

export const getBookmarkTagsRoute = createRoute({
  method: "get",
  path: "/{id}/tags",
  request: {
    params: BookmarkIdParamSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: BookmarkTagsResponseSchema,
        },
      },
      description: "Tags for the bookmark",
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
