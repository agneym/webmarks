import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { Hono } from "hono";
import bookmarks from "../../src/routes/bookmarks";

describe("Bookmark auth middleware", () => {
  it("returns 401 when session is null", async () => {
    const app = new Hono();

    // Inject auth that returns null session
    app.use("/api/bookmarks/*", async (c: any, next) => {
      c.set("auth", {
        api: { getSession: async () => null },
      });
      c.set("logger", { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
      await next();
    });

    app.route("/api/bookmarks", bookmarks);

    const res = await app.request("/api/bookmarks", {}, env as any);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });
});
