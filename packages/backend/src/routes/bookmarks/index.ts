import { OpenAPIHono } from "@hono/zod-openapi";
import type { Auth } from "../../lib/auth";
import { createBookmarkRoute, createBookmarkHandler } from "./create";
import { listBookmarksRoute, listBookmarksHandler } from "./list";
import { getBookmarkRoute, getBookmarkHandler } from "./get";
import { updateBookmarkRoute, updateBookmarkHandler } from "./update";
import { deleteBookmarkRoute, deleteBookmarkHandler } from "./delete";

type Bindings = CloudflareBindings;
type Variables = { auth: Auth; logger: import("pino").Logger; userId: string };

const bookmarks = new OpenAPIHono<{ Bindings: Bindings; Variables: Variables }>();

// --- Auth middleware (applies to all bookmark routes) ---

bookmarks.use("*", async (c, next) => {
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  c.set("userId", session.user.id);
  await next();
});

// --- Route registration ---

bookmarks.openapi(createBookmarkRoute, createBookmarkHandler);
bookmarks.openapi(listBookmarksRoute, listBookmarksHandler);
bookmarks.openapi(getBookmarkRoute, getBookmarkHandler);
bookmarks.openapi(updateBookmarkRoute, updateBookmarkHandler);
bookmarks.openapi(deleteBookmarkRoute, deleteBookmarkHandler);

export default bookmarks;
