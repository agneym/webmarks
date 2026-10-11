import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { createTestApp } from "../helpers/create-test-app";
import { seedBookmark, seedUser } from "../helpers/seed";
import { applyMigrations } from "../helpers/migrations";
import { createFakeAi, FAKE_JPEG } from "../helpers/fake-ai";
import { generatedImageKey } from "../../src/lib/blueprint-image";

// Own users so cleanup can't touch rows other test files rely on.
const USER_ID = "images-test-user";
const OTHER_USER_ID = "images-other-user";
const OWNER_EMAIL = (env as any).OWNER_EMAIL as string;
const images = () => (env as any).IMAGES as R2Bucket;
const db = () => (env as any).webmarks as D1Database;

beforeAll(async () => {
  await applyMigrations(db());
  await seedUser(env as any, USER_ID, "images-test@example.com", "Images Test User");
  await seedUser(env as any, OTHER_USER_ID, "images-other@example.com", "Images Other User");
});

afterEach(async () => {
  await db()
    .prepare("DELETE FROM bookmark WHERE user_id IN (?, ?)")
    .bind(USER_ID, OTHER_USER_ID)
    .run();
  const listed = await images().list({ prefix: "generated/" });
  await Promise.all(listed.objects.map((o) => images().delete(o.key)));
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────
// GET /images/generated/:id.jpg
// ──────────────────────────────────────────────

describe("GET /images/generated/:id.jpg", () => {
  const app = createTestApp({ authenticated: false });

  it("serves the stored JPEG with long-lived cache headers", async () => {
    await images().put(generatedImageKey("bm-img-1"), FAKE_JPEG, {
      httpMetadata: { contentType: "image/jpeg" },
    });

    const res = await app.request("/images/generated/bm-img-1.jpg", {}, env as any);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("ETag")).toMatch(/^".+"$/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(FAKE_JPEG);
  });

  it("returns 404 for a missing image or a name that isn't <id>.jpg", async () => {
    await images().put(generatedImageKey("bm-img-2"), FAKE_JPEG);

    const responses = await Promise.all(
      ["/images/generated/nope.jpg", "/images/generated/bm-img-2.png"].map((path) =>
        app.request(path, {}, env as any),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([404, 404]);
  });
});

// ──────────────────────────────────────────────
// POST /api/admin/backfill-images
// ──────────────────────────────────────────────

describe("POST /api/admin/backfill-images", () => {
  const owner = createTestApp({ userId: USER_ID, email: OWNER_EMAIL.toUpperCase() });

  it("rejects anonymous callers and non-owner sessions", async () => {
    const anonymous = await createTestApp({ authenticated: false }).request(
      "/api/admin/backfill-images",
      { method: "POST" },
      env as any,
    );
    const stranger = await createTestApp({ userId: USER_ID, email: "someone@example.com" }).request(
      "/api/admin/backfill-images",
      { method: "POST" },
      env as any,
    );

    expect(anonymous.status).toBe(401);
    expect(stranger.status).toBe(403);
  });

  it("fills the owner's image-less bookmarks oldest first, up to limit, and is idempotent", async () => {
    const t = Date.now();
    await seedBookmark(env as any, {
      id: "bf-1",
      url: "https://a.dev/1",
      userId: USER_ID,
      createdAt: t - 3000,
    });
    await seedBookmark(env as any, {
      id: "bf-2",
      url: "https://a.dev/2",
      userId: USER_ID,
      createdAt: t - 2000,
    });
    await seedBookmark(env as any, {
      id: "bf-3",
      url: "https://a.dev/3",
      userId: USER_ID,
      createdAt: t - 1000,
    });
    await seedBookmark(env as any, {
      id: "bf-has-image",
      url: "https://a.dev/4",
      userId: USER_ID,
      image: "https://a.dev/og.png",
    });
    await seedBookmark(env as any, {
      id: "bf-other",
      url: "https://a.dev/5",
      userId: OTHER_USER_ID,
    });
    const { ai, run } = createFakeAi();
    const testEnv = { ...(env as any), AI: ai };

    const first = await owner.request(
      "/api/admin/backfill-images?limit=2",
      { method: "POST" },
      testEnv,
    );
    expect(first.status).toBe(200);
    const firstBody: any = await first.json();
    expect(firstBody.results.map((r: any) => [r.id, r.status])).toEqual([
      ["bf-1", "generated"],
      ["bf-2", "generated"],
    ]);
    expect(firstBody.remaining).toBe(1);

    const second: any = await (
      await owner.request("/api/admin/backfill-images", { method: "POST" }, testEnv)
    ).json();
    expect(second.results.map((r: any) => r.id)).toEqual(["bf-3"]);
    expect(second.remaining).toBe(0);

    const third: any = await (
      await owner.request("/api/admin/backfill-images", { method: "POST" }, testEnv)
    ).json();
    expect(third.results).toEqual([]);

    // Two model calls (subject + image) per generated bookmark, none for the rest.
    expect(run).toHaveBeenCalledTimes(6);
    const untouched = await db()
      .prepare(
        "SELECT id, image, image_generated FROM bookmark WHERE id IN ('bf-has-image', 'bf-other') ORDER BY id",
      )
      .all();
    expect(untouched.results).toEqual([
      { id: "bf-has-image", image: "https://a.dev/og.png", image_generated: 0 },
      { id: "bf-other", image: null, image_generated: 0 },
    ]);
  });

  it("reports a failed generation and leaves that bookmark for the next run", async () => {
    await seedBookmark(env as any, { id: "bf-fail", url: "https://a.dev/f", userId: USER_ID });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { ai } = createFakeAi({ failImage: true });

    const res = await owner.request(
      "/api/admin/backfill-images",
      { method: "POST" },
      { ...(env as any), AI: ai },
    );

    const body: any = await res.json();
    expect(body.results).toEqual([
      { id: "bf-fail", status: "failed", error: "image model unavailable" },
    ]);
    expect(body.remaining).toBe(1);
  });

  it("rejects a limit outside 1-20", async () => {
    const res = await owner.request(
      "/api/admin/backfill-images?limit=21",
      { method: "POST" },
      env as any,
    );
    expect(res.status).toBe(400);
  });
});

// ──────────────────────────────────────────────
// DELETE /api/bookmarks/:id
// ──────────────────────────────────────────────

describe("DELETE /api/bookmarks/:id with a generated image", () => {
  it("removes the image from R2 along with the bookmark", async () => {
    await seedBookmark(env as any, {
      id: "bm-del-gen",
      url: "https://a.dev/del",
      userId: USER_ID,
      image: "https://backend.test/images/generated/bm-del-gen.jpg",
      imageGenerated: true,
    });
    await images().put(generatedImageKey("bm-del-gen"), FAKE_JPEG);

    const res = await createTestApp({ userId: USER_ID }).request(
      "/api/bookmarks/bm-del-gen",
      { method: "DELETE" },
      env as any,
    );

    expect(res.status).toBe(200);
    expect(await images().head(generatedImageKey("bm-del-gen"))).toBeNull();
  });
});
