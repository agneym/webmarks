import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuth, type Auth } from "./lib/auth";
import { logger } from "./middleware/logger";
import bookmarks from "./routes/bookmarks";
import { handleQueue, type QueueMessage } from "./queue-consumer";

const app = new Hono<{
  Bindings: CloudflareBindings;
  Variables: { auth: Auth; logger: import("pino").Logger };
}>();

app.use("*", logger());

// Create auth instance per-request (D1 binding comes from env)
app.use("*", async (c, next) => {
  const auth = createAuth(c.env);
  c.set("auth", auth);
  await next();
});

// CORS for auth endpoints — required for cross-origin clients
// (web app on different domain, chrome extensions, etc.)
app.use("/api/auth/*", async (c, next) => {
  const origin = c.env.WEB_APP_URL || "http://localhost:3000";
  return cors({
    origin: [origin],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["set-auth-token"], // Let clients capture bearer token
    credentials: true,
  })(c, next);
});

// Mount Better Auth handler — handles /api/auth/sign-up/email,
// /api/auth/sign-in/email, /api/auth/sign-out, /api/auth/session, etc.
app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return c.var.auth.handler(c.req.raw);
});

app.get("/api/me", async (c) => {
  const session = await c.var.auth.api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return c.json({ user: session.user });
});

app.route("/api/bookmarks", bookmarks);

app.get("/", (c) => {
  c.var.logger.info("health check");
  return c.text("Webmarks API");
});

app.get("/api/doc", (c) => {
  return c.json(
    bookmarks.getOpenAPI31Document({
      openapi: "3.1.0",
      info: { title: "Webmarks API", version: "1.0.0" },
    }),
  );
});

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueMessage>, env: CloudflareBindings, _ctx: ExecutionContext) {
    await handleQueue(batch, env);
  },
};
