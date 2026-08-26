import { Hono } from "hono";
import type { Auth } from "../lib/auth";
import { html, esc } from "../lib/html";

/**
 * Device verification / approval pages (RFC 8628 device flow, user side).
 *
 * Better Auth's device-authorization plugin owns the JSON API:
 *   GET  /api/auth/device?user_code=XXX  (auth.api.deviceVerify)
 *   POST /api/auth/device/approve        (auth.api.deviceApprove)
 *   POST /api/auth/device/deny           (auth.api.deviceDeny)
 *
 * These screens are what the user actually sees:
 *   1. GET /device            — user_code entry form (or sign-in first).
 *   2. GET /device?user_code  — verify via the plugin, show Approve/Deny.
 *   3. POST /device/approve|deny — same-session, forwards to the plugin API,
 *      then renders a "return to your terminal" page.
 */

type Vars = {
  Bindings: CloudflareBindings;
  Variables: { auth: Auth };
};

const app = new Hono<Vars>();

/** Sign-in form; after success the browser returns to `returnTo`. */
function renderSignInPage(returnTo: string): string {
  return `
<div class="card">
  <h2 style="margin-top:0">Sign in to continue</h2>
  <form id="f">
    <input id="email" name="email" type="email" autocomplete="username" placeholder="Email" required>
    <input id="password" name="password" type="password" autocomplete="current-password" placeholder="Password" required>
    <button type="submit">Sign in</button>
  </form>
  <p class="err" id="err"></p>
</div>
<script>
(() => {
  const f = document.getElementById('f');
  const err = document.getElementById('err');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      const resp = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        err.textContent = data?.message ?? 'Sign-in failed (' + resp.status + ')';
        return;
      }
      window.location.href = ${JSON.stringify(returnTo)};
    } catch {
      err.textContent = 'Network error during sign-in';
    }
  });
})();
</script>`;
}

/** Entry form where the user types the code shown in their terminal. */
function renderUserCodeForm(): string {
  return `
<div class="card">
  <h2 style="margin-top:0">Device verification</h2>
  <p>Enter the code shown in your terminal:</p>
  <form method="get" action="/device">
    <input name="user_code" placeholder="XXXX-XXXX" autocomplete="off"
           autocapitalize="characters" spellcheck="false" required>
    <button type="submit">Continue</button>
  </form>
</div>`;
}

/** Approve / Deny screen for a pending device authorization. */
function renderApprovePage(userCode: string, clientId: string, scope: string): string {
  return `
<div class="card">
  <h2 style="margin-top:0">Authorize device</h2>
  <p><code>${esc(userCode)}</code> wants to sign in to Webmarks.</p>
  ${clientId ? `<p>Client: <code>${esc(clientId)}</code></p>` : ""}
  ${scope ? `<p>Scopes: <code>${esc(scope)}</code></p>` : ""}
  <form method="post" action="/device/approve">
    <input type="hidden" name="userCode" value="${esc(userCode)}">
    <button type="submit">Approve</button>
  </form>
  <form method="post" action="/device/deny">
    <input type="hidden" name="userCode" value="${esc(userCode)}">
    <button type="submit" class="secondary">Deny</button>
  </form>
</div>`;
}

function renderMessagePage(message: string, isError = false): string {
  return `
<div class="card">
  <h2 style="margin-top:0">${isError ? "Something went wrong" : "Device verification"}</h2>
  <p>${message}</p>
  <p><a href="/device" style="color:#3b82f6">Back to device verification</a></p>
</div>`;
}

app.get("/", async (c) => {
  const userCode = c.req.query("user_code")?.trim() ?? "";
  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });

  if (!userCode) {
    if (!session) return html(renderSignInPage("/device"));
    return html(renderUserCodeForm());
  }

  // Verification requires a session; otherwise sign in first and come back.
  if (!session) {
    const returnTo = `/device?user_code=${encodeURIComponent(userCode)}`;
    return html(renderSignInPage(returnTo));
  }

  // Ask the plugin about this code. Also claims pending codes for this user.
  try {
    const result = await c.var.auth.api.deviceVerify({
      query: { user_code: userCode },
      headers: c.req.raw.headers,
    });
    if (result.status === "pending" && result.client_id) {
      return html(renderApprovePage(userCode, result.client_id, result.scope ?? ""));
    }
    if (result.status === "approved") {
      return html(
        renderMessagePage("This device has already been approved. Return to your terminal."),
      );
    }
    if (result.status === "denied") {
      return html(renderMessagePage("This device request was denied."), 400);
    }
    // Pending but not owned/reviewable by this user (no client_id returned).
    return html(renderMessagePage("This code could not be verified for your account."), 400);
  } catch {
    // Unknown, malformed, or expired user_code — never leak details.
    return html(
      renderMessagePage(
        "Invalid or expired code. Check the code in your terminal and try again.",
        true,
      ),
      400,
    );
  }
});

async function handleDecision(
  c: {
    req: { raw: Request; parseBody: () => Promise<Record<string, string> | unknown> };
    var: { auth: Auth };
  },
  action: "approve" | "deny",
): Promise<Response> {
  const session = await c.var.auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    return html(renderSignInPage("/device"), 401);
  }
  const body = (await c.req.parseBody()) as Record<string, unknown>;
  const userCode = typeof body.userCode === "string" ? body.userCode.trim() : "";
  if (!userCode) {
    return html(renderMessagePage("Missing user code.", true), 400);
  }
  try {
    const api = action === "approve" ? c.var.auth.api.deviceApprove : c.var.auth.api.deviceDeny;
    await api({ body: { userCode }, headers: c.req.raw.headers });
    return html(
      renderMessagePage(
        `Device <strong>${action === "approve" ? "approved" : "denied"}</strong>. You can return to your terminal now.`,
      ),
    );
  } catch {
    // Expired, already processed, wrong owner, etc.
    return html(
      renderMessagePage(
        `Could not ${action} this request — it may have expired or already been processed.`,
        true,
      ),
      400,
    );
  }
}

app.post("/approve", (c) => handleDecision(c, "approve"));
app.post("/deny", (c) => handleDecision(c, "deny"));

export default app;
