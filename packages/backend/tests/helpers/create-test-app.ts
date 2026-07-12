import { Hono } from "hono";
import bookmarks from "../../src/routes/bookmarks";

const TEST_USER_ID = "test-user-001";

/**
 * Creates a Hono app with bookmark routes, auth bypassed.
 *
 * The bookmark sub-router calls `c.var.auth.api.getSession()` internally,
 * so we inject a mock `auth` object that always returns a valid session.
 * No real Better Auth instance or session cookie needed.
 */
export function createTestApp() {
  const app = new Hono();

  // Inject mock auth + logger before anything else.
  // The bookmarks sub-router will call auth.api.getSession() and get
  // back a valid session with our test user.
  app.use("/api/bookmarks/*", async (c: any, next: () => Promise<void>) => {
    c.set("auth", {
      api: {
        getSession: async () => ({
          user: {
            id: TEST_USER_ID,
            name: "Test User",
            email: "test@example.com",
          },
          session: { id: "test-session" },
        }),
      },
      handler: async (_req: Request) => new Response("auth handler"),
    });
    c.set("logger", {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    });
    await next();
  });

  app.route("/api/bookmarks", bookmarks);

  return app;
}

export { TEST_USER_ID };
