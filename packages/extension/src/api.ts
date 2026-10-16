import type { Tag } from "./tags";

/** Thin client for the webmarks API, authenticated with a bearer token. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type User = { id: string; email: string; name?: string };

export type Bookmark = { id: string; url: string; tags: Array<{ id: string; name: string }> };

export function createApi(baseUrl: string, token: string, fetchFn: typeof fetch = fetch) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new ApiError(res.status, data?.error ?? `Request failed (HTTP ${res.status})`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    me: () => request<{ user: User }>("GET", "/api/me").then((r) => r.user),
    // Better Auth rejects sign-out without a JSON body.
    signOut: () => request<unknown>("POST", "/api/auth/sign-out", {}),
    listTags: () => request<{ tags: Tag[] }>("GET", "/api/tags").then((r) => r.tags),
    createBookmark: (url: string) => request<Bookmark>("POST", "/api/bookmarks", { url }),
    setTags: (id: string, tags: string[]) =>
      request<unknown>("PUT", `/api/bookmarks/${encodeURIComponent(id)}/tags`, { tags }),
    deleteBookmark: (id: string) =>
      request<unknown>("DELETE", `/api/bookmarks/${encodeURIComponent(id)}`),
  };
}

export type Api = ReturnType<typeof createApi>;
