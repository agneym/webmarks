import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Example users table.
 * Copy this pattern to create additional tables.
 */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
