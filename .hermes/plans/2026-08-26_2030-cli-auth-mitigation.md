# CLI Auth Mitigation Plan — Better Auth from a Non-Browser Client

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.
> Companion to `.heres/plans/2026-08-26_2015-webmarks-cli-clap.md` — replaces Task 2's "auth open question" with a concrete, verified design.

## Goal

Let the Rust CLI authenticate mutations (create/update/delete bookmarks, set tags) against the existing Better Auth backend with **zero changes to the auth model** — no new tables, no custom token middleware, no duplicated credential handling.

## What we verified in the codebase (this kills most of the risk)

1. **The `bearer()` plugin is already enabled** — `packages/backend/src/lib/auth.ts:93`:
   ```ts
   bearer(), // Accept Authorization: Bearer *** for non-browser clients
   ```
2. **How it works** (read from `node_modules/better-auth/dist/plugins/bearer/index.mjs`):
   - On any request carrying an `Authorization: Bearer <token>` header, the plugin verifies the token's signature (`HMAC-SHA-256` with `BETTER_AUTH_SECRET`) and rewrites it into the internal `better-auth.session_token` cookie. From then on normal session resolution applies — `auth.api.getSession({ headers })` in your route middleware just works.
   - On any auth response that sets a session cookie, an `after` hook mirrors the raw token into a **`set-auth-token` response header**.
3. **That header is already exposed to CORS** — `packages/backend/src/index.ts:38`: `exposeHeaders: ["set-auth-token"]`. The groundwork for non-browser clients was done deliberately.
4. Session model is ordinary: tokens live in the `session` table (D1), signed-cookie format `<token>.<signature>`, multi-session enabled (`maximumSessions: 5`), so a CLI login is just "another device" alongside browsers.
5. Rate limiting already exists on `/sign-in/email` (3 attempts / 10s) — the CLI must surface 429s gracefully rather than retry-spamming.

**Conclusion:** the CLI authenticates with email+password once, receives a bearer token via `set-auth-token`, stores it locally, and sends `Authorization: Bearer <token>` forever after. No fallback backend change is required; the old "maybe add a token middleware" branch is dead.

---

## Design

### Token lifecycle

```
webmarks login --email you@example.com
  → prompts password (rpassword), POST /api/auth/sign-in/email {email, password}
  → reads `set-auth-token` response header
  → writes token to ~/.config/webmarks/config.json (chmod 600)
  → calls GET /api/me to confirm and print who logged in

every subsequent request
  → Authorization: Bearer <stored-token>
  → expired/revoked session → 401 → CLI prints "Session invalid. Run `webmarks login`."
```

### Why this beats the alternatives

| Option                                           | Verdict                                                                                                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie jar in CLI (replicate browser flow)       | Fragile: must re-sign the HMAC'd cookie value with BETTER_AUTH_SECRET or capture set-cookies on every request; pointless when bearer() exists. ❌        |
| Custom API-key/token middleware added to backend | New secret type to store/handle, bypasses Better Auth's rate limits/session revocation/multi-session management. Only needed if bearer() were absent. ❌ |
| Better Auth `jwt()` plugin + short-lived JWTs    | Nice-to-have later (avoids long-lived stored tokens); extra dependency and token-refresh UX. YAGNI for v1. Defer. ⏸                                      |
| **bearer() plugin as-is**                        | Already configured, sessions revocable (multi-session lets user list/sign-out devices server-side later). ✅                                             |

### Storage rules

- Config file: `${dirs::config_dir()}/webmarks/config.json` → `{"base_url": ..., "session_token": ...}`.
- Create with mode `0600`; refuse to write if file exists with looser perms (warn instead of silently downgrading).
- Password is **never** persisted; prompted each login.
- `webmarks logout` deletes the token client-side AND calls `POST /api/auth/sign-out` with the bearer header so the session row is revoked server-side (matters because `maximumSessions: 5`).

---

## Step-by-step Plan

### Task A: Spike — verify the flow manually before writing any Rust

**Status: ✅ COMPLETE (2026-08-26). All steps verified against `wrangler dev` with a local `.dev.vars`.**

Recorded results:

1. Sign-up/sign-in: both return `set-auth-token: <signed-token>` header. Sign-in response shape:
   ```
   HTTP/1.1 200 OK
   access-control-expose-headers: set-auth-token
   set-auth-token: z4p8oOydmwLk0b4gCoyrM2EoxW3nnbZt.xCzQK+jlZ0hGt4yWTLVLe0DuJPqLWZAQDCDyuqrfMfA=
   ```
   Token format confirmed: `<sessionId>.<hmac>` with URL-safe base64; may arrive percent-encoded in cookies but the header value is used verbatim.
2. Mutate with bearer: `POST /api/bookmarks` + `Authorization: Bearer $TOKEN` → **201** with full bookmark JSON (`{id, url, userId, title, ..., tags[]}`).
3. Unauthenticated mutation → **401** `{"error":"Unauthorized"}` as expected.
4. Public read without token → **200**, works anonymously.
5. `/api/me` with bearer → **200** user JSON (whoami command works).
6. Revocation: `POST /api/auth/sign-out` with bearer → 200 `{"success":true}` (**must send `content-type: application/json` and an empty `{}` body or Better Auth returns 415 UNSUPPORTED_MEDIA_TYPE**). After sign-out the same token gets **401** on `/api/me` — server-side revocation works exactly as designed.

Spike gotchas to carry into Tasks B/C/D:

- `logout` must send `content-type: application/json` + `{}` body to `/api/auth/sign-out`.
- Bonus finding: the metadata-fetch queue ran during the spike (bookmark arrived back with `fetchStatus: "success"`, title "Example Domain", favicon) — local stack is fully functional.
- Note: rate limiting disabled by default in wrangler dev; keep the no-auto-retry rule for production anyway.

**Environment note:** this was run with a throwaway `packages/backend/.dev.vars` (gitignored credentials file — do not commit its values).

### Task B: Config storage + login/logout commands (TDD)

**Files:**

- Modify: `packages/cli/src/config.rs` — add `session_token` load/save, `0600` perms check.
- Create: `packages/cli/src/cmd/login.rs`, `logout.rs`.
- Add dep: `rpassword = "7"` (password prompt; also disables terminal echo).

**TDD cycle:**

1. Failing test: saving config sets permissions `0600`; `whoami` command prints email when token present, "not logged in" when absent.
2. Implement minimal save/load + `login` handler:
   ```rust
   // POST {base_url}/api/auth/sign-in/email {"email": e, "password": p}
   // success → resp.headers().get("set-auth-token") → config.session_token = Some(t)
   // 401/403 → print OWNER_ONLY message hint ("only the site owner can sign in")
   // 429 → "Too many attempts, wait 10 seconds" (no auto-retry)
   ```
3. Tests pass, commit: `feat(cli): login/logout storing bearer token`.

### Task C: Send `Authorization: Bearer` on every request (TDD)

**Files:** modify `packages/cli/src/api.rs`.

1. Failing test (integration vs `wrangler dev`): unauthenticated `create_bookmark` errors "Unauthorized"; authenticated one succeeds. Test helper loads the token from an env var `WEBMARKS_TEST_TOKEN` so CI doesn't need real credentials unless provided.
2. Implement: every method adds the header when `config.session_token.is_some()`; centralize 401 mapping into one `fn into_error(resp)` that produces:
   ```
   error: Unauthorized (401)
   hint: run `webmarks login`
   ```
3. Commit: `feat(cli): attach bearer token and map 401s with hint`.

### Task D: Edge cases & polish

- Expired/revoked token mid-session: same central 401 path (Better Auth validates per-request against D1).
- Network failure between CLI and worker: distinct exit code from auth failure (auth=3, network=4 documented in `--help` long help).
- Optional hardening flag `--danger-password-on-command-line` for scripting; default stays interactive prompt (keeps password out of shell history/process lists).
- Document in README: how revocation works (login again rotates; logout signs out that device only thanks to multi-session).

Verify: full manual pass — `login → whoami → add → rm → logout → add` (last must fail with 401+hint).

---

## Risks / remaining unknowns

1. **`set-auth-token` only appears on responses that create/change a session** (sign-in, etc.). Mitigation: the CLI only ever sources the token from the sign-in response — never assumes it elsewhere. Verified by spike Task A.
2. **Token lifetime** equals Better Auth's session expiry (default 7 days sliding). Acceptable: single-user tool; 401-with-hint UX covers expiry. If longer lifetimes matter later, add the `jwt()` plugin as a follow-up (already the listed deferred option).
3. **Secret at rest**: plaintext token in user-local config with 0600 — standard practice (gh CLI, aws CLI do the same class of thing). Keychain integration is a possible future enhancement, not needed for owner-only deployment.
4. If the spike in Task A fails despite correct usage, the actual fallback (add a tiny route-level check that also accepts a raw session token header) stays documented above but is expected unnecessary since the plugin source was read and understood.

## Files likely to change

- `packages/cli/src/{config.rs, api.rs, main.rs}` (modify)
- `packages/cli/src/cmd/{login.rs, logout.rs, whoami.rs}` (create)
- `packages/cli/Cargo.toml` (+ rpassword dep)
- Backend: **no changes**
