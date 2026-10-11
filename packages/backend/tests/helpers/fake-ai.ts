import { vi } from "vitest";
import { IMAGE_MODEL, TEXT_MODEL } from "../../src/lib/blueprint-image";

/** Stand-in JPEG bytes (SOI marker + a little payload); only identity matters. */
export const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
const FAKE_JPEG_BASE64 = btoa(String.fromCharCode(...FAKE_JPEG));

interface FakeAiOptions {
  /** What the text model "says". */
  subject?: string;
  /** Make the image model throw. */
  failImage?: boolean;
}

/**
 * A fake Workers AI binding: canned text from the subject model, FAKE_JPEG from
 * the image model. `run` is a spy so tests can inspect calls.
 */
export function createFakeAi(opts: FakeAiOptions = {}) {
  const run = vi.fn<(model: string, input: unknown) => Promise<unknown>>(async (model) => {
    if (model === TEXT_MODEL) {
      return { response: opts.subject ?? "Subject: a brass gear train meshing with a ratchet." };
    }
    if (model === IMAGE_MODEL) {
      if (opts.failImage) throw new Error("image model unavailable");
      return { image: FAKE_JPEG_BASE64 };
    }
    throw new Error(`unexpected model ${model}`);
  });
  return { ai: { run } as unknown as Ai, run };
}

/** Decode the multipart form the image model was called with. */
export async function imageRequestForm(input: unknown): Promise<FormData> {
  const { multipart } = input as { multipart: { body: ReadableStream; contentType: string } };
  return new Response(multipart.body, {
    headers: { "content-type": multipart.contentType },
  }).formData();
}
