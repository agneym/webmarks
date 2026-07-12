import { Hono } from "hono";
import bookmarks from "../../src/routes/bookmarks";
import tags from "../../src/routes/tags";

const TEST_USER_ID = "test-user-001";

/**
 * Creates a Hono app with bookmark + tag routes, auth bypassed.
 *
 * The sub-routers call `c.var.auth.api.getSession()` internally,
 * so we inject a mock `auth` object that always returns a valid session.
 * No real Better Auth instance or session cookie needed.
 */
export function createTestApp() {
  const app = new Hono();

  const mockAuthMiddleware = async (c: any, next: () => Promise<void>) => {
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
  };

  // Inject mock auth + logger for both bookmark and tag routes
  app.use("/api/bookmarks/*", mockAuthMiddleware);
  app.use("/api/tags/*", mockAuthMiddleware);

  app.route("/api/bookmarks", bookmarks);
  app.route("/api/tags", tags);

  return app;
}

export { TEST_USER_ID };
