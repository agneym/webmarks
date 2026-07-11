import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchMetadata } from "../../src/lib/fetch-metadata";

describe("fetchMetadata", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── URL validation ───────────────────────────────────────────────────

  it("throws on invalid URL", async () => {
    await expect(fetchMetadata("not-a-url")).rejects.toThrow("Invalid URL");
  });

  it("throws on non-http protocol (ftp)", async () => {
    await expect(fetchMetadata("ftp://example.com")).rejects.toThrow("Unsupported protocol");
  });

  it("throws on non-http protocol (mailto)", async () => {
    await expect(fetchMetadata("mailto:user@example.com")).rejects.toThrow("Unsupported protocol");
  });

  it("throws for .pdf extension", async () => {
    await expect(fetchMetadata("https://example.com/doc.pdf")).rejects.toThrow(
      "non-HTML resource (.pdf)",
    );
  });

  it("throws for .png extension", async () => {
    await expect(fetchMetadata("https://example.com/image.png")).rejects.toThrow(
      "non-HTML resource (.png)",
    );
  });

  it("throws for .mp4 extension", async () => {
    await expect(fetchMetadata("https://example.com/video.mp4")).rejects.toThrow(
      "non-HTML resource (.mp4)",
    );
  });

  // ── HTTP error responses ─────────────────────────────────────────────

  it("throws 'Page not found' on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(fetchMetadata("https://example.com/missing")).rejects.toThrow("Page not found");
  });

  it("throws 'Access forbidden' on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Forbidden", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(fetchMetadata("https://example.com/secret")).rejects.toThrow("Access forbidden");
  });

  it("throws 'Server error' on 500", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(fetchMetadata("https://example.com/broken")).rejects.toThrow("Server error");
  });

  // ── Non-text content type ────────────────────────────────────────────

  it("throws on non-text content-type", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(fetchMetadata("https://example.com/api")).rejects.toThrow(
      "Expected HTML but got application/json",
    );
  });

  // ── Metadata extraction ──────────────────────────────────────────────

  it("extracts og:title from HTML", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="OG Title" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.title).toBe("OG Title");
  });

  it("falls back to <title> tag when no og:title", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>Page Title</title>
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.title).toBe("Page Title");
  });

  it("prefers og:title over <title>", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="OG Title" />
  <title>HTML Title</title>
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.title).toBe("OG Title");
  });

  it("extracts og:description", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:description" content="A great description" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.description).toBe("A great description");
  });

  it("resolves relative og:image URLs against base", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:image" content="/images/photo.jpg" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com/page");
    expect(result.image).toBe("https://example.com/images/photo.jpg");
  });

  it("resolves relative favicon URLs against base", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <link rel="icon" href="/favicon.ico" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.favicon).toBe("https://example.com/favicon.ico");
  });

  it("extracts og:site_name", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:site_name" content="My Site" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.siteName).toBe("My Site");
  });

  // ── Twitter Card fallback ────────────────────────────────────────────

  it("falls back to twitter:title when no og:title", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="twitter:title" content="Twitter Title" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.title).toBe("Twitter Title");
  });

  it("falls back to twitter:description when no og:description", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="twitter:description" content="Twitter description" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.description).toBe("Twitter description");
  });

  it("falls back to twitter:image when no og:image", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta name="twitter:image" content="https://example.com/twitter-img.jpg" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.image).toBe("https://example.com/twitter-img.jpg");
  });

  it("prefers og:title over twitter:title", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="OG Title" />
  <meta name="twitter:title" content="Twitter Title" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.title).toBe("OG Title");
  });

  // ── Full metadata extraction ─────────────────────────────────────────

  it("extracts all metadata from a rich HTML page", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta property="og:title" content="My Article" />
  <meta property="og:description" content="An insightful read" />
  <meta property="og:image" content="/og-image.jpg" />
  <meta property="og:site_name" content="Blog" />
  <link rel="icon" href="/favicon.png" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }),
    );

    const result = await fetchMetadata("https://blog.example.com/post/1");
    expect(result).toEqual({
      title: "My Article",
      description: "An insightful read",
      image: "https://blog.example.com/og-image.jpg",
      favicon: "https://blog.example.com/favicon.png",
      siteName: "Blog",
    });
  });

  it("returns empty metadata when no tags present", async () => {
    const html = `<!DOCTYPE html>
<html><head></head><body><p>Hello</p></body></html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result).toEqual({});
  });

  // ── Favicon priority ─────────────────────────────────────────────────

  it("uses mask-icon only when no other favicon is set", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <link rel="mask-icon" href="/mask-icon.svg" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.favicon).toBe("https://example.com/mask-icon.svg");
  });

  it("ignores mask-icon when a higher-priority favicon exists", async () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <link rel="icon" href="/icon.png" />
  <link rel="mask-icon" href="/mask-icon.svg" />
</head>
<body></body>
</html>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const result = await fetchMetadata("https://example.com");
    expect(result.favicon).toBe("https://example.com/icon.png");
  });
});
