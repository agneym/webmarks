/** Exact-match tracking params that carry no page content. */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "twclid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "ck_subscriber_id",
  "_hsenc",
  "_hsmi",
  "mkt_tok",
  "ref_src",
  "si",
]);

/** Prefixes for families of tracking params (utm_source, utm_campaign, ...). */
const TRACKING_PREFIXES = ["utm_", "ck_", "vero_", "pk_"];

/**
 * Removes tracking query params (utm_*, fbclid, ck_subscriber_id, ...) while
 * keeping params that identify content (e.g. YouTube's `v`). Returns the input
 * unchanged if it isn't a parseable URL.
 */
export function cleanUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return input;
  }
  const kept = new URLSearchParams();
  let removed = false;
  for (const [key, value] of parsed.searchParams) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAMS.has(lower) || TRACKING_PREFIXES.some((p) => lower.startsWith(p))) {
      removed = true;
    } else {
      kept.append(key, value);
    }
  }
  if (removed) parsed.search = kept.toString();
  return parsed.toString();
}
