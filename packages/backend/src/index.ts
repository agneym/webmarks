import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { createAuth, type Auth } from "./lib/auth";
import { logger } from "./middleware/logger";
import bookmarks from "./routes/bookmarks";
import tags from "./routes/tags";
import { handleQueue, type QueueMessage } from "./queue-consumer";

const app = new Hono<{
  Bindings: CloudflareBindings;
  Variables: { auth: Auth; logger: import("pino").Logger; userId: string };
}>();

// --- Global middleware ---

app.use("*", logger());

// 1 MB body size limit
app.use("*", bodyLimit({ maxSize: 1024 * 1024 }));

// Create auth instance per-request (D1 binding comes from env)
app.use("*", async (c, next) => {
  const auth = createAuth(c.env);
  c.set("auth", auth);
  await next();
});

// --- CORS ---

// CORS for auth endpoints — required for cross-origin clients
app.use("/api/auth/*", async (c, next) => {
  const origin = c.env.WEB_APP_URL || "http://localhost:3000";
  return cors({
    origin: [origin],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["set-auth-token"],
    credentials: true,
  })(c, next);
});

// CORS for bookmark endpoints — browser clients need this too
app.use("/api/bookmarks/*", async (c, next) => {
  const origin = c.env.WEB_APP_URL || "http://localhost:3000";
  return cors({
    origin: [origin],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })(c, next);
});

// CORS for tags endpoints
app.use("/api/tags/*", async (c, next) => {
  const origin = c.env.WEB_APP_URL || "http://localhost:3000";
  return cors({
    origin: [origin],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "OPTIONS"],
    credentials: true,
  })(c, next);
});

// --- Routes ---

// Mount Better Auth handler
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
app.route("/api/tags", tags);

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

// --- Global error handler ---

app.onError((err, c) => {
  c.var.logger?.error({ err: err.message, stack: err.stack }, "unhandled error");
  return c.json({ error: "Internal server error" }, 500);
});

// --- Worker export ---

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueMessage>, env: CloudflareBindings, _ctx: ExecutionContext) {
    await handleQueue(batch, env);
  },
};
