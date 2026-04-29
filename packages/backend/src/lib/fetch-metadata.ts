export interface BookmarkMetadata {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
}

/**
 * Fetch a URL and extract Open Graph / HTML metadata using Cloudflare's
 * native HTMLRewriter (streaming, zero dependencies).
 */
export async function fetchMetadata(url: string): Promise<BookmarkMetadata> {
  const response = await fetch(url, {
    headers: { "User-Agent": "WebmarksBot/1.0" },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const metadata: BookmarkMetadata = {};

  const rewriter = new HTMLRewriter()
    // Open Graph tags
    .on('meta[property="og:title"]', {
      element(el: Element) {
        metadata.title = el.getAttribute("content") ?? undefined;
      },
    })
    .on('meta[property="og:description"]', {
      element(el: Element) {
        metadata.description = el.getAttribute("content") ?? undefined;
      },
    })
    .on('meta[property="og:image"]', {
      element(el: Element) {
        metadata.image = el.getAttribute("content") ?? undefined;
      },
    })
    // Standard HTML fallbacks
    .on('meta[name="description"]', {
      element(el: Element) {
        if (!metadata.description) {
          metadata.description = el.getAttribute("content") ?? undefined;
        }
      },
    })
    .on("title", {
      text(text: Text) {
        if (!metadata.title && text.text.trim()) {
          metadata.title = text.text.trim();
        }
      },
    })
    .on('link[rel="icon"], link[rel="shortcut icon"]', {
      element(el: Element) {
        metadata.favicon = el.getAttribute("href") ?? undefined;
      },
    });

  await rewriter.transform(response).text();
  return metadata;
}
