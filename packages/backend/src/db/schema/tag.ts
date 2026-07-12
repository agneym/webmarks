import { index, sqliteTable, text, unique, primaryKey } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";
import { user } from "./auth";
import { bookmark } from "./bookmark";
import { timestamps } from "./helpers";

/**
 * Tags are user-scoped: each user has their own set of tags.
 * The same name can be used by different users independently.
 */
export const tag = sqliteTable(
  "tag",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [
    index("tag_userId_idx").on(table.userId),
    unique("tag_userId_name_unique").on(table.userId, table.name),
  ],
);

/**
 * Junction table linking bookmarks to tags.
 * Composite primary key ensures a bookmark can't have duplicate tags.
 */
export const bookmarkTag = sqliteTable(
  "bookmark_tag",
  {
    bookmarkId: text("bookmark_id")
      .notNull()
      .references(() => bookmark.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.bookmarkId, table.tagId] })],
);

// ── Relations ──────────────────────────────────────────────────────────

export const tagRelations = relations(tag, ({ many, one }) => ({
  user: one(user, {
    fields: [tag.userId],
    references: [user.id],
  }),
  bookmarkTags: many(bookmarkTag),
}));

export const bookmarkTagRelations = relations(bookmarkTag, ({ one }) => ({
  bookmark: one(bookmark, {
    fields: [bookmarkTag.bookmarkId],
    references: [bookmark.id],
  }),
  tag: one(tag, {
    fields: [bookmarkTag.tagId],
    references: [tag.id],
  }),
}));
