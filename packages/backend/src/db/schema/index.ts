/**
 * Barrel export for all Drizzle schemas.
 *
 * Add new schema files under src/db/schema/ and re-export them here.
 * Drizzle will pick up every table exported from the schema directory
 * when generating migrations.
 */
export { user, session, account, verification } from "./auth";
export { bookmark } from "./bookmark";
