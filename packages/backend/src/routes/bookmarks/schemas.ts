import { z } from "@hono/zod-openapi";

export const BookmarkSchema = z
  .object({
    id: z.uuid().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
    url: z.url().openapi({ example: "https://example.com" }),
    userId: z.string().openapi({ example: "user_abc123" }),
    title: z.string().nullable().optional().openapi({ example: "Example Domain" }),
    description: z.string().nullable().optional().openapi({ example: "An example website" }),
    image: z.string().nullable().optional().openapi({ example: "https://example.com/og.png" }),
    favicon: z.string().nullable().optional(),
    fetchStatus: z.enum(["pending", "success", "failed"]).optional().openapi({ example: "pending" }),
  })
  .openapi("Bookmark");

export const BookmarkIdParamSchema = z.object({
  id: z.string().openapi({ example: "550e8400-e29b-41d4-a716-446655440000" }),
});

export const ErrorSchema = z
  .object({
    error: z.string().openapi({ example: "Unauthorized" }),
  })
  .openapi("Error");
