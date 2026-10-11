import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { Auth } from "../lib/auth";
import { isOwnerEmail } from "../lib/auth";
import { createDrizzle } from "../db";
import { bookmark } from "../db/schema";
import { ensureBlueprintImage, type EnsureImageResult } from "../lib/blueprint-image";
import { ErrorSchema } from "./bookmarks/schemas";

type Variables = { auth: Auth; logger: import("pino").Logger };

const admin = new OpenAPIHono<{ Bindings: CloudflareBindings; Variables: Variables }>();

const DEFAULT_BACKFILL_LIMIT = 5;
// Each image takes a few seconds; keep one request comfortably short.
const MAX_BACKFILL_LIMIT = 20;

const BackfillResultSchema = z
  .object({
    id: z.string(),
    status: z.enum(["generated", "generic", "skipped", "failed"]),
    image: z.string().optional(),
    error: z.string().optional(),
  })
  .openapi("BackfillImageResult");

const backfillImagesRoute = createRoute({
  method: "post",
  path: "/backfill-images",
  tags: ["Admin"],
  security: [{ bearerAuth: [] }],
  description:
    "Generate blueprint images for the owner's bookmarks that have no image, oldest first. " +
    "Idempotent: bookmarks that already have an image are never touched, so call it again " +
    "until `remaining` is 0. A bookmark whose generation fails gets the generic image " +
    "(status `generic`); only one whose image couldn't be saved at all (`failed`) is " +
    "retried on the next call.",
  request: {
    query: z.object({
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_BACKFILL_LIMIT)
        .optional()
        .openapi({
          example: DEFAULT_BACKFILL_LIMIT,
          description: `Max bookmarks to process (1-${MAX_BACKFILL_LIMIT}, default ${DEFAULT_BACKFILL_LIMIT})`,
        }),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            results: z.array(BackfillResultSchema),
            remaining: z.number().int().nonnegative().openapi({
              description: "Bookmarks still without an image after this call",
            }),
          }),
        },
      },
      description: "Backfill results",
    },
    401: { content: { "application/json": { schema: ErrorSchema } }, description: "Unauthorized" },
    403: { content: { "application/json": { schema: ErrorSchema } }, description: "Not the owner" },
  },
});

admin.openapi(backfillImagesRoute, async (c) => {
  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (!isOwnerEmail(session.user.email, c.env.OWNER_EMAIL)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const limit = c.req.valid("query").limit ?? DEFAULT_BACKFILL_LIMIT;
  const db = createDrizzle(c.env.webmarks);
  const missingImage = and(eq(bookmark.userId, session.user.id), isNull(bookmark.image));

  const rows = await db
    .select({ id: bookmark.id })
    .from(bookmark)
    .where(missingImage)
    .orderBy(asc(bookmark.createdAt), asc(bookmark.id))
    .limit(limit);

  const results: EnsureImageResult[] = [];
  // oxlint-disable no-await-in-loop — one image at a time keeps Workers AI usage predictable
  for (const row of rows) {
    results.push(await ensureBlueprintImage(c.env, db, row.id));
  }

  const [left] = await db.select({ n: count() }).from(bookmark).where(missingImage);
  c.var.logger.info({ results, remaining: left?.n }, "image backfill");
  return c.json({ results, remaining: left?.n ?? 0 }, 200);
});

export default admin;
