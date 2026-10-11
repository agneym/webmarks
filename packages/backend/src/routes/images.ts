import { Hono } from "hono";
import { GENERATED_IMAGE_CACHE_CONTROL, generatedImageKey } from "../lib/blueprint-image";

const images = new Hono<{ Bindings: CloudflareBindings }>();

// Bookmark ids are UUIDs; anything else can't name a stored image.
const GENERATED_FILE = /^([A-Za-z0-9_-]{1,64})\.jpg$/;

// GET /images/generated/:id.jpg — a generated blueprint image from R2.
// Keys are per bookmark and an image is never rewritten in place, so it can be
// cached forever.
images.get("/generated/:file", async (c) => {
  const id = GENERATED_FILE.exec(c.req.param("file"))?.[1];
  const object = id ? await c.env.IMAGES.get(generatedImageKey(id)) : null;
  if (!object) {
    return c.json({ error: "Image not found" }, 404);
  }

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "image/jpeg",
      "Content-Length": String(object.size),
      "Cache-Control": GENERATED_IMAGE_CACHE_CONTROL,
      ETag: object.httpEtag,
    },
  });
});

export default images;
