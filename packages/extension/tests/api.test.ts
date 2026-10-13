import { describe, expect, it, vi } from "vitest";
import { ApiError, createApi } from "../src/api";

function fakeFetch(status: number, body: unknown) {
  return vi.fn<typeof fetch>(
    async () => new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
}

describe("createApi", () => {
  it("sends the bearer token to the configured server", async () => {
    const fetchFn = fakeFetch(200, { user: { id: "u1", email: "a@b.c" } });
    const api = createApi("http://localhost:8787", "secret", fetchFn);
    expect(await api.me()).toEqual({ id: "u1", email: "a@b.c" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("http://localhost:8787/api/me");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
  });

  it("surfaces the server's error message and status", async () => {
    const api = createApi("http://x", "t", fakeFetch(401, { error: "Unauthorized" }));
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, message: "Unauthorized" });
  });
});
