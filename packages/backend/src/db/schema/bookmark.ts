import { relations } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./auth";
import { bookmarkTag } from "./tag";
import { timestamps } from "./helpers";

export const bookmark = sqliteTable(
  "bookmark",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title"),
    description: text("description"),
    image: text("image"),
    favicon: text("favicon"),
    fetchStatus: text("fetch_status", { enum: ["pending", "success", "failed"] })
      .default("pending")
      .notNull(),
    ...timestamps,
  },
  (table) => [index("bookmark_userId_idx").on(table.userId)],
);

export const bookmarkRelations = relations(bookmark, ({ many, one }) => ({
  user: one(user, {
    fields: [bookmark.userId],
    references: [user.id],
  }),
  bookmarkTags: many(bookmarkTag),
}));
