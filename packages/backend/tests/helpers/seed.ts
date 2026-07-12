/**
 * Insert a test user directly into D1.
 */
export async function seedUser(env: any, id: string, email: string, name: string) {
  const now = Date.now();
  await env.webmarks
    .prepare(
      "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(id, name, email, 1, now, now)
    .run();
}

/**
 * Insert a test tag directly into D1.
 */
export async function seedTag(env: any, opts: { id: string; name: string; userId: string }) {
  const now = Date.now();
  await env.webmarks
    .prepare(
      "INSERT OR IGNORE INTO tag (id, name, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(opts.id, opts.name, opts.userId, now, now)
    .run();
}

/**
 * Insert a bookmark-tag association directly into D1.
 */
export async function seedBookmarkTag(env: any, opts: { bookmarkId: string; tagId: string }) {
  await env.webmarks
    .prepare("INSERT OR IGNORE INTO bookmark_tag (bookmark_id, tag_id) VALUES (?, ?)")
    .bind(opts.bookmarkId, opts.tagId)
    .run();
}

/**
 * Insert a test bookmark directly into D1.
 */
export async function seedBookmark(
  env: any,
  opts: {
    id: string;
    url: string;
    userId: string;
    title?: string;
    fetchStatus?: string;
  },
) {
  const now = Date.now();
  await env.webmarks
    .prepare(
      "INSERT INTO bookmark (id, url, user_id, title, fetch_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      opts.id,
      opts.url,
      opts.userId,
      opts.title ?? null,
      opts.fetchStatus ?? "pending",
      now,
      now,
    )
    .run();
}
