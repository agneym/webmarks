import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { failStalePending, handleQueue, type QueueMessage } from "../../src/queue-consumer";
import { seedUser, seedBookmark } from "../helpers/seed";
import { applyMigrations } from "../helpers/migrations";
import { createFakeAi, FAKE_JPEG, imageRequestForm } from "../helpers/fake-ai";
import { IMAGE_MODEL, generatedImageKey } from "../../src/lib/blueprint-image";
import { genericImageUrl } from "../../src/lib/generic-image";

const TEST_USER_ID = "test-user-queue";
const TEST_EMAIL = "queue-test@example.com";
const TEST_NAME = "Queue Test User";

/** Serve `head` as the page for the next fetch. */
function servePage(head: string) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(`<!DOCTYPE html><html><head>${head}</head><body></body></html>`, {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }),
  );
}

async function readBookmark(id: string) {
  return (env as any).webmarks
    .prepare("SELECT title, image, image_generated, fetch_status FROM bookmark WHERE id = ?")
    .bind(id)
    .first();
}

function createMockMessage(body: QueueMessage, attempts = 0) {
  return {
    body,
    attempts,
    ack: vi.fn<() => void>(),
    retry: vi.fn<() => void>(),
  };
}

const images = () => (env as any).IMAGES as R2Bucket;

async function seedForImage(id: string, extra: { image?: string; imageGenerated?: boolean } = {}) {
  await seedUser(env as any, TEST_USER_ID, TEST_EMAIL, TEST_NAME);
  await seedBookmark(env as any, {
    id,
    url: `https://example.com/${id}`,
    userId: TEST_USER_ID,
    fetchStatus: "pending",
    ...extra,
  });
}

async function runConsumer(id: string, ai: Ai, attempts = 1) {
  const msg = createMockMessage({ bookmarkId: id, url: `https://example.com/${id}` }, attempts);
  await handleQueue({ messages: [msg] } as any, { ...(env as any), AI: ai });
  return msg;
}

describe("handleQueue", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    await applyMigrations((env as any).webmarks);
  });

  afterEach(async () => {
    // Clean up seeded data
    await (env as any).webmarks
      .prepare("DELETE FROM bookmark WHERE user_id = ?")
      .bind(TEST_USER_ID)
      .run();
    await (env as any).webmarks.prepare("DELETE FROM user WHERE id = ?").bind(TEST_USER_ID).run();
    vi.restoreAllMocks();
  });

  it("should update bookmark with metadata and ack on success", async () => {
    const bookmarkId = "bm-queue-success";
    const url = "https://example.com/success";
    await seedUser(env as any, TEST_USER_ID, TEST_EMAIL, TEST_NAME);
    await seedBookmark(env as any, {
      id: bookmarkId,
      url,
      userId: TEST_USER_ID,
      fetchStatus: "pending",
    });

    // Mock fetch to return HTML with og:title
    const html = `<!DOCTYPE html>
      <html>
        <head>
          <meta property="og:title" content="Example Page Title" />
          <meta property="og:description" content="A great description" />
        </head>
        <body></body>
      </html>`;
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const msg = createMockMessage({ bookmarkId, url });
    const batch = { messages: [msg] } as any;

    await handleQueue(batch, { ...(env as any), AI: createFakeAi().ai });

    // Verify fetch was called
    expect(fetchSpy).toHaveBeenCalledOnce();

    // Verify bookmark was updated
    const row = await (env as any).webmarks
      .prepare("SELECT title, fetch_status FROM bookmark WHERE id = ?")
      .bind(bookmarkId)
      .first();
    expect(row.title).toBe("Example Page Title");
    expect(row.fetch_status).toBe("success");

    // Verify ack was called, retry was not
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();
  });

  it("should retry when fetch fails and attempts < 5", async () => {
    const bookmarkId = "bm-queue-retry";
    const url = "https://example.com/retry";
    await seedUser(env as any, TEST_USER_ID, TEST_EMAIL, TEST_NAME);
    await seedBookmark(env as any, {
      id: bookmarkId,
      url,
      userId: TEST_USER_ID,
      fetchStatus: "pending",
    });

    // Mock fetch to throw
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network error"));

    vi.spyOn(console, "error").mockImplementation(() => {});
    const msg = createMockMessage({ bookmarkId, url }, 2);
    const batch = { messages: [msg] } as any;

    await handleQueue(batch, env as any);

    // Verify retry was called, ack was not
    expect(msg.retry).toHaveBeenCalledOnce();
    // attempts=2 with a 30s base: 30 * 2^(2-1) = 60s.
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(msg.ack).not.toHaveBeenCalled();

    // Verify bookmark is still pending (not changed to failed)
    const row = await (env as any).webmarks
      .prepare("SELECT fetch_status FROM bookmark WHERE id = ?")
      .bind(bookmarkId)
      .first();
    expect(row.fetch_status).toBe("pending");
  });

  it("should mark as failed and ack when attempts >= 5", async () => {
    const bookmarkId = "bm-queue-failed";
    const url = "https://example.com/failed";
    await seedUser(env as any, TEST_USER_ID, TEST_EMAIL, TEST_NAME);
    await seedBookmark(env as any, {
      id: bookmarkId,
      url,
      userId: TEST_USER_ID,
      fetchStatus: "pending",
    });

    // Mock fetch to throw
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Server error"));

    const msg = createMockMessage({ bookmarkId, url }, 5);
    const batch = { messages: [msg] } as any;

    vi.spyOn(console, "error").mockImplementation(() => {});
    await handleQueue(batch, { ...(env as any), AI: createFakeAi().ai });

    // Verify ack was called, retry was not
    expect(msg.ack).toHaveBeenCalledOnce();
    expect(msg.retry).not.toHaveBeenCalled();

    // Verify bookmark was marked as failed
    const row = await (env as any).webmarks
      .prepare("SELECT fetch_status FROM bookmark WHERE id = ?")
      .bind(bookmarkId)
      .first();
    expect(row.fetch_status).toBe("failed");
  });
  // ── Generated blueprint images ─────────────────────────────────────

  describe("blueprint images", () => {
    afterEach(async () => {
      const listed = await images().list({ prefix: "generated/" });
      await Promise.all(listed.objects.map((o) => images().delete(o.key)));
    });

    it("generates, stores and links a 16:9 blueprint when the page has no og:image", async () => {
      await seedForImage("bm-gen-new");
      servePage(`<meta property="og:title" content="Promise execution" />`);
      const { ai, run: aiRun } = createFakeAi({
        subject: "Subject: a conveyor loop of task boxes.",
      });

      const msg = await runConsumer("bm-gen-new", ai);

      const row = await readBookmark("bm-gen-new");
      expect(row.image).toBe(
        new URL("/images/generated/bm-gen-new.jpg", (env as any).BETTER_AUTH_URL).toString(),
      );
      expect(row.image_generated).toBe(1);
      expect(row.fetch_status).toBe("success");
      expect(msg.ack).toHaveBeenCalledOnce();

      const stored = await images().get(generatedImageKey("bm-gen-new"));
      expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(FAKE_JPEG);
      expect(stored!.httpMetadata?.contentType).toBe("image/jpeg");

      const imageCall = aiRun.mock.calls.find(([model]) => model === IMAGE_MODEL)!;
      const form = await imageRequestForm(imageCall[1]);
      expect(form.get("prompt")).toMatch(
        /^Technical blueprint illustration, .* no logos\. Subject: a conveyor loop of task boxes\.$/,
      );
      expect(form.get("width")).toBe("768");
      expect(form.get("height")).toBe("432");
    });

    it("uses the page's og:image without calling Workers AI", async () => {
      await seedForImage("bm-gen-og");
      servePage(`<meta property="og:image" content="https://example.com/og.png" />`);
      const { ai, run: aiRun } = createFakeAi();

      await runConsumer("bm-gen-og", ai);

      const row = await readBookmark("bm-gen-og");
      expect(row.image).toBe("https://example.com/og.png");
      expect(row.image_generated).toBe(0);
      expect(aiRun).not.toHaveBeenCalled();
    });

    it("replaces a generated image with a real og:image found on refetch", async () => {
      await seedForImage("bm-gen-replace", {
        image: "https://backend.test/images/generated/bm-gen-replace.jpg",
        imageGenerated: true,
      });
      await images().put(generatedImageKey("bm-gen-replace"), FAKE_JPEG);
      servePage(`<meta property="og:image" content="https://example.com/real.png" />`);
      const { ai, run: aiRun } = createFakeAi();

      await runConsumer("bm-gen-replace", ai);

      const row = await readBookmark("bm-gen-replace");
      expect(row.image).toBe("https://example.com/real.png");
      expect(row.image_generated).toBe(0);
      expect(await images().head(generatedImageKey("bm-gen-replace"))).toBeNull();
      expect(aiRun).not.toHaveBeenCalled();
    });

    it("keeps an existing generated image when a refetch still finds no og:image", async () => {
      const existing = "https://backend.test/images/generated/bm-gen-keep.jpg";
      await seedForImage("bm-gen-keep", { image: existing, imageGenerated: true });
      servePage(`<meta property="og:title" content="Still no image" />`);
      const { ai, run: aiRun } = createFakeAi();

      await runConsumer("bm-gen-keep", ai);

      const row = await readBookmark("bm-gen-keep");
      expect(row.image).toBe(existing);
      expect(row.image_generated).toBe(1);
      expect(row.title).toBe("Still no image");
      expect(aiRun).not.toHaveBeenCalled();
    });

    it.each([
      ["the image model fails", { failImage: true }, 1],
      ["the text model fails", { failText: true }, 0],
      ["the text model says nothing usable", { subject: "" }, 0],
    ])(
      "acks without retrying and uses the generic image when %s",
      async (_case, aiOptions, imageCalls) => {
        await seedForImage("bm-gen-fail");
        servePage(`<meta property="og:title" content="Has a title" />`);
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const { ai, run: aiRun } = createFakeAi(aiOptions);

        const msg = await runConsumer("bm-gen-fail", ai);

        const row = await readBookmark("bm-gen-fail");
        expect(row.fetch_status).toBe("success");
        expect(row.title).toBe("Has a title");
        expect(row.image).toBe(genericImageUrl((env as any).BETTER_AUTH_URL));
        expect(row.image_generated).toBe(1);
        expect(await images().head(generatedImageKey("bm-gen-fail"))).toBeNull();
        expect(msg.ack).toHaveBeenCalledOnce();
        expect(msg.retry).not.toHaveBeenCalled();
        // One attempt at most; a failed text model means no image call at all.
        expect(aiRun.mock.calls.filter(([model]) => model === IMAGE_MODEL)).toHaveLength(
          imageCalls,
        );
      },
    );

    it("replaces the generic image with a real og:image found on refetch", async () => {
      const generic = genericImageUrl((env as any).BETTER_AUTH_URL);
      await seedForImage("bm-generic-replace", { image: generic, imageGenerated: true });
      servePage(`<meta property="og:image" content="https://example.com/real.png" />`);
      const { ai, run: aiRun } = createFakeAi();

      await runConsumer("bm-generic-replace", ai);

      const row = await readBookmark("bm-generic-replace");
      expect(row.image).toBe("https://example.com/real.png");
      expect(row.image_generated).toBe(0);
      expect(aiRun).not.toHaveBeenCalled();
    });

    it("still generates an image once the metadata fetch has finally failed", async () => {
      await seedForImage("bm-gen-gaveup");
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("blocked"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { ai } = createFakeAi();

      await runConsumer("bm-gen-gaveup", ai, 5);

      const row = await readBookmark("bm-gen-gaveup");
      expect(row.fetch_status).toBe("failed");
      expect(row.image_generated).toBe(1);
      expect(await images().head(generatedImageKey("bm-gen-gaveup"))).not.toBeNull();
    });

    it("does not generate while the metadata fetch is still being retried", async () => {
      await seedForImage("bm-gen-retrying");
      vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("flaky"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { ai, run: aiRun } = createFakeAi();

      await runConsumer("bm-gen-retrying", ai, 2);

      expect(aiRun).not.toHaveBeenCalled();
    });
  });
});

describe("failStalePending", () => {
  const MINUTE = 60_000;

  beforeAll(async () => {
    await applyMigrations((env as any).webmarks);
  });

  afterEach(async () => {
    await (env as any).webmarks
      .prepare("DELETE FROM bookmark WHERE user_id = ?")
      .bind(TEST_USER_ID)
      .run();
    await (env as any).webmarks.prepare("DELETE FROM user WHERE id = ?").bind(TEST_USER_ID).run();
  });

  it("marks only old pending bookmarks as failed", async () => {
    const now = Date.now();
    await seedUser(env as any, TEST_USER_ID, TEST_EMAIL, TEST_NAME);
    const rows = [
      { id: "bm-stale", fetchStatus: "pending", updatedAt: now - 45 * MINUTE },
      { id: "bm-fresh", fetchStatus: "pending", updatedAt: now - 5 * MINUTE },
      { id: "bm-done", fetchStatus: "success", updatedAt: now - 45 * MINUTE },
    ];
    // oxlint-disable no-await-in-loop — D1 seeding must run sequentially
    for (const r of rows) {
      await seedBookmark(env as any, {
        ...r,
        url: `https://example.com/${r.id}`,
        userId: TEST_USER_ID,
      });
    }

    const swept = await failStalePending({ ...(env as any), AI: createFakeAi().ai }, now);

    expect(swept).toBe(1);
    expect((await readBookmark("bm-stale")).fetch_status).toBe("failed");
    expect((await readBookmark("bm-fresh")).fetch_status).toBe("pending");
    expect((await readBookmark("bm-done")).fetch_status).toBe("success");
  });
});
