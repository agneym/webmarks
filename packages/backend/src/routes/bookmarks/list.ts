import { createRoute, z } from "@hono/zod-openapi";
import { BookmarkListResponseSchema, ErrorSchema } from "./schemas";
import { DEFAULT_SORT, SORT_ORDERS } from "../../lib/cursor";

// --- Schema ---

const PaginationQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .openapi({ example: "50", description: "Max items to return (1–100, default 50)" }),
  cursor: z
    .string()
    .optional()
    .openapi({
      example: "eyJzIjoibmV3ZXN0Iiw...",
      description:
        "Opaque cursor from a previous response's `nextCursor`. Omit for the first page. " +
        "A cursor is bound to the sort it was issued under — reusing it with a different " +
        "`sort` returns 400.",
    }),
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
  visibility: z.enum(["public", "private"]).optional().openapi({
    example: "public",
    description:
      "Filter by visibility (authenticated only). Unauthenticated requests always see public bookmarks",
  }),
  sort: z.enum(SORT_ORDERS).optional().openapi({
    example: DEFAULT_SORT,
    description:
      "Sort order: newest (default), oldest, title (A–Z), title_desc (Z–A), updated (recently updated first)",
  }),
});

// --- Route definition ---

export const listBookmarksRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["Bookmarks"],
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
      description: "Cursor-paginated list of bookmarks with total matching count",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Invalid cursor (malformed, or issued for a different sort)",
    },
  },
});
