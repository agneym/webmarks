import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export { schema };

/**
 * Create a Drizzle instance bound to a Cloudflare D1 binding.
 *
 * @param d1 - The D1Database binding from `env.DB` (configured in wrangler.jsonc).
 * @returns A fully-typed Drizzle database instance.
 *
 * @example
 * ```ts
 * const db = createDrizzle(env.DB);
 * const allUsers = await db.select().from(schema.users);
 * ```
 */
export function createDrizzle(d1: D1Database): DrizzleD1Database<typeof schema> {
  return drizzle(d1, { schema });
}

export type Database = ReturnType<typeof createDrizzle>;
