import { describe, expect, it } from "vitest";
import { cleanUrl } from "../../src/lib/clean-url";

describe("cleanUrl", () => {
  it("removes tracking params", () => {
    expect(cleanUrl("https://a.com/p?ck_subscriber_id=1&utm_source=x&utm_campaign=y")).toBe(
      "https://a.com/p",
    );
  });
  it("keeps content params", () => {
    expect(cleanUrl("https://youtube.com/watch?v=abc&utm_source=x&fbclid=z")).toBe(
      "https://youtube.com/watch?v=abc",
    );
  });
  it("does not normalize urls without tracking params", () => {
    expect(cleanUrl("https://example.com")).toBe("https://example.com");
  });
  it("leaves clean urls alone", () => {
    expect(cleanUrl("https://a.com/p?id=3#frag")).toBe("https://a.com/p?id=3#frag");
  });
});
