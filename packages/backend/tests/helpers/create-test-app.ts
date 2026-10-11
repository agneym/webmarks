import { Hono } from "hono";
import bookmarks from "../../src/routes/bookmarks";
import tags from "../../src/routes/tags";
import admin from "../../src/routes/admin";
import images from "../../src/routes/images";

const TEST_USER_ID = "test-user-001";

type SessionUser = {
  id: string;
  name: string;
  email: string;
} | null;

/**
 * Creates a Hono app with the bookmark, tag, admin and image routes.
 *
 * By default auth is bypassed with a valid session for TEST_USER_ID.
 * Pass `{ authenticated: false }` to simulate a public (logged-out) client.
 */
export function createTestApp(opts?: { authenticated?: boolean; userId?: string; email?: string }) {
  const authenticated = opts?.authenticated !== false;
  const userId = opts?.userId ?? TEST_USER_ID;

  const app = new Hono();

  const sessionUser: SessionUser = authenticated
    ? {
        id: userId,
        name: "Test User",
        email: opts?.email ?? "test@example.com",
      }
    : null;

  const mockAuthMiddleware = async (c: any, next: () => Promise<void>) => {
    c.set("auth", {
      api: {
        getSession: async () =>
          sessionUser
            ? {
                user: sessionUser,
                session: { id: "test-session" },
              }
            : null,
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
  app.use("/api/admin/*", mockAuthMiddleware);

  app.route("/api/bookmarks", bookmarks);
  app.route("/api/tags", tags);
  app.route("/api/admin", admin);
  app.route("/images", images);

  return app;
}

export { TEST_USER_ID };
