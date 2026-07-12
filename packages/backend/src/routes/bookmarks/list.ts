import { createRoute, z } from "@hono/zod-openapi";
import { BookmarkSchema } from "./schemas";

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
  q: z
    .string()
    .optional()
    .openapi({
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
          schema: z.array(BookmarkSchema),
        },
      },
      description: "List of bookmarks (newest first)",
    },
  },
});
