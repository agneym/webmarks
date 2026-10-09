import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import { createAuth } from "../../src/lib/auth";
import { applyMigrations } from "../helpers/migrations";

/**
 * Exercises the real Better Auth instance to make sure the callbackURL the
 * device sign-in page sends to /api/auth/sign-in/social passes Better Auth's
 * origin / callback-URL validation and yields a Google authorize URL whose
 * redirect_uri is on the backend origin.
 */

const BASE_URL = "https://backend.example.test";

function makeEnv(): CloudflareBindings {
  return {
    ...(env as any),
    BETTER_AUTH_URL: BASE_URL,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
    GOOGLE_CLIENT_ID: "dummy-client-id",
    GOOGLE_CLIENT_SECRET: "dummy-client-secret",
    WEB_APP_URL: "http://localhost:3000",
    OWNER_EMAIL: "owner@example.com",
  } as CloudflareBindings;
}

function socialSignIn(callbackURL: string, origin = BASE_URL) {
  const auth = createAuth(makeEnv());
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
      },
      body: JSON.stringify({ provider: "google", callbackURL }),
    }),
  );
}

beforeAll(async () => {
  await applyMigrations((env as any).webmarks);
});

describe("POST /api/auth/sign-in/social from the device page", () => {
  it("accepts a relative /device?user_code=... callbackURL", async () => {
    const res = await socialSignIn("/device?user_code=ABCD-2345");
    expect(res.status).toBe(200);
    const data = (await res.json()) as { url: string; redirect: boolean };
    const url = new URL(data.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("dummy-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE_URL}/api/auth/callback/google`);
    // State cookie for the OAuth round trip is set on the backend origin.
    expect(res.headers.get("set-cookie") ?? "").toMatch(/SameSite=Lax/i);
  });

  it("rejects a callbackURL on an untrusted origin", async () => {
    const res = await socialSignIn("https://evil.example.com/device");
    expect(res.status).toBe(403);
  });
});
