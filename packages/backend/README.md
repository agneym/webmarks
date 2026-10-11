# Webmarks backend

Cloudflare Worker serving the Webmarks API. Setup, configuration and deployment are in the [root README](../../README.md).

## Routes

| Path                                               | Auth                       | Purpose                                                   |
| -------------------------------------------------- | -------------------------- | --------------------------------------------------------- |
| `/api/auth/*`                                      | -                          | Better Auth (Google, email/password, bearer, device flow) |
| `/api/me`                                          | session                    | Current user                                              |
| `/api/bookmarks`                                   | optional (writes: session) | CRUD; `PUT`/`GET /api/bookmarks/:id/tags` for tags        |
| `/api/tags`                                        | optional                   | Tags with bookmark counts                                 |
| `/api/admin/backfill-images`                       | owner                      | Generate missing bookmark images                          |
| `/images/generated/:id.jpg`, `/images/generic.svg` | -                          | Bookmark images                                           |
| `/device`                                          | session                    | Device-login approval page for the CLI                    |
| `/openapi.json`, `/api/doc`                        | -                          | OpenAPI 3.1 spec                                          |

Without a session, only public bookmarks and their tags are returned.

## Scripts

| Script                                           | Does                                                         |
| ------------------------------------------------ | ------------------------------------------------------------ |
| `bun run dev` / `dev:pretty`                     | `wrangler dev` (optionally piped through pino-pretty)        |
| `bun run test` / `test:watch`                    | vitest in the Workers pool (local bindings, fake AI)         |
| `bun run type:check`                             | `tsc --noEmit`                                               |
| `bun run db:generate`                            | drizzle-kit: write a migration from `src/db/schema`          |
| `bun run db:migrate-local` / `db:migrate-remote` | Apply migrations in `drizzle/` to the local / remote D1      |
| `bun run cf-typegen`                             | Regenerate `worker-configuration.d.ts` after binding changes |

## Generated bookmark images

When a page has no `og:image`, the queue consumer draws a blueprint-style illustration with Workers AI and stores it in the `webmarks-images` R2 bucket (`IMAGES` binding) as `generated/<bookmark id>.jpg`. `bookmark.image_generated` marks it, so a real `og:image` found by a later refetch replaces it.

The subject sentence is written by `@cf/google/gemma-4-26b-a4b-it` and the image is drawn by `@cf/black-forest-labs/flux-2-klein-4b` at 768x432. If either model fails, the bookmark gets the generic blueprint from `/images/generic.svg`, with no retry.

One-time setup: `npx wrangler r2 bucket create webmarks-images`.
