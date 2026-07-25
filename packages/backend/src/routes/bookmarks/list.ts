import { createRoute, z } from "@hono/zod-openapi";
import { BookmarkListResponseSchema } from "./schemas";

// --- Schema ---

const PaginationQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .openapi({ example: "50", description: "Max items to return (1–100, default 50)" }),
  offset: z
    .string()
    .optional()
    .openapi({ example: "0", description: "Number of items to skip (default 0)" }),
  q: z.string().optional().openapi({
    example: "example",
    description: "Search query — matches against title, description, and URL",
  }),
  tag: z
    .string()
    .optional()
    .openapi({ example: "work", description: "Filter bookmarks by tag name" }),
  fetchStatus: z
    .enum(["pending", "success", "failed"])
    .optional()
    .openapi({ example: "pending", description: "Filter by metadata fetch status" }),
  sort: z.enum(["newest", "oldest", "title", "title_desc", "updated"]).optional().openapi({
    example: "newest",
    description:
      "Sort order: newest (default), oldest, title (A–Z), title_desc (Z–A), updated (recently updated first)",
  }),
});

// --- Route definition ---

export const listBookmarksRoute = createRoute({
  method: "get",
  path: "/",
  request: {
    query: PaginationQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: BookmarkListResponseSchema,
        },
      },
      description: "Paginated list of bookmarks with total matching count",
    },
  },
});
