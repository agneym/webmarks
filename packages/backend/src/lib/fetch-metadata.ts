export interface BookmarkMetadata {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
  siteName?: string;
}

// Extensions we should never try to parse as HTML
const NON_HTML_EXTENSIONS = new Set([
  "pdf",
  "zip",
  "rar",
  "tar",
  "gz",
  "7z",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "mp3",
  "mp4",
  "wav",
  "avi",
  "mov",
  "mkv",
  "webm",
  "ogg",
  "ogv",
  "oga",
  "m4a",
  "m4v",
  "3gp",
  "gif",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "svg",
  "bmp",
  "ico",
  "tif",
  "tiff",
  "exe",
  "dmg",
  "iso",
]);

/**
 * Validate that the URL is http/https and not a known non-HTML file.
 */
function validateUrl(urlString: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  // Check for non-HTML file extensions
  const pathname = parsed.pathname.toLowerCase();
  const lastSegment = pathname.split("/").pop() ?? "";
  const ext = lastSegment.split(".").pop();
  if (ext && NON_HTML_EXTENSIONS.has(ext)) {
    throw new Error(`URL points to a non-HTML resource (.${ext})`);
  }

  return parsed;
}

/**
 * Resolve a potentially relative URL against a base.
 * Returns undefined if the input is empty/falsy.
 */
function resolveUrl(href: string | undefined, base: URL): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).href;
  } catch {
    return href; // Return as-is if resolution fails
  }
}

/**
 * Fetch a URL and extract Open Graph / HTML metadata using Cloudflare's
 * native HTMLRewriter (streaming, zero dependencies).
 */
export async function fetchMetadata(urlString: string): Promise<BookmarkMetadata> {
  const baseUrl = validateUrl(urlString);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout

  let response: Response;
  try {
    response = await fetch(baseUrl.href, {
      headers: {
        "User-Agent": "WebmarksBot/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      throw new Error(`Timeout fetching ${urlString}`, { cause: err });
    }
    throw new Error(`Network error fetching ${urlString}: ${err?.message}`, { cause: err });
  }
  clearTimeout(timeoutId);

  // Validate response
  if (!response.ok) {
    const status = response.status;
    const message =
      status === 404
        ? "Page not found"
        : status === 403
          ? "Access forbidden"
          : status === 429
            ? "Rate limited"
            : status >= 500
              ? "Server error"
              : `HTTP ${status}`;
    throw new Error(`${message} fetching ${urlString}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType && !contentType.includes("text/")) {
    throw new Error(`Expected HTML but got ${contentType.split(";")[0]} for ${urlString}`);
  }

  // State for HTMLRewriter callbacks
  const metadata: BookmarkMetadata = {};

  // Track image candidates
  let ogImageUrl: string | undefined;

  // Track all favicon candidates (last one wins due to HTMLRewriter ordering,
  // but we order selectors by priority: apple-touch-icon > shortcut icon > icon)
  let faviconHref: string | undefined;

  const rewriter = new HTMLRewriter()
    // ── Open Graph tags ──────────────────────────────────────────────
    .on('meta[property="og:title"]', {
      element(el: Element) {
        if (!metadata.title) {
          metadata.title = el.getAttribute("content")?.trim() || undefined;
        }
      },
    })
    .on('meta[property="og:description"]', {
      element(el: Element) {
        if (!metadata.description) {
          metadata.description = el.getAttribute("content")?.trim() || undefined;
        }
      },
    })
    .on('meta[property="og:image"]', {
      element(el: Element) {
        const content = el.getAttribute("content")?.trim();
        if (content) {
          ogImageUrl = content;
        }
      },
    })

    .on('meta[property="og:site_name"]', {
      element(el: Element) {
        if (!metadata.siteName) {
          metadata.siteName = el.getAttribute("content")?.trim() || undefined;
        }
      },
    })

    // ── Twitter Card tags (fallback) ─────────────────────────────────
    .on('meta[name="twitter:title"], meta[property="twitter:title"]', {
      element(el: Element) {
        if (!metadata.title) {
          metadata.title = el.getAttribute("content")?.trim() || undefined;
        }
      },
    })
    .on('meta[name="twitter:description"], meta[property="twitter:description"]', {
      element(el: Element) {
        if (!metadata.description) {
          metadata.description = el.getAttribute("content")?.trim() || undefined;
        }
      },
    })
    .on('meta[name="twitter:image"], meta[property="twitter:image"]', {
      element(el: Element) {
        if (!ogImageUrl) {
          ogImageUrl = el.getAttribute("content")?.trim() || undefined;
        }
      },
    })

    // ── Standard HTML fallbacks ──────────────────────────────────────
    .on('meta[name="description"]', {
      element(el: Element) {
        if (!metadata.description) {
          metadata.description = el.getAttribute("content")?.trim() || undefined;
        }
      },
    })
    .on('meta[itemprop="description"]', {
      element(el: Element) {
        if (!metadata.description) {
          metadata.description = el.getAttribute("content")?.trim() || undefined;
        }
      },
    })
    .on('meta[name="title"]', {
      element(el: Element) {
        if (!metadata.title) {
          metadata.title = el.getAttribute("content")?.trim() || undefined;
        }
      },
    })
    .on("title", {
      text(text: Text) {
        if (!metadata.title) {
          const t = text.text.trim();
          if (t) metadata.title = t;
        }
      },
    })

    // ── Favicon fallback chain (ordered by specificity) ──────────────
    // apple-touch-icon is high-res and widely available
    .on('link[rel="apple-touch-icon"]', {
      element(el: Element) {
        const href = el.getAttribute("href")?.trim();
        if (href) faviconHref = href;
      },
    })
    .on('link[rel="shortcut icon"]', {
      element(el: Element) {
        const href = el.getAttribute("href")?.trim();
        if (href) faviconHref = href;
      },
    })
    .on('link[rel="icon"]', {
      element(el: Element) {
        const href = el.getAttribute("href")?.trim();
        if (href) faviconHref = href;
      },
    })
    .on('link[rel="mask-icon"]', {
      element(el: Element) {
        const href = el.getAttribute("href")?.trim();
        if (href && !faviconHref) faviconHref = href;
      },
    });

  await rewriter.transform(response).text();

  // Resolve relative URLs
  metadata.image = resolveUrl(ogImageUrl, baseUrl);
  metadata.favicon = resolveUrl(faviconHref, baseUrl);

  return metadata;
}
