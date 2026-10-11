# Webmarks

[![CI](https://github.com/agneym/webmarks/actions/workflows/ci.yml/badge.svg)](https://github.com/agneym/webmarks/actions/workflows/ci.yml)
[![Deployed on Cloudflare Workers](https://img.shields.io/badge/Deployed_on-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://backend.quickread.workers.dev)
[![pnpm](https://img.shields.io/badge/pnpm-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)](https://www.rust-lang.org)

Agney's personal bookmarks service, powering <https://www.agney.dev/webmarks>.

- **API:** [Hono](https://hono.dev) + [Better Auth](https://www.better-auth.com) on a Cloudflare Worker, with D1 for storage and a Queue that fetches page metadata.
- **Images:** bookmarks without an `og:image` get a generated blueprint illustration (Workers AI, stored in R2).
- **CLI:** a Rust client, `webmarks`.

Live API: <https://backend.quickread.workers.dev> (OpenAPI spec at [`/openapi.json`](https://backend.quickread.workers.dev/openapi.json)). Public bookmarks and tags are readable without auth. Sign-in is restricted to `OWNER_EMAIL` (Google or email/password); the CLI signs in with the device flow at `/device`.

## Layout

| Path                                    | What                                                |
| --------------------------------------- | --------------------------------------------------- |
| [`packages/backend`](packages/backend/) | Worker: routes, auth, queue consumer, D1 migrations |
| [`packages/cli`](packages/cli/)         | Rust CLI (`webmarks`)                               |

## Local development

Requires [mise](https://mise.jdx.dev), which installs pnpm, hk and Node 24 (wrangler and the Workers test pool run on Node) from `mise.toml`, and, for the CLI, a Rust toolchain.

```sh
mise install
pnpm install
hk install                                   # optional: oxfmt + oxlint pre-commit hook

cd packages/backend
cp .dev.vars.example .dev.vars               # fill in secrets, set OWNER_EMAIL
pnpm run db:migrate-local                    # apply migrations to the local D1
pnpm run dev                                 # wrangler dev on http://localhost:8787
```

For Google sign-in locally, add `http://localhost:8787/api/auth/callback/google` as an authorized redirect URI on the OAuth client.

Checks (the same ones CI runs):

```sh
pnpm run fmt:check                           # oxfmt (pnpm run fmt to fix)
pnpm run lint                                # oxlint
pnpm run test                                # vitest in the Workers pool, fully local
(cd packages/backend && pnpm run type:check) # tsc
(cd packages/cli && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
```

Schema changes: edit `packages/backend/src/db/schema`, then `pnpm run db:generate` in `packages/backend` to write a migration into `packages/backend/drizzle`.

## Configuration

- Non-secret settings (`BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `OWNER_EMAIL`, `WEB_APP_URL`) and bindings (D1, Queue, R2, AI) live in [`packages/backend/wrangler.jsonc`](packages/backend/wrangler.jsonc).
- Secrets are set on the Worker: `npx wrangler secret put BETTER_AUTH_SECRET` and `npx wrangler secret put GOOGLE_CLIENT_SECRET`.
- `packages/backend/.dev.vars` overrides both during `wrangler dev`.

## Deployment

Cloudflare Workers Builds is connected to this repo; there is no deploy step in GitHub Actions.

- **Push to `main`:** `npx wrangler d1 migrations apply webmarks --remote && npx wrangler deploy`. Migrations run first, so a failed migration blocks the deploy.
- **Other branches:** `npx wrangler versions upload` (a preview version, no migrations).

Because migrations go out just before the new code, keep them backward-compatible (additive). Do renames and drops in two steps: ship code that no longer needs the old column, then remove it in a later migration.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pull requests and pushes to `main`:

- **Backend:** oxfmt, oxlint, tsc, vitest
- **CLI:** `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`

## CLI

```sh
cargo install --path packages/cli            # or: cd packages/cli && cargo build --release
```

`webmarks login` saves the server it signed in to, so later commands use it without extra flags. The base URL resolves as `--base-url` > `WEBMARKS_BASE_URL` > the saved login server > `http://localhost:8787`. If that resolves to a server other than the one the saved token came from, the CLI refuses to send the token (exit 1, `BASE_URL_MISMATCH`) rather than leak it; log in to that server or drop the override.

```sh
webmarks login --base-url https://backend.quickread.workers.dev   # device flow; --no-open prints the URL
webmarks whoami
webmarks add https://example.com --visibility private
webmarks list -q rust --tag work --limit 20  # also --status, --visibility, --sort, --cursor
webmarks get <id>
webmarks update <id> --title "New title"
webmarks rm <id>
webmarks tag set <id> rust cli               # replaces all tags on the bookmark
webmarks tag ls <id>
webmarks tags                                # all tags with counts
webmarks logout
```

Add `--json` to any command for machine-readable output. Exit codes: 0 success, 1 API error, 2 not found, 3 auth required, 4 network.

The session token and its server are stored in `<config dir>/webmarks/config.json` (`~/.config/webmarks/config.json` on Linux, `~/Library/Application Support/webmarks/config.json` on macOS) with `0600` permissions.

## Image backfill

Owner-only endpoint that generates images for bookmarks that have none, oldest first. It is idempotent; call it until `remaining` is `0` (`limit` 1-20, default 5):

```sh
curl -X POST -H "Authorization: Bearer $WEBMARKS_TOKEN" \
  "https://backend.quickread.workers.dev/api/admin/backfill-images?limit=5"
```

`$WEBMARKS_TOKEN` is the `session_token` from the CLI config file. Generated images are served from `/images/generated/<bookmark id>.jpg`. See [`packages/backend`](packages/backend/README.md) for how they are made.
