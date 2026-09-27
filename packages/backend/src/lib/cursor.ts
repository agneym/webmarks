/**
 * Opaque pagination cursors for keyset (seek) pagination.
 *
 * A cursor encodes the sort it was produced under plus the sort key and row id
 * of the last item on the page. Callers treat it as an opaque string — only the
 * server knows the shape — which lets the encoding change without breaking
 * clients. Because the sort is part of the payload, a cursor can never be
 * replayed against a different ordering (that would silently skip or repeat
 * rows).
 */

/** Sort orders accepted by the bookmark list endpoint. */
export const SORT_ORDERS = ["newest", "oldest", "title", "title_desc", "updated"] as const;

export type SortOrder = (typeof SORT_ORDERS)[number];

export const DEFAULT_SORT: SortOrder = "newest";

/** Sorts whose key is a timestamp (epoch milliseconds); the rest are strings. */
const TIME_SORTS: ReadonlySet<SortOrder> = new Set(["newest", "oldest", "updated"]);

export function isSortOrder(value: string): value is SortOrder {
  return (SORT_ORDERS as readonly string[]).includes(value);
}

/** Cursor payload: `s`ort order, sort `k`ey of the last row, and its `i`d (tiebreaker). */
export type CursorPayload = { s: SortOrder; k: string | number; i: string };

/** Thrown for any cursor the client could not have received from us. */
export class InvalidCursorError extends Error {
  constructor(message = "Invalid cursor") {
    super(message);
    this.name = "InvalidCursorError";
  }
}

/** Reject absurd query values before they reach the decoder. */
const MAX_CURSOR_LENGTH = 1024;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeCursor(payload: CursorPayload): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

/**
 * Decode and validate a cursor for the requested sort.
 *
 * Throws InvalidCursorError (→ 400) for anything malformed or produced under a
 * different sort, so a bad cursor is a clear client error rather than a
 * silently wrong page.
 */
export function decodeCursor(raw: string, sort: SortOrder): CursorPayload {
  if (raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) {
    throw new InvalidCursorError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(raw)));
  } catch {
    throw new InvalidCursorError();
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new InvalidCursorError();
  }

  const { s, k, i } = parsed as Record<string, unknown>;
  if (typeof s !== "string" || !isSortOrder(s)) {
    throw new InvalidCursorError();
  }
  if (s !== sort) {
    throw new InvalidCursorError(`Cursor was issued for sort "${s}", but sort is "${sort}"`);
  }
  if (typeof i !== "string" || i.length === 0) {
    throw new InvalidCursorError();
  }

  // Timestamp sorts carry a numeric key, string sorts (title) a string key —
  // anything else could not have come from encodeCursor.
  if (TIME_SORTS.has(s)) {
    if (typeof k !== "number" || !Number.isFinite(k)) {
      throw new InvalidCursorError();
    }
    return { s, k, i };
  }

  if (typeof k !== "string") {
    throw new InvalidCursorError();
  }

  return { s, k, i };
}
