import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema",
  out: "./drizzle",
  driver: "d1-http",
  dbCredentials: {
    // These are used by drizzle-kit for migrations only.
    // Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_DATABASE_ID, and
    // CLOUDFLARE_D1_TOKEN (or CLOUDFLARE_API_TOKEN) as env vars.
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
    token: process.env.CLOUDFLARE_D1_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN!,
  },
});
