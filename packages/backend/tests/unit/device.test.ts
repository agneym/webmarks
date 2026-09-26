import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import deviceApp from "../../src/routes/device";

/**
 * Unit tests for the /device verification + approval pages.
 *
 * The device route talks to Better Auth exclusively through `c.var.auth.api`
 * (deviceVerify / deviceApprove / deviceDeny / getSession), so we stub that
 * interface — the plugin's own endpoints are covered by Better Auth itself.
 */

function makeAuth(opts: {
  session: { user: { id: string; email: string } } | null;
  deviceVerify?: (args: any) => Promise<any>;
}) {
  return {
    api: {
      getSession: async () => opts.session,
      deviceVerify: opts.deviceVerify ?? (async () => ({})),
      deviceApprove: vi.fn<() => Promise<{ success: boolean }>>(async () => ({ success: true })),
      deviceDeny: vi.fn<() => Promise<{ success: boolean }>>(async () => ({ success: true })),
    },
    handler: async () => new Response("auth handler"),
  };
}

function makeApp(auth: ReturnType<typeof makeAuth>) {
  const app = new Hono();
  app.use("/device/*", async (c: any, next) => {
    c.set("auth", auth);
    c.set("logger", { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
    await next();
  });
  app.route("/device", deviceApp);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /device (unauthenticated)", () => {
  it("renders the sign-in form when there is no session and no user_code", async () => {
    const app = makeApp(makeAuth({ session: null }));
    const res = await app.request("/device");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("/api/auth/sign-in/email");
    expect(body).not.toContain('name="user_code"');
  });

  it("renders the user-code entry form when signed in", async () => {
    const app = makeApp(makeAuth({ session: { user: { id: "u1", email: "test@example.com" } } }));
    const res = await app.request("/device");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('name="user_code"');
    expect(body).not.toContain("/api/auth/sign-in/email");
  });
});

describe("GET /device?user_code=...", () => {
  it("unauthenticated visit to a bad/nonexistent code shows the sign-in form gracefully", async () => {
    const deviceVerify = vi.fn<() => Promise<Record<string, never>>>(async () => ({}));
    const app = makeApp(makeAuth({ session: null, deviceVerify }));
    const res = await app.request("/device?user_code=NOT-REAL-CODE");
    expect(res.status).toBe(200); // graceful — no crash, no stack trace
    const body = await res.text();
    expect(body).toContain("/api/auth/sign-in/email");
    // No verification is attempted without a session.
    expect(deviceVerify).not.toHaveBeenCalled();
  });

  it("authenticated visit to a bad/nonexistent code renders a graceful error page", async () => {
    const app = makeApp(
      makeAuth({
        session: { user: { id: "u1", email: "test@example.com" } },
        deviceVerify: async () => {
          throw new Error("invalid_request");
        },
      }),
    );
    const res = await app.request("/device?user_code=BOGUS");
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("Invalid or expired code");
    expect(body).not.toContain("invalid_request"); // no internal error leakage
  });

  it("renders an Approve/Deny screen for a pending code owned by the user", async () => {
    const app = makeApp(
      makeAuth({
        session: { user: { id: "u1", email: "test@example.com" } },
        deviceVerify: async () => ({
          user_code: "ABCD-2345",
          status: "pending",
          client_id: "webmarks-cli",
          scope: "bookmarks:write",
        }),
      }),
    );
    const res = await app.request("/device?user_code=ABCD-2345");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('action="/device/approve"');
    expect(body).toContain('action="/device/deny"');
    expect(body).toContain("webmarks-cli");
    expect(body).toContain("bookmarks:write");
  });

  it("renders an error for a pending code not reviewable by this user", async () => {
    const app = makeApp(
      makeAuth({
        session: { user: { id: "u1", email: "test@example.com" } },
        deviceVerify: async () => ({ user_code: "ABCD-2345", status: "pending" }),
      }),
    );
    const res = await app.request("/device?user_code=ABCD-2345");
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("could not be verified");
    expect(body).not.toContain('action="/device/approve"');
  });
});

describe("POST /device/approve and /device/deny", () => {
  it("rejects unauthenticated approval attempts", async () => {
    const auth = makeAuth({ session: null });
    const app = makeApp(auth);
    const res = await app.request("/device/approve", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "userCode=ABCD-2345",
    });
    expect(res.status).toBe(401);
    expect(auth.api.deviceApprove).not.toHaveBeenCalled();
  });

  it("calls deviceApprove with the user code and renders the success page", async () => {
    const auth = makeAuth({
      session: { user: { id: "u1", email: "test@example.com" } },
    });
    const app = makeApp(auth);
    const res = await app.request("/device/approve", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "userCode=ABCD-2345",
    });
    expect(res.status).toBe(200);
    expect(auth.api.deviceApprove).toHaveBeenCalledTimes(1);
    const args = (auth.api.deviceApprove as any).mock.calls[0][0];
    expect(args.body).toEqual({ userCode: "ABCD-2345" });
    expect(args.headers).toBeInstanceOf(Headers);
    const body = await res.text();
    expect(body).toContain("approved");
    expect(body).toContain("terminal");
  });

  it("renders a graceful error page when deny fails (expired/processed)", async () => {
    const auth = makeAuth({
      session: { user: { id: "u1", email: "test@example.com" } },
    });
    (auth.api.deviceDeny as any).mockRejectedValue(new Error("expired_token"));
    const app = makeApp(auth);
    const res = await app.request("/device/deny", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "userCode=ABCD-2345",
    });
    expect(res.status).toBe(400);
    const body = await res.text();
    expect(body).toContain("Could not deny");
    expect(body).not.toContain("expired_token");
  });

  it("rejects a form post without a user code", async () => {
    const auth = makeAuth({
      session: { user: { id: "u1", email: "test@example.com" } },
    });
    const app = makeApp(auth);
    const res = await app.request("/device/approve", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "",
    });
    expect(res.status).toBe(400);
    expect(auth.api.deviceApprove).not.toHaveBeenCalled();
  });
});
