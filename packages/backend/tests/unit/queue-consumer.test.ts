import { describe, it, expect } from "vitest";
import { calculateExponentialBackoff } from "../../src/queue-consumer";

describe("calculateExponentialBackoff", () => {
  it("returns base delay for first attempt", () => {
    expect(calculateExponentialBackoff(1, 30)).toBe(30);
  });

  it("doubles delay for each attempt", () => {
    expect(calculateExponentialBackoff(2, 30)).toBe(60);
    expect(calculateExponentialBackoff(3, 30)).toBe(120);
    expect(calculateExponentialBackoff(4, 30)).toBe(240);
    expect(calculateExponentialBackoff(5, 30)).toBe(480);
  });

  it("caps at MAX_DELAY_SECONDS (3600)", () => {
    expect(calculateExponentialBackoff(10, 30)).toBe(3600);
    expect(calculateExponentialBackoff(20, 30)).toBe(3600);
  });
});
