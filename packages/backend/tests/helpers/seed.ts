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
