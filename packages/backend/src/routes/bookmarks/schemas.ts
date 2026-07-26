import { z } from "@hono/zod-openapi";

export const TagSchema = z
  .object({
    id: z.string().openapi({ example: "tag_abc123" }),
    name: z.string().openapi({ example: "work" }),
  })
  .openapi("Tag");

export const BookmarkSchema = z
  .object({
    id: z.uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    url: z.url().openapi({ example: "https://example.com" }),
    userId: z.string().openapi({ example: "user_abc123" }),
    title: z.string().nullable().optional().openapi({ example: "Example Domain" }),
    description: z.string().nullable().optional().openapi({ example: "An example website" }),
    image: z.string().nullable().optional().openapi({ example: "https://example.com/og.png" }),
    favicon: z.string().nullable().optional(),
    fetchStatus: z
      .enum(["pending", "success", "failed"])
      .optional()
      .openapi({ example: "pending" }),
    visibility: z.enum(["public", "private"]).openapi({
      example: "public",
      description: "public = anyone can view; private = owner only",
    }),
    tags: z.array(TagSchema).openapi({ example: [{ id: "tag_abc123", name: "work" }] }),
  })
  .openapi("Bookmark");

export const TagWithCountSchema = z
  .object({
    id: z.string().openapi({ example: "tag_abc123" }),
    name: z.string().openapi({ example: "work" }),
    bookmarkCount: z.number().openapi({ example: 12 }),
  })
  .openapi("TagWithCount");

export const BookmarkListResponseSchema = z
  .object({
    bookmarks: z.array(BookmarkSchema),
    total: z.number().int().nonnegative().openapi({ example: 225 }),
    limit: z.number().int().positive().openapi({ example: 50 }),
    offset: z.number().int().nonnegative().openapi({ example: 0 }),
  })
  .openapi("BookmarkListResponse");

export const BookmarkIdParamSchema = z.object({
  id: z.string().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
});

export const ErrorSchema = z
  .object({
    error: z.string().openapi({ example: "Unauthorized" }),
  })
  .openapi("Error");
