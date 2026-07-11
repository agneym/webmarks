import { createRoute, z } from "@hono/zod-openapi";
import { BookmarkSchema, ErrorSchema } from "./schemas";

// --- Schema ---

const CreateBookmarkBodySchema = z
  .object({
    url: z.url().openapi({ example: "https://example.com" }),
  })
  .openapi("CreateBookmark");

// --- Route definition ---

export const createBookmarkRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: {
      content: {
        "application/json": {
          schema: CreateBookmarkBodySchema,
        },
      },
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: BookmarkSchema,
        },
      },
      description: "Bookmark created",
    },
    400: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Invalid request",
    },
    401: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Unauthorized",
    },
    409: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Bookmark already exists for this URL",
    },
  },
});
