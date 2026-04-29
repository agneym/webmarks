import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { timestamps } from "./helpers";

export const bookmark = sqliteTable("bookmark", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  title: text("title"),
  description: text("description"),
  image: text("image"),
  favicon: text("favicon"),
  fetchStatus: text("fetch_status", { enum: ["pending", "success", "failed"] })
    .default("pending")
    .notNull(),
  ...timestamps,
});
