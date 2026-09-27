import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { createAuth, type Auth } from "./lib/auth";
import { logger } from "./middleware/logger";
import bookmarks from "./routes/bookmarks";
import tags from "./routes/tags";
import deviceApp from "./routes/device";
import { handleQueue, type QueueMessage } from "./queue-consumer";

const app = new OpenAPIHono<{
  Bindings: CloudflareBindings;
  Variables: { auth: Auth; logger: import("pino").Logger; userId?: string };
}>();

// Registered so operations that require a session show an auth lock in the docs.
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  description: "Session token from `webmarks login` (Better Auth bearer plugin).",
});

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
// Device verification / approval pages (RFC 8628 user side)
app.route("/device", deviceApp);

app.get("/", (c) => {
  c.var.logger.info("health check");
  return c.text("Webmarks API");
});

// --- OpenAPI spec ---
// Generated from every OpenAPIHono router mounted above, so paths are prefixed
// correctly (`/api/bookmarks`, `/api/tags`) and all operations are included.
const buildOpenApiDocument = (serverUrl: string) =>
  app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Webmarks API",
      version: "1.0.0",
      description:
        "Bookmarking API for the webmarks CLI. Authenticate with a bearer session " +
        "token obtained via the RFC 8628 device flow (`webmarks login`).",
    },
    servers: [{ url: serverUrl }],
  });

app.get("/api/doc", (c) => c.json(buildOpenApiDocument(new URL(c.req.url).origin)));
app.get("/openapi.json", (c) => c.json(buildOpenApiDocument(new URL(c.req.url).origin)));

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
