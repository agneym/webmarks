import { describe, expect, it } from "vitest";
import { normalizeBaseUrl, originPattern } from "../src/config";

describe("normalizeBaseUrl", () => {
  it("reduces a URL to its origin", () => {
    expect(normalizeBaseUrl(" https://example.com/some/path/ ")).toBe("https://example.com");
  });

  it("allows plain http only for a local backend", () => {
    expect(normalizeBaseUrl("http://localhost:8787")).toBe("http://localhost:8787");
    expect(normalizeBaseUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(() => normalizeBaseUrl("http://example.com")).toThrow(/https/);
  });

  it("rejects non-URLs and other schemes", () => {
    expect(() => normalizeBaseUrl("example.com")).toThrow(/full URL/);
    expect(() => normalizeBaseUrl("ftp://example.com")).toThrow(/https/);
  });
});

describe("originPattern", () => {
  it("drops the port, which match patterns don't support", () => {
    expect(originPattern("http://localhost:8787")).toBe("http://localhost/*");
  });
});
