import { describe, expect, it } from "vitest";
import { pollDecision } from "../src/device";

describe("pollDecision", () => {
  it("returns the token on success", () => {
    expect(pollDecision(200, '{"access_token":"tok"}', 5)).toEqual({
      kind: "success",
      token: "tok",
    });
  });

  it("treats a 200 without a token as fatal", () => {
    expect(pollDecision(200, "{}", 5).kind).toBe("fatal");
  });

  it("keeps polling while authorization is pending", () => {
    expect(pollDecision(400, '{"error":"authorization_pending"}', 5)).toEqual({
      kind: "pending",
      interval: 5,
    });
  });

  it("backs off by 5s on slow_down (RFC 8628 §3.5)", () => {
    expect(pollDecision(400, '{"error":"slow_down"}', 5)).toEqual({
      kind: "pending",
      interval: 10,
    });
  });

  it("stops on denial, expiry and unknown errors", () => {
    expect(pollDecision(400, '{"error":"access_denied"}', 5)).toMatchObject({
      kind: "fatal",
      message: expect.stringMatching(/denied/),
    });
    expect(pollDecision(400, '{"error":"expired_token"}', 5)).toMatchObject({
      message: expect.stringMatching(/expired/),
    });
    expect(pollDecision(500, "<html>oops</html>", 5)).toMatchObject({
      message: expect.stringMatching(/HTTP 500/),
    });
  });
});
