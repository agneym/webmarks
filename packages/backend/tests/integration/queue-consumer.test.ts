import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { handleQueue, type QueueMessage } from "../../src/queue-consumer";
import { seedUser, seedBookmark } from "../helpers/seed";
import { applyMigrations } from "../helpers/migrations";

const TEST_USER_ID = "test-user-queue";
const TEST_EMAIL = "queue-test@example.com";
const TEST_NAME = "Queue Test User";

function createMockMessage(body: QueueMessage, attempts = 0) {
  return {
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
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
    await (env as any).webmarks
      .prepare("DELETE FROM user WHERE id = ?")
      .bind(TEST_USER_ID)
      .run();
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

    await handleQueue(batch, env as any);

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
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network error"));

    const msg = createMockMessage({ bookmarkId, url }, 2);
    const batch = { messages: [msg] } as any;

    await handleQueue(batch, env as any);

    // Verify retry was called, ack was not
    expect(msg.retry).toHaveBeenCalledOnce();
    expect(msg.retry).toHaveBeenCalledWith({
      delaySeconds: expect.any(Number),
    });
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
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Server error"));

    const msg = createMockMessage({ bookmarkId, url }, 5);
    const batch = { messages: [msg] } as any;

    await handleQueue(batch, env as any);

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
});
