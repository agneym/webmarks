# Webmarks

[![CI](https://github.com/agneym/webmarks/actions/workflows/ci.yml/badge.svg)](https://github.com/agneym/webmarks/actions/workflows/ci.yml)
[![Deployed on Cloudflare Workers](https://img.shields.io/badge/Deployed_on-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://backend.quickread.workers.dev)
[![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white)](https://bun.sh)
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

Requires [mise](https://mise.jdx.dev) (installs Bun and hk from `mise.toml`), Node 24 (wrangler and the Workers test pool run on Node) and, for the CLI, a Rust toolchain.

```sh
mise install
bun install
hk install                                   # optional: oxfmt + oxlint pre-commit hook

cd packages/backend
cp .dev.vars.example .dev.vars               # fill in secrets, set OWNER_EMAIL
bun run db:migrate-local                     # apply migrations to the local D1
bun run dev                                  # wrangler dev on http://localhost:8787
```

For Google sign-in locally, add `http://localhost:8787/api/auth/callback/google` as an authorized redirect URI on the OAuth client.

Checks (the same ones CI runs):

```sh
bun run fmt:check                            # oxfmt (bun run fmt to fix)
bun run lint                                 # oxlint
bun run test                                 # vitest in the Workers pool, fully local
(cd packages/backend && bun run type:check)  # tsc
(cd packages/cli && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
```

Schema changes: edit `packages/backend/src/db/schema`, then `bun run db:generate` in `packages/backend` to write a migration into `packages/backend/drizzle`.

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

The CLI defaults to `http://localhost:8787`. Point it at production with `--base-url` (per command) or `WEBMARKS_BASE_URL`:

```sh
export WEBMARKS_BASE_URL=https://backend.quickread.workers.dev

webmarks login                               # device flow; --no-open prints the URL
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

The session token is stored in `<config dir>/webmarks/config.json` (`~/.config/webmarks/config.json` on Linux, `~/Library/Application Support/webmarks/config.json` on macOS) with `0600` permissions.

## Image backfill

Owner-only endpoint that generates images for bookmarks that have none, oldest first. It is idempotent; call it until `remaining` is `0` (`limit` 1-20, default 5):

```sh
curl -X POST -H "Authorization: Bearer $WEBMARKS_TOKEN" \
  "https://backend.quickread.workers.dev/api/admin/backfill-images?limit=5"
```

`$WEBMARKS_TOKEN` is the `session_token` from the CLI config file. Generated images are served from `/images/generated/<bookmark id>.jpg`. See [`packages/backend`](packages/backend/README.md) for how they are made.
