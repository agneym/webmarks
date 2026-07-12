import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp, TEST_USER_ID } from "../helpers/create-test-app";
import { seedUser, seedBookmark, seedTag, seedBookmarkTag } from "../helpers/seed";
import { applyMigrations } from "../helpers/migrations";

const app = createTestApp();

let seededIds: string[] = [];

beforeAll(async () => {
  await applyMigrations((env as any).webmarks);
  // Start with a clean slate for this user
  await (env as any).webmarks
    .prepare("DELETE FROM bookmark WHERE user_id = ?")
    .bind(TEST_USER_ID)
    .run();
  await (env as any).webmarks.prepare("DELETE FROM tag WHERE user_id = ?").bind(TEST_USER_ID).run();
  await seedUser(env as any, TEST_USER_ID, "test@example.com", "Test User");
  await seedUser(env as any, "other-user", "other@example.com", "Other User");
});

afterEach(async () => {
  // Clean up ALL test data by user ID (handles auto-generated IDs too)
  await (env as any).webmarks
    .prepare("DELETE FROM bookmark_tag WHERE bookmark_id IN (SELECT id FROM bookmark WHERE user_id = ?)")
    .bind(TEST_USER_ID)
    .run();
  await (env as any).webmarks.prepare("DELETE FROM bookmark WHERE user_id = ?").bind(TEST_USER_ID).run();
  await (env as any).webmarks.prepare("DELETE FROM tag WHERE user_id = ?").bind(TEST_USER_ID).run();
  seededIds = [];
});

// ──────────────────────────────────────────────
// PUT /api/bookmarks/:id/tags
// ──────────────────────────────────────────────

describe("PUT /api/bookmarks/:id/tags", () => {
  it("sets tags on a bookmark (creates new tags)", async () => {
    const bookmarkId = "bm-tags-put-001";
    await seedBookmark(env as any, {
      id: bookmarkId,
      url: "https://tagged.example.com",
      userId: TEST_USER_ID,
    });
    seededIds.push(bookmarkId);

    const res = await app.request(
      `/api/bookmarks/${bookmarkId}/tags`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: ["work", "important"] }),
      },
      env as any,
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.tags).toHaveLength(2);
    expect(body.tags.map((t: any) => t.name).toSorted()).toEqual(["important", "work"]);
  });

  it("reuses existing tags (no duplicates)", async () => {
    // Pre-create a tag
    await seedTag(env as any, { id: "tag-work", name: "work", userId: TEST_USER_ID });

    const bookmarkId = "bm-tags-put-002";
    await seedBookmark(env as any, {
      id: bookmarkId,
      url: "https://tagged2.example.com",
      userId: TEST_USER_ID,
    });
    seededIds.push(bookmarkId);

    const res = await app.request(
      `/api/bookmarks/${bookmarkId}/tags`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: ["work"] }),
      },
      env as any,
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.tags).toHaveLength(1);
    expect(body.tags[0].id).toBe("tag-work"); // Reused existing, didn't create a new one
    expect(body.tags[0].name).toBe("work");
  });

  it("replaces all tags on subsequent PUT", async () => {
    const bookmarkId = "bm-tags-put-003";
    await seedBookmark(env as any, {
      id: bookmarkId,
      url: "https://tagged3.example.com",
      userId: TEST_USER_ID,
    });
    seededIds.push(bookmarkId);

    // Set initial tags
    await app.request(
      `/api/bookmarks/${bookmarkId}/tags`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: ["work", "important"] }),
      },
      env as any,
    );

    // Replace with new tags
    const res = await app.request(
      `/api/bookmarks/${bookmarkId}/tags`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: ["personal"] }),
      },
      env as any,
    );

    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.tags).toHaveLength(1);
    expect(body.tags[0].name).toBe("personal");
  });

  it("returns 404 for non-existent bookmark", async () => {
    const res = await app.request(
      "/api/bookmarks/non-existent/tags",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: ["test"] }),
      },
      env as any,
    );

    expect(res.status).toBe(404);
  });
});

// ──────────────────────────────────────────────
// GET /api/bookmarks/:id/tags
// ──────────────────────────────────────────────

describe("GET /api/bookmarks/:id/tags", () => {
  it("returns tags for a bookmark", async () => {
    const bookmarkId = "bm-tags-get-001";
    await seedBookmark(env as any, {
      id: bookmarkId,
      url: "https://get-tags.example.com",
      userId: TEST_USER_ID,
    });
    await seedTag(env as any, { id: "tag-work", name: "work", userId: TEST_USER_ID });
    await seedTag(env as any, { id: "tag-important", name: "important", userId: TEST_USER_ID });
    await seedBookmarkTag(env as any, { bookmarkId, tagId: "tag-work" });
    await seedBookmarkTag(env as any, { bookmarkId, tagId: "tag-important" });
    seededIds.push(bookmarkId);

    const res = await app.request(`/api/bookmarks/${bookmarkId}/tags`, undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.tags).toHaveLength(2);
  });

  it("returns 404 for non-existent bookmark", async () => {
    const res = await app.request("/api/bookmarks/non-existent/tags", undefined, env as any);
    expect(res.status).toBe(404);
  });

  it("returns empty tags for bookmark with no tags", async () => {
    const bookmarkId = "bm-tags-get-002";
    await seedBookmark(env as any, {
      id: bookmarkId,
      url: "https://no-tags.example.com",
      userId: TEST_USER_ID,
    });
    seededIds.push(bookmarkId);

    const res = await app.request(`/api/bookmarks/${bookmarkId}/tags`, undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.tags).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// GET /api/tags
// ──────────────────────────────────────────────

describe("GET /api/tags", () => {
  it("returns all user's tags with counts", async () => {
    const bookmarkId = "bm-tags-list-001";
    await seedBookmark(env as any, {
      id: bookmarkId,
      url: "https://list-tags.example.com",
      userId: TEST_USER_ID,
    });
    await seedTag(env as any, { id: "tag-work", name: "work", userId: TEST_USER_ID });
    await seedTag(env as any, { id: "tag-personal", name: "personal", userId: TEST_USER_ID });
    await seedBookmarkTag(env as any, { bookmarkId, tagId: "tag-work" });
    await seedBookmarkTag(env as any, { bookmarkId, tagId: "tag-personal" });
    seededIds.push(bookmarkId);

    const res = await app.request("/api/tags", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.tags).toHaveLength(2);
    expect(body.tags[0].name).toBe("personal"); // Alphabetical order
    expect(body.tags[1].name).toBe("work");
    expect(body.tags[0].bookmarkCount).toBe(1);
    expect(body.tags[1].bookmarkCount).toBe(1);
  });

  it("returns only the authenticated user's tags", async () => {
    // Seed tag for "other-user"
    await seedTag(env as any, { id: "tag-foreign", name: "foreign", userId: "other-user" });

    const res = await app.request("/api/tags", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const foreignTag = body.tags.find((t: any) => t.name === "foreign");
    expect(foreignTag).toBeUndefined();
  });

  it("returns empty array when no tags exist", async () => {
    const res = await app.request("/api/tags", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.tags).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// GET /api/bookmarks — tag filter
// ──────────────────────────────────────────────

describe("GET /api/bookmarks?tag=...", () => {
  it("filters bookmarks by tag", async () => {
    const bm1 = "bm-tagfilter-001";
    const bm2 = "bm-tagfilter-002";
    await seedBookmark(env as any, {
      id: bm1,
      url: "https://work.example.com",
      userId: TEST_USER_ID,
      title: "Work bookmark",
    });
    await seedBookmark(env as any, {
      id: bm2,
      url: "https://personal.example.com",
      userId: TEST_USER_ID,
      title: "Personal bookmark",
    });
    await seedTag(env as any, { id: "tag-work", name: "work", userId: TEST_USER_ID });
    await seedTag(env as any, { id: "tag-personal", name: "personal", userId: TEST_USER_ID });
    await seedBookmarkTag(env as any, { bookmarkId: bm1, tagId: "tag-work" });
    await seedBookmarkTag(env as any, { bookmarkId: bm2, tagId: "tag-personal" });
    seededIds.push(bm1, bm2);

    const res = await app.request("/api/bookmarks?tag=work", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(bm1);
    expect(body[0].title).toBe("Work bookmark");
  });
});

// ──────────────────────────────────────────────
// GET /api/bookmarks — text search
// ──────────────────────────────────────────────

describe("GET /api/bookmarks?q=...", () => {
  it("searches bookmarks by title", async () => {
    const bm1 = "bm-search-001";
    const bm2 = "bm-search-002";
    await seedBookmark(env as any, {
      id: bm1,
      url: "https://example.com/react",
      userId: TEST_USER_ID,
      title: "React Docs",
    });
    await seedBookmark(env as any, {
      id: bm2,
      url: "https://example.com/vue",
      userId: TEST_USER_ID,
      title: "Vue Guide",
    });
    seededIds.push(bm1, bm2);

    const res = await app.request("/api/bookmarks?q=React", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe("React Docs");
  });

  it("searches bookmarks by URL", async () => {
    const bm = "bm-search-003";
    await seedBookmark(env as any, {
      id: bm,
      url: "https://reactjs.org",
      userId: TEST_USER_ID,
    });
    seededIds.push(bm);

    const res = await app.request("/api/bookmarks?q=reactjs", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].url).toBe("https://reactjs.org");
  });

  it("returns empty when no match", async () => {
    const res = await app.request("/api/bookmarks?q=zzzzz_nonexistent", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// GET /api/bookmarks — fetchStatus filter
// ──────────────────────────────────────────────

describe("GET /api/bookmarks?fetchStatus=...", () => {
  it("filters by fetch status", async () => {
    const bm1 = "bm-status-001";
    const bm2 = "bm-status-002";
    await seedBookmark(env as any, {
      id: bm1,
      url: "https://success.example.com",
      userId: TEST_USER_ID,
      fetchStatus: "success",
    });
    await seedBookmark(env as any, {
      id: bm2,
      url: "https://pending.example.com",
      userId: TEST_USER_ID,
      fetchStatus: "pending",
    });
    seededIds.push(bm1, bm2);

    const res = await app.request("/api/bookmarks?fetchStatus=pending", undefined, env as any);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(bm2);
  });
});
