import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, TEST_USER_ID } from "../helpers/create-test-app";
import { seedUser, seedBookmark } from "../helpers/seed";
import { applyMigrations } from "../helpers/migrations";

const app = createTestApp();

// Track IDs to clean up after each test
let seededIds: string[] = [];

beforeAll(async () => {
  await applyMigrations((env as any).webmarks);
  // Seed user records so FK constraints don't break
  await seedUser(env as any, TEST_USER_ID, "test@example.com", "Test User");
  await seedUser(env as any, "other-user", "other@example.com", "Other User");
});

afterEach(async () => {
  // oxlint-disable no-await-in-loop — D1 cleanup must run sequentially
  for (const id of seededIds) {
    await (env as any).webmarks.prepare("DELETE FROM bookmark WHERE id = ?").bind(id).run();
  }
  seededIds = [];
});

// Helper: seed + track for cleanup
async function seedAndTrack(opts: Parameters<typeof seedBookmark>[1]) {
  await seedBookmark(env as any, opts);
  seededIds.push(opts.id);
}

// ──────────────────────────────────────────────
// POST /api/bookmarks
// ──────────────────────────────────────────────

describe("POST /api/bookmarks", () => {
  it("creates a bookmark and returns 201 with correct fields", async () => {
    const res = await app.request(
      "/api/bookmarks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      },
      env as any,
    );

    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body).toMatchObject({
      userId: TEST_USER_ID,
      url: "https://example.com",
      fetchStatus: "pending",
      visibility: "public",
    });
    expect(body.id).toBeDefined();

    // Track for cleanup
    seededIds.push(body.id);
  });

  it("creates a private bookmark when visibility is set", async () => {
    const res = await app.request(
      "/api/bookmarks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "https://private-create.example.com", visibility: "private" }),
      },
      env as any,
    );

    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.visibility).toBe("private");
    seededIds.push(body.id);
  });

  it("rejects invalid URL with 400", async () => {
    const res = await app.request(
      "/api/bookmarks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "not-a-url" }),
      },
      env as any,
    );

    expect(res.status).toBe(400);
  });

  it("rejects empty body with 400", async () => {
    const res = await app.request(
      "/api/bookmarks",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      env as any,
    );

    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────
// GET /api/bookmarks
// ──────────────────────────────────────────────

describe("GET /api/bookmarks", () => {
  it("returns empty list with total 0 when no bookmarks", async () => {
    const res = await app.request("/api/bookmarks", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toEqual({ bookmarks: [], total: 0, limit: 50, offset: 0 });
  });

  it("returns only the authenticated user's bookmarks", async () => {
    await seedAndTrack({
      id: "bm-own-001",
      url: "https://mine.example.com",
      userId: TEST_USER_ID,
    });
    await seedAndTrack({
      id: "bm-other-001",
      url: "https://theirs.example.com",
      userId: "other-user",
    });

    const res = await app.request("/api/bookmarks", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.total).toBe(1);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.bookmarks).toHaveLength(1);
    expect(body.bookmarks[0].id).toBe("bm-own-001");
    expect(body.bookmarks[0].userId).toBe(TEST_USER_ID);
    expect(body.bookmarks[0].tags).toEqual([]);
  });

  it("filters by visibility for the authenticated user", async () => {
    await seedAndTrack({
      id: "bm-vis-pub",
      url: "https://vis-pub.example.com",
      userId: TEST_USER_ID,
      visibility: "public",
    });
    await seedAndTrack({
      id: "bm-vis-priv",
      url: "https://vis-priv.example.com",
      userId: TEST_USER_ID,
      visibility: "private",
    });

    const pub = await app.request("/api/bookmarks?visibility=public", undefined, env as any);
    const pubBody: any = await pub.json();
    expect(pubBody.bookmarks.map((b: any) => b.id)).toEqual(["bm-vis-pub"]);

    const priv = await app.request("/api/bookmarks?visibility=private", undefined, env as any);
    const privBody: any = await priv.json();
    expect(privBody.bookmarks.map((b: any) => b.id)).toEqual(["bm-vis-priv"]);
  });

  it("returns total count across pages", async () => {
    for (let i = 0; i < 3; i++) {
      await seedAndTrack({
        id: `bm-page-${i}`,
        url: `https://page${i}.example.com`,
        userId: TEST_USER_ID,
      });
    }

    const res = await app.request("/api/bookmarks?limit=1&offset=1", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.total).toBe(3);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(1);
    expect(body.bookmarks).toHaveLength(1);
  });

  it("sorts by newest (default), oldest, title, and updated", async () => {
    await seedAndTrack({
      id: "bm-sort-a",
      url: "https://a.example.com",
      userId: TEST_USER_ID,
      title: "Alpha",
      createdAt: 1000,
      updatedAt: 5000,
    });
    await seedAndTrack({
      id: "bm-sort-b",
      url: "https://b.example.com",
      userId: TEST_USER_ID,
      title: "Charlie",
      createdAt: 3000,
      updatedAt: 3000,
    });
    await seedAndTrack({
      id: "bm-sort-c",
      url: "https://c.example.com",
      userId: TEST_USER_ID,
      title: "Bravo",
      createdAt: 2000,
      updatedAt: 4000,
    });

    const newest = await app.request("/api/bookmarks", undefined, env as any);
    expect(((await newest.json()) as any).bookmarks.map((b: any) => b.id)).toEqual([
      "bm-sort-b",
      "bm-sort-c",
      "bm-sort-a",
    ]);

    const oldest = await app.request("/api/bookmarks?sort=oldest", undefined, env as any);
    expect(((await oldest.json()) as any).bookmarks.map((b: any) => b.id)).toEqual([
      "bm-sort-a",
      "bm-sort-c",
      "bm-sort-b",
    ]);

    const title = await app.request("/api/bookmarks?sort=title", undefined, env as any);
    expect(((await title.json()) as any).bookmarks.map((b: any) => b.title)).toEqual([
      "Alpha",
      "Bravo",
      "Charlie",
    ]);

    const titleDesc = await app.request("/api/bookmarks?sort=title_desc", undefined, env as any);
    expect(((await titleDesc.json()) as any).bookmarks.map((b: any) => b.title)).toEqual([
      "Charlie",
      "Bravo",
      "Alpha",
    ]);

    const updated = await app.request("/api/bookmarks?sort=updated", undefined, env as any);
    expect(((await updated.json()) as any).bookmarks.map((b: any) => b.id)).toEqual([
      "bm-sort-a",
      "bm-sort-c",
      "bm-sort-b",
    ]);
  });
});

// ──────────────────────────────────────────────
// GET /api/bookmarks/:id
// ──────────────────────────────────────────────

describe("GET /api/bookmarks/:id", () => {
  it("returns a single bookmark", async () => {
    await seedAndTrack({
      id: "bm-single-001",
      url: "https://single.example.com",
      userId: TEST_USER_ID,
      title: "My Bookmark",
    });

    const res = await app.request("/api/bookmarks/bm-single-001", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.id).toBe("bm-single-001");
    expect(body.url).toBe("https://single.example.com");
    expect(body.title).toBe("My Bookmark");
    expect(body.tags).toEqual([]);
  });

  it("returns 404 for non-existent bookmark", async () => {
    const res = await app.request("/api/bookmarks/non-existent-id", undefined, env as any);
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  it("returns a public bookmark even if it belongs to another user", async () => {
    await seedAndTrack({
      id: "bm-foreign-001",
      url: "https://foreign.example.com",
      userId: "other-user",
      visibility: "public",
    });

    const res = await app.request("/api/bookmarks/bm-foreign-001", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.id).toBe("bm-foreign-001");
  });

  it("returns 404 for another user's private bookmark", async () => {
    await seedAndTrack({
      id: "bm-foreign-priv-001",
      url: "https://foreign-private.example.com",
      userId: "other-user",
      visibility: "private",
    });

    const res = await app.request("/api/bookmarks/bm-foreign-priv-001", undefined, env as any);
    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────
// PATCH /api/bookmarks/:id
// ──────────────────────────────────────────────

describe("PATCH /api/bookmarks/:id", () => {
  it("updates title and description", async () => {
    await seedAndTrack({
      id: "bm-update-001",
      url: "https://update.example.com",
      userId: TEST_USER_ID,
    });

    const res = await app.request(
      "/api/bookmarks/bm-update-001",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated Title",
          description: "Updated description",
        }),
      },
      env as any,
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.title).toBe("Updated Title");
    expect(body.description).toBe("Updated description");
  });

  it("updates visibility", async () => {
    await seedAndTrack({
      id: "bm-update-vis-001",
      url: "https://update-vis.example.com",
      userId: TEST_USER_ID,
      visibility: "public",
    });

    const res = await app.request(
      "/api/bookmarks/bm-update-vis-001",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: "private" }),
      },
      env as any,
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.visibility).toBe("private");
  });

  it("returns 400 when no fields provided", async () => {
    await seedAndTrack({
      id: "bm-update-002",
      url: "https://update2.example.com",
      userId: TEST_USER_ID,
    });

    const res = await app.request(
      "/api/bookmarks/bm-update-002",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      env as any,
    );

    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toMatch(/no fields/i);
  });

  it("returns 404 for non-existent bookmark", async () => {
    const res = await app.request(
      "/api/bookmarks/non-existent-id",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Ghost" }),
      },
      env as any,
    );

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────
// DELETE /api/bookmarks/:id
// ──────────────────────────────────────────────

describe("DELETE /api/bookmarks/:id", () => {
  it("deletes and returns { ok: true }", async () => {
    await seedAndTrack({
      id: "bm-delete-001",
      url: "https://delete.example.com",
      userId: TEST_USER_ID,
    });

    const res = await app.request(
      "/api/bookmarks/bm-delete-001",
      {
        method: "DELETE",
      },
      env as any,
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toEqual({ ok: true });

    // Remove from cleanup list since we already deleted it
    seededIds = seededIds.filter((id) => id !== "bm-delete-001");
  });

  it("returns 404 for non-existent bookmark", async () => {
    const res = await app.request(
      "/api/bookmarks/non-existent-id",
      {
        method: "DELETE",
      },
      env as any,
    );

    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.error).toMatch(/not found/i);
  });
});
