import { Hono } from "hono";
import { createAuth, type Auth } from "./lib/auth";
import { logger } from "./middleware/logger";
import bookmarks from "./routes/bookmarks";

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

// Mount bookmark routes
app.route("/api/bookmarks", bookmarks);

// Health check
app.get("/", (c) => {
  c.var.logger.info("health check");
  return c.text("Webmarks API");
});

// OpenAPI spec
app.get("/api/doc", (c) => {
  return c.json(
    bookmarks.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Webmarks API", version: "1.0.0" },
    })
  );
});

export default app;
