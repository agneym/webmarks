import { createDrizzle } from "./db";
import { bookmark } from "./db/schema";
import { eq } from "drizzle-orm";
import { fetchMetadata } from "./lib/fetch-metadata";

const BASE_DELAY_SECONDS = 30;
const MAX_DELAY_SECONDS = 3600; // 1 hour cap

function calculateExponentialBackoff(
  attempts: number,
  baseDelay: number,
): number {
  return Math.min(baseDelay * Math.pow(2, attempts - 1), MAX_DELAY_SECONDS);
}

export interface QueueMessage {
  bookmarkId: string;
  url: string;
}

export async function handleQueue(
  batch: MessageBatch<QueueMessage>,
  env: CloudflareBindings,
) {
  const db = createDrizzle(env.webmarks);

  for (const msg of batch.messages) {
    const { bookmarkId, url } = msg.body;

    try {
      const metadata = await fetchMetadata(url);

      await db
        .update(bookmark)
        .set({
          title: metadata.title ?? null,
          description: metadata.description ?? null,
          image: metadata.image ?? null,
          favicon: metadata.favicon ?? null,
          fetchStatus: "success",
        })
        .where(eq(bookmark.id, bookmarkId));

      msg.ack();
    } catch (err) {
      console.error(
        `Failed to fetch metadata for ${url} (attempt ${msg.attempts}):`,
        err,
      );

      if (msg.attempts >= 5) {
        // Give up after max retries — mark as failed
        await db
          .update(bookmark)
          .set({ fetchStatus: "failed" })
          .where(eq(bookmark.id, bookmarkId));
        msg.ack();
      } else {
        msg.retry({
          delaySeconds: calculateExponentialBackoff(
            msg.attempts,
            BASE_DELAY_SECONDS,
          ),
        });
      }
    }
  }
}
