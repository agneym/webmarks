import { createDrizzle } from "./db";
import { bookmark } from "./db/schema";
import { eq } from "drizzle-orm";
import { fetchMetadata } from "./lib/fetch-metadata";
import { deleteGeneratedImage, ensureBlueprintImage } from "./lib/blueprint-image";

const BASE_DELAY_SECONDS = 30;
const MAX_DELAY_SECONDS = 3600; // 1 hour cap
const MAX_ATTEMPTS = 5;

export function calculateExponentialBackoff(attempts: number, baseDelay: number): number {
  return Math.min(baseDelay * Math.pow(2, attempts - 1), MAX_DELAY_SECONDS);
}

export interface QueueMessage {
  bookmarkId: string;
  url: string;
}

export async function handleQueue(batch: MessageBatch<QueueMessage>, env: CloudflareBindings) {
  const db = createDrizzle(env.webmarks);

  // oxlint-disable no-await-in-loop — queue messages must be processed sequentially
  for (const msg of batch.messages) {
    const { bookmarkId, url } = msg.body;

    try {
      const metadata = await fetchMetadata(url);

      const [current] = await db
        .select({ image: bookmark.image, imageGenerated: bookmark.imageGenerated })
        .from(bookmark)
        .where(eq(bookmark.id, bookmarkId))
        .limit(1);
      // Generate once and keep: a refetch without og:image leaves the blueprint alone.
      const keepGenerated = !metadata.image && current?.imageGenerated === true && !!current.image;

      await db
        .update(bookmark)
        .set({
          title: metadata.title ?? null,
          description: metadata.description ?? null,
          image: metadata.image ?? (keepGenerated ? current.image : null),
          imageGenerated: keepGenerated,
          favicon: metadata.favicon ?? null,
          fetchStatus: "success",
        })
        .where(eq(bookmark.id, bookmarkId));

      if (metadata.image && current?.imageGenerated) {
        // A real og:image replaced our blueprint; drop the orphaned object.
        await deleteGeneratedImage(env.IMAGES, bookmarkId);
      } else if (!metadata.image && !keepGenerated) {
        // Never throws, so a generation failure can't send the fetch back for a retry.
        await ensureBlueprintImage(env, db, bookmarkId);
      }

      msg.ack();
    } catch (err) {
      console.error(`Failed to fetch metadata for ${url} (attempt ${msg.attempts}):`, err);

      if (msg.attempts >= MAX_ATTEMPTS) {
        // Give up after max retries — mark as failed
        await db.update(bookmark).set({ fetchStatus: "failed" }).where(eq(bookmark.id, bookmarkId));
        // Still give the card an image: tags and the URL slug are enough for a
        // subject, and nothing better is coming for this bookmark.
        await ensureBlueprintImage(env, db, bookmarkId);
        msg.ack();
      } else {
        msg.retry({
          delaySeconds: calculateExponentialBackoff(msg.attempts, BASE_DELAY_SECONDS),
        });
      }
    }
  }
}
