import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, TEST_USER_ID } from "../helpers/create-test-app";
import { seedUser, seedBookmark } from "../helpers/seed";
import { applyMigrations } from "../helpers/migrations";

beforeAll(async () => {
  await applyMigrations((env as any).webmarks);
  await seedUser(env as any, TEST_USER_ID, "test@example.com", "Test User");
});

let seededIds: string[] = [];

afterEach(async () => {
  for (const id of seededIds) {
    await (env as any).webmarks.prepare("DELETE FROM bookmark WHERE id = ?").bind(id).run();
  }
  seededIds = [];
});

describe("Public vs authenticated bookmark access", () => {
  it("allows unauthenticated GET /api/bookmarks (public feed)", async () => {
    const app = createTestApp({ authenticated: false });

    await seedBookmark(env as any, {
      id: "bm-public-auth-001",
      url: "https://public.example.com",
      userId: TEST_USER_ID,
      visibility: "public",
    });
    seededIds.push("bm-public-auth-001");

    const res = await app.request("/api/bookmarks", {}, env as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bookmarks: Array<{ id: string }> };
    expect(body.bookmarks.some((b) => b.id === "bm-public-auth-001")).toBe(true);
  });

  it("hides private bookmarks from unauthenticated list", async () => {
    const app = createTestApp({ authenticated: false });

    await seedBookmark(env as any, {
      id: "bm-private-auth-001",
      url: "https://private.example.com",
      userId: TEST_USER_ID,
      visibility: "private",
    });
    seededIds.push("bm-private-auth-001");

    const res = await app.request("/api/bookmarks", {}, env as any);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bookmarks: Array<{ id: string }> };
    expect(body.bookmarks.some((b) => b.id === "bm-private-auth-001")).toBe(false);
  });

  it("returns 401 for unauthenticated POST /api/bookmarks", async () => {
    const app = createTestApp({ authenticated: false });

    const res = await app.request(
      "/api/bookmarks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://nope.example.com" }),
      },
      env as any,
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 for unauthenticated PATCH /api/bookmarks/:id", async () => {
    const app = createTestApp({ authenticated: false });

    await seedBookmark(env as any, {
      id: "bm-patch-auth-001",
      url: "https://patch.example.com",
      userId: TEST_USER_ID,
      visibility: "public",
    });
    seededIds.push("bm-patch-auth-001");

    const res = await app.request(
      "/api/bookmarks/bm-patch-auth-001",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Hacked" }),
      },
      env as any,
    );

    expect(res.status).toBe(401);
  });

  it("returns 401 for unauthenticated DELETE /api/bookmarks/:id", async () => {
    const app = createTestApp({ authenticated: false });

    await seedBookmark(env as any, {
      id: "bm-del-auth-001",
      url: "https://del.example.com",
      userId: TEST_USER_ID,
      visibility: "public",
    });
    seededIds.push("bm-del-auth-001");

    const res = await app.request(
      "/api/bookmarks/bm-del-auth-001",
      { method: "DELETE" },
      env as any,
    );

    expect(res.status).toBe(401);
  });

  it("returns 404 for unauthenticated GET of a private bookmark", async () => {
    const app = createTestApp({ authenticated: false });

    await seedBookmark(env as any, {
      id: "bm-priv-get-001",
      url: "https://secret.example.com",
      userId: TEST_USER_ID,
      visibility: "private",
    });
    seededIds.push("bm-priv-get-001");

    const res = await app.request("/api/bookmarks/bm-priv-get-001", {}, env as any);
    expect(res.status).toBe(404);
  });
});
