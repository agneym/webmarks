import { sql } from "drizzle-orm";
import { integer } from "drizzle-orm/sqlite-core";

/**
 * Reusable timestamp columns for SQLite/D1 tables.
 * Spread into your sqliteTable definition.
 */
export const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull()
    .$onUpdate(() => new Date()),
};
