import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./helpers";

export const bookmark = sqliteTable("bookmark", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  ...timestamps,
});
