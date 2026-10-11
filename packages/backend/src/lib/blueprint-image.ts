import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db";
import { bookmark, bookmarkTag, tag } from "../db/schema";
import {
  buildImagePrompt,
  buildSubjectMessages,
  fallbackSubject,
  sanitizeSubject,
  type SubjectSource,
} from "./blueprint-prompt";

export const TEXT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
export const IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

/**
 * 16:9 to match the portfolio card's `aspect-video` thumbnail slot. Both are
 * multiples of 16 and inside the model's 256-1920 range.
 */
export const IMAGE_WIDTH = 1280;
export const IMAGE_HEIGHT = 720;

export const GENERATED_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

type ImageEnv = Pick<CloudflareBindings, "AI" | "IMAGES" | "BETTER_AUTH_URL">;

export function generatedImageKey(bookmarkId: string): string {
  return `generated/${bookmarkId}.jpg`;
}

/** Absolute URL of the backend route that serves a generated image. */
export function generatedImageUrl(baseUrl: string, bookmarkId: string): string {
  return new URL(`/images/generated/${encodeURIComponent(bookmarkId)}.jpg`, baseUrl).toString();
}

/** Ask the text model for a subject sentence; fall back to tags on any failure. */
export async function writeSubject(ai: Ai, source: SubjectSource): Promise<string> {
  try {
    const result = await ai.run(TEXT_MODEL, {
      messages: buildSubjectMessages(source),
      max_completion_tokens: 96,
      temperature: 0.5,
      // One short sentence; thinking would only add latency and output tokens.
      chat_template_kwargs: { enable_thinking: false },
    });
    const raw = completionText(result);
    const subject = sanitizeSubject(raw);
    if (subject) return subject;
    console.warn(`Unusable image subject from ${TEXT_MODEL}, using tag fallback:`, raw);
  } catch (err) {
    console.warn(`Subject generation failed, using tag fallback:`, err);
  }
  return fallbackSubject(source);
}

/**
 * The assistant text of a chat completion. Gemma 4 answers in the OpenAI
 * shape (`choices[0].message.content`); older Workers AI text models use
 * `{ response }`, accepted too so a model swap doesn't break parsing.
 */
export function completionText(result: unknown): unknown {
  if (!result || typeof result !== "object") return undefined;
  const { choices, response } = result as { choices?: unknown; response?: unknown };
  if (Array.isArray(choices)) {
    const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message;
    return message?.content;
  }
  return response;
}

/** Render a prompt with FLUX.2 klein and return the JPEG bytes. */
export async function drawBlueprint(ai: Ai, prompt: string): Promise<Uint8Array> {
  // Same fields as the request that produced the reference samples
  // (prompt, width, height as multipart form data); no style reference image.
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(IMAGE_WIDTH));
  form.append("height", String(IMAGE_HEIGHT));

  // FormData doesn't expose its serialized body or boundary; a Response does.
  const encoded = new Response(form);
  const contentType = encoded.headers.get("content-type");
  if (!encoded.body || !contentType) throw new Error("Could not encode image request");

  const result = await ai.run(IMAGE_MODEL, {
    multipart: { body: encoded.body, contentType },
  });
  if (!result?.image) throw new Error(`${IMAGE_MODEL} returned no image`);
  return decodeBase64(result.image);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Write a subject, draw the image and store it in R2.
 * Returns the public URL to store in `bookmark.image`.
 */
export async function generateBlueprintImage(
  env: ImageEnv,
  source: SubjectSource & { id: string },
): Promise<string> {
  const subject = await writeSubject(env.AI, source);
  const bytes = await drawBlueprint(env.AI, buildImagePrompt(subject));
  await env.IMAGES.put(generatedImageKey(source.id), bytes, {
    httpMetadata: { contentType: "image/jpeg", cacheControl: GENERATED_IMAGE_CACHE_CONTROL },
    customMetadata: { subject },
  });
  return generatedImageUrl(env.BETTER_AUTH_URL, source.id);
}

/** Best-effort removal of a generated image that is no longer referenced. */
export async function deleteGeneratedImage(images: R2Bucket, bookmarkId: string): Promise<void> {
  try {
    await images.delete(generatedImageKey(bookmarkId));
  } catch (err) {
    console.warn(`Failed to delete generated image for ${bookmarkId}:`, err);
  }
}

export type EnsureImageResult =
  | { id: string; status: "generated"; image: string }
  | { id: string; status: "skipped" }
  | { id: string; status: "failed"; error: string };

/**
 * Generate and save a blueprint for a bookmark that has no image. Never
 * throws: a failure is logged and reported, and the bookmark keeps image null.
 */
export async function ensureBlueprintImage(
  env: ImageEnv,
  db: Database,
  bookmarkId: string,
): Promise<EnsureImageResult> {
  const [row] = await db
    .select({
      id: bookmark.id,
      url: bookmark.url,
      title: bookmark.title,
      description: bookmark.description,
      image: bookmark.image,
    })
    .from(bookmark)
    .where(eq(bookmark.id, bookmarkId))
    .limit(1);
  // Deleted meanwhile, or it already has an image (real or generated).
  if (!row || row.image) return { id: bookmarkId, status: "skipped" };

  try {
    const tags = await db
      .select({ name: tag.name })
      .from(bookmarkTag)
      .innerJoin(tag, eq(bookmarkTag.tagId, tag.id))
      .where(eq(bookmarkTag.bookmarkId, bookmarkId));

    const image = await generateBlueprintImage(env, { ...row, tags: tags.map((t) => t.name) });

    // Only fill an empty slot, so a real og:image that landed meanwhile wins.
    await db
      .update(bookmark)
      .set({ image, imageGenerated: true })
      .where(and(eq(bookmark.id, bookmarkId), isNull(bookmark.image)));
    return { id: bookmarkId, status: "generated", image };
  } catch (err) {
    console.error(`Blueprint image generation failed for ${bookmarkId}:`, err);
    return {
      id: bookmarkId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
