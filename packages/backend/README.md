```txt
bun install
bun run dev
```

```txt
bun run deploy
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
bun run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>();
```

## Generated bookmark images

When a page has no `og:image`, the queue consumer draws a blueprint-style
illustration with Workers AI and stores it in the `webmarks-images` R2 bucket
(`IMAGES` binding) as `generated/<bookmark id>.jpg`. It is served from
`GET /images/generated/<bookmark id>.jpg`, and `bookmark.image_generated` marks
it so a real `og:image` found by a later refetch replaces it.

One-time setup: `wrangler r2 bucket create webmarks-images`.

Backfill bookmarks that have no image (owner session only, idempotent, call
again until `remaining` is 0):

```sh
curl -X POST -H "Authorization: Bearer $WEBMARKS_TOKEN" \
  "https://backend.quickread.workers.dev/api/admin/backfill-images?limit=5"
```

`$WEBMARKS_TOKEN` is the `session_token` that `webmarks login` saves in
`<config dir>/webmarks/config.json`.
