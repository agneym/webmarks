import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

/**
 * Better Auth device-authorization plugin schema for D1 (SQLite).
 *
 * Table: device_code
 *
 * Used by the CLI browser login flow: a device gets a short-lived
 * deviceCode/userCode pair that the user approves in the browser.
 * Better Auth manages this table at runtime.
 */
export const deviceCode = sqliteTable(
  "device_code",
  {
    id: text("id").primaryKey(),
    deviceCode: text("device_code").notNull(),
    userCode: text("user_code").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    status: text("status", { enum: ["pending", "approved", "denied"] }).notNull(),
    lastPolledAt: integer("last_polled_at", { mode: "timestamp_ms" }),
    pollingInterval: integer("polling_interval"),
    clientId: text("client_id"),
    scope: text("scope"),
  },
  (table) => [
    unique("device_code_device_code_unique").on(table.deviceCode),
    unique("device_code_user_code_unique").on(table.userCode),
  ],
);
