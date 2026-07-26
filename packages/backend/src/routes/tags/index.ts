import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, eq, sql } from "drizzle-orm";

import type { Auth } from "../../lib/auth";
import { createDrizzle } from "../../db";
import { bookmark, tag, bookmarkTag } from "../../db/schema";
import { TagWithCountSchema, ErrorSchema } from "../bookmarks/schemas";

type Bindings = CloudflareBindings;
type Variables = { auth: Auth; logger: import("pino").Logger; userId?: string };

const tags = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// ── Optional auth ───────────────────────────────────────────────────────
// Unauthenticated callers see tags on public bookmarks only.
// Authenticated callers see their full tag list.

tags.use("*", async (c, next) => {
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (session) {
    c.set("userId", session.user.id);
  }
  await next();
});

// ── Route definitions ──────────────────────────────────────────────────

const listTagsRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ tags: z.array(TagWithCountSchema) }),
        },
      },
      description:
        "List of tags with bookmark counts. Public callers only see tags on public bookmarks.",
    },
    401: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Unauthorized",
    },
  },
});

// ── Handlers ───────────────────────────────────────────────────────────

// GET / — list tags with bookmark counts
tags.openapi(listTagsRoute, async (c) => {
  const userId = c.get("userId");
  const db = createDrizzle(c.env.webmarks);

  if (userId) {
    const rows = await db
      .select({
        id: tag.id,
        name: tag.name,
        bookmarkCount: sql<number>`COUNT(${bookmarkTag.bookmarkId})`.mapWith(Number),
      })
      .from(tag)
      .leftJoin(bookmarkTag, eq(tag.id, bookmarkTag.tagId))
      .where(eq(tag.userId, userId))
      .groupBy(tag.id)
      .orderBy(sql`${tag.name} ASC`);

    return c.json(
      {
        tags: rows.map((r) => ({
          id: r.id,
          name: r.name,
          bookmarkCount: r.bookmarkCount,
        })),
      },
      200,
    );
  }

  // Public: only tags attached to at least one public bookmark; count public only
  const rows = await db
    .select({
      id: tag.id,
      name: tag.name,
      bookmarkCount: sql<number>`COUNT(${bookmarkTag.bookmarkId})`.mapWith(Number),
    })
    .from(tag)
    .innerJoin(bookmarkTag, eq(tag.id, bookmarkTag.tagId))
    .innerJoin(
      bookmark,
      and(eq(bookmarkTag.bookmarkId, bookmark.id), eq(bookmark.visibility, "public")),
    )
    .groupBy(tag.id)
    .orderBy(sql`${tag.name} ASC`);

  return c.json(
    {
      tags: rows.map((r) => ({
        id: r.id,
        name: r.name,
        bookmarkCount: r.bookmarkCount,
      })),
    },
    200,
  );
});

export default tags;
