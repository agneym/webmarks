export const DEFAULT_BASE_URL = "https://backend.quickread.workers.dev";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * Parse a user-entered server address into a bare origin.
 *
 * HTTPS is required so the bearer token never travels in clear text; plain
 * HTTP is allowed only for a local `wrangler dev` backend.
 */
export function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("Enter a full URL, e.g. https://backend.example.com");
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Use https:// (http:// is only allowed for localhost)");
  }
  return url.origin;
}

/** Host permission pattern Chrome needs before the popup can call `baseUrl`. */
export function originPattern(baseUrl: string): string {
  const url = new URL(baseUrl);
  // Match patterns don't take ports; `http://localhost/*` covers every port.
  return `${url.protocol}//${url.hostname}/*`;
}
