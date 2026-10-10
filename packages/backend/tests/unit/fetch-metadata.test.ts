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

  it("rejects unsupported protocols and non-HTML file extensions", async () => {
    const cases: Array<[url: string, error: string]> = [
      ["ftp://example.com", "Unsupported protocol: ftp:"],
      ["mailto:user@example.com", "Unsupported protocol: mailto:"],
      ["https://example.com/doc.pdf", "non-HTML resource (.pdf)"],
      // Extension matching is case-insensitive.
      ["https://example.com/DOC.PDF", "non-HTML resource (.pdf)"],
      ["https://example.com/image.png", "non-HTML resource (.png)"],
      ["https://example.com/video.mp4", "non-HTML resource (.mp4)"],
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await Promise.all(
      cases.map(([url, error]) => expect(fetchMetadata(url)).rejects.toThrow(error)),
    );
    // Rejected before any network request is made.
    expect(fetchSpy).not.toHaveBeenCalled();
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
