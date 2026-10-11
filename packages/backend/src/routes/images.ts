import { Hono } from "hono";
import { GENERATED_IMAGE_CACHE_CONTROL, generatedImageKey } from "../lib/blueprint-image";
import { GENERIC_IMAGE_CACHE_CONTROL, GENERIC_IMAGE_SVG } from "../lib/generic-image";

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

// GET /images/generic.svg — shown for bookmarks whose blueprint couldn't be generated.
images.get("/generic.svg", (c) => {
  return c.body(GENERIC_IMAGE_SVG, 200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": GENERIC_IMAGE_CACHE_CONTROL,
  });
});

export default images;
