import { Hono } from "hono";
import { createAuth, type Auth } from "./lib/auth";
import { logger } from "./middleware/logger";
import { createDrizzle } from "./db";
import { bookmark } from "./db/schema";
import { desc } from "drizzle-orm";

const app = new Hono<{
  Bindings: CloudflareBindings;
  Variables: { auth: Auth; logger: import("pino").Logger };
}>();

// Request logging + attach logger
app.use("*", logger());

// Create auth instance per-request (D1 binding comes from env)
app.use("*", async (c, next) => {
  const auth = createAuth(c.env);
  c.set("auth", auth);
  await next();
});

// Mount Better Auth handler — handles /api/auth/sign-up/email,
// /api/auth/sign-in/email, /api/auth/sign-out, /api/auth/session, etc.
app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return c.var.auth.handler(c.req.raw);
});

// Example protected route
app.get("/api/me", async (c) => {
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return c.json({ user: session.user });
});

// POST /api/bookmarks — accept a URL and store it with a unique ID
app.post("/api/bookmarks", async (c) => {
  const body = await c.req.json<{ url?: string }>();
  const url = body?.url?.trim();

  if (!url) {
    return c.json({ error: "URL is required" }, 400);
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    return c.json({ error: "Invalid URL" }, 400);
  }

  const id = crypto.randomUUID();
  const db = createDrizzle(c.env.webmarks);

  await db.insert(bookmark).values({ id, url });

  c.var.logger.info({ id, url }, "bookmark created");
  return c.json({ id, url }, 201);
});

// GET /api/bookmarks — list all bookmarks
app.get("/api/bookmarks", async (c) => {
  const db = createDrizzle(c.env.webmarks);
  const rows = await db.select().from(bookmark).orderBy(desc(bookmark.createdAt));
  return c.json(rows);
});

// Health check
app.get("/", (c) => {
  c.var.logger.info("health check");
  return c.text("Webmarks API");
});

export default app;
