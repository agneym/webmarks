# Webmarks CLI (Rust + clap) Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a Rust CLI (`webmarks`) that talks to the existing webmarks backend (`packages/backend`, a Hono + Cloudflare Workers + D1 API), supporting bookmark CRUD, tag management, and session-based auth.

**Architecture:** A new `packages/cli` (or top-level `cli/`) Rust crate using clap v4 with the derive API. The CLI is a pure HTTP client — it mirrors the REST endpoints already mounted at `/api/bookmarks` and `/api/tags`. Auth reuses the backend's Better Auth session cookie/token (stored locally in a config file). JSON responses are deserialized into serde structs mirroring `packages/backend/src/routes/bookmarks/schemas.ts`.

**Tech Stack:** Rust 2021, clap v4 (derive feature), reqwest (json + rustls-tls), serde/serde_json, tokio, anyhow, dirs (config path).

---

## Current Context

Backend API surface (verified in repo):

- `POST   /api/bookmarks` — body `{url, visibility?}` → 201 Bookmark, 409 duplicate
- `GET    /api/bookmarks` — query `{limit, offset, q, tag, fetchStatus, visibility, sort}` → `{bookmarks[], total, limit, offset}`
- `GET    /api/bookmarks/{id}` → Bookmark | 404
- `PATCH  /api/bookmarks/{id}` — body `{title?, description?, visibility?}` → 200 Bookmark
- `DELETE /api/bookmarks/{id}` → `{ok:true}` | 404
- `PUT    /api/bookmarks/{id}/tags` — body `{tags: string[] (max 50)}` → `{tags[]}`
- `GET    /api/bookmarks/{id}/tags` → `{tags[]}`
- `GET    /api/tags` → tags with bookmarkCount (`TagWithCountSchema`)
- Auth: Better Auth; reads are public, mutations require session. Session is resolved from request headers via `auth.api.getSession`.

Bookmark JSON shape (from `schemas.ts`): `{id, url, userId, title?, description?, image?, favicon?, fetchStatus: "pending"|"success"|"failed", visibility: "public"|"private", tags: [{id, name}]}`.

Open questions to resolve before/during implementation:
1. **Auth mechanism** — Better Auth client normally uses cookies. For a CLI we need either (a) an API-key/session-token header accepted by the worker, or (b) a `webmarks login` command that performs Better Auth sign-in and stores the session cookie. Task 2 below assumes storing the session token/cookie from `/api/auth/sign-in/email`; verify against the Better Auth docs in `node_modules/better-auth` during implementation.
2. **Workspace location** — plan assumes `packages/cli` (consistent with `packages/*` bun workspaces layout); Rust does not need to be part of the bun workspace.

---

## Proposed Commands

```
webmarks add <URL> [--visibility public|private]
webmarks list [--limit N] [--offset N] [-q QUERY] [--tag NAME] [--status pending|success|failed] [--sort newest|oldest|title|title_desc|updated]
webmarks get <ID>
webmarks update <ID> [--title T] [--description D] [--visibility public|private]
webmarks rm <ID>
webmarks tag set <BOOKMARK_ID> <TAGS>...     # replaces all tags
webmarks tag ls <BOOKMARK_ID>
webmarks tags                                # list all tags with counts
webmarks login --email E [--password-prompt]
webmarks logout
webmarks whoami                              # GET /api/me
```

Global flags: `--base-url <URL>` (default `http://localhost:8787`, overridable by `WEBMARKS_BASE_URL` env), `--json` (raw JSON output instead of pretty table).

---

## Step-by-step Plan

### Task 0: Scaffold crate

**Files:**
- Create: `packages/cli/Cargo.toml`
- Create: `packages/cli/src/main.rs`

Steps:
1. `cargo init packages/cli --name webmarks`.
2. Cargo.toml deps: `clap = { version = "4", features = ["derive"] }`, `reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }`, `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`, `tokio = { version = "1", features = ["macros", "rt-multi-thread"] }`, `anyhow = "1"`, `dirs = "6"`.
3. Verify: `cargo build && cargo run -- --help` prints help.
4. Add `packages/cli/target` to `.gitignore`.
5. Commit: `feat(cli): scaffold rust cli crate`.

### Task 1: Models and config

**Files:**
- Create: `packages/cli/src/models.rs` — `Bookmark`, `Tag`, `BookmarkListResponse` structs with serde (`#[serde(rename_all = "camelCase")]`, nullable fields as `Option<String>`).
- Create: `packages/cli/src/config.rs` — load/save `~/.config/webmarks/config.json` holding `{ base_url: Option<String>, session_token: Option<String> }` via `dirs::config_dir()`.

Test: unit test that a sample Bookmark JSON response parses (use shape from `schemas.ts`). Run: `cargo test`.

Commit: `feat(cli): models and config persistence`.

### Task 2: HTTP client + auth

**Files:**
- Create: `packages/cli/src/api.rs` — `Client { http: reqwest::Client, base_url: String }` with typed methods: `create_bookmark`, `list_bookmarks(ListOpts)`, `get_bookmark(id)`, `update_bookmark(id, UpdateOpts)`, `delete_bookmark(id)`, `set_tags(id, Vec<String>)`, `list_tags_for(id)`, `list_tags()`, `whoami()`, `sign_in(email, password)`.
- Each method sends `Cookie: better-auth.session_token=<token>` header when a token exists; maps non-2xx to `anyhow` errors carrying the body's `{error}` field.

TDD: integration test against `wrangler dev` (`bun run --filter backend dev`) hitting `http://localhost:8787`:
- `list_bookmarks` returns 200 on fresh DB.
- Unauthorized mutation returns error message "Unauthorized".

Run: `cargo test` with `WEBMARKS_BASE_URL=http://localhost:8787`.
Commit: `feat(cli): api client with auth cookie`.

### Task 3: Clap definitions + output formatting

**Files:**
- Create: `packages/cli/src/cli.rs` — `#[derive(Parser)] struct Cli { #[command(subcommand)] command: Commands, #[arg(long, global)] json: bool, #[arg(long)] base_url: Option<Url> }` with subcommand enums matching the command list above.
- Create: `packages/cli/src/output.rs` — pretty table renderer for `list` (columns: id short-form, title/url, tags, status, visibility) and human messages for `add/rm/update`.

Tests: `assert_cmd` + `predicates` dev-deps to smoke-test `--help` for each subcommand and unknown-command errors.

Commit: `feat(cli): clap commands and output rendering`.

### Task 4: Wire main + per-command handlers

**Files:**
- Modify: `packages/cli/src/main.rs` — tokio main; dispatch each subcommand to a handler module; exit codes: 0 success, 1 API/network error, 2 not found.

Verify manually against local stack:
```
mise exec -- bun run db:migrate-local        # if needed
cd packages/backend && wrangler dev &
cargo run -p webmarks -- add https://example.com
cargo run -p webmarks -- list
cargo run -p webmarks -- get <id>
cargo run -p webmarks -- rm <id>
```
Commit: `feat(cli): wire subcommands`.

### Task 5: Polish

- Sort order value objects validated at parse time via `ValueEnum` for `--sort`, `--visibility`, `--status`.
- Shell completion generation: `clap_complete` behind `gen-completions` subcommand (optional).
- README section in `README.md` documenting install (`cargo install --path packages/cli`) and usage.

---

## Files Likely To Change

- Create: `packages/cli/*` (new crate)
- Modify: `README.md` (usage docs)
- Modify: `.gitignore` (ignore `target/`)
- No backend changes assumed, except possibly adding an explicit token-auth path if Better Auth cookie flow proves impractical from a CLI (Task 2 open question).

## Tests / Validation

- `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` in `packages/cli`.
- Existing monorepo checks stay green: `bun run lint`, `bun run type:check` (in `packages/backend`).
- Manual end-to-end pass against `wrangler dev` covering happy paths and 404/409/401 cases.

## Risks & Tradeoffs

1. **Better Auth from CLI** — biggest unknown. Mitigation: implement `login` first, spike the exact headers Better Auth requires (check `c.req.raw.headers` handling in `src/lib/auth.ts`); fall back to adding an `Authorization`-token middleware to the backend if needed.
2. **reqwest weight** — acceptable for correctness/simplicity; `ureq` is a lighter alternative if binary size matters.
3. **Duplicating schemas** — TS zod schemas and Rust structs can drift; keep them minimal and note the source file in a comment.
