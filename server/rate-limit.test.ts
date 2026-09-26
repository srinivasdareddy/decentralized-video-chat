import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit.ts";

function setup() {
  let now = 0;
  const limiter = new RateLimiter({ capacity: 3, perSecond: 1, now: () => now });
  return { limiter, advance: (ms: number) => (now += ms) };
}

describe("RateLimiter", () => {
  it("allows a burst up to the capacity", () => {
    const { limiter } = setup();
    expect([1, 2, 3, 4].map(() => limiter.take("a"))).toEqual([true, true, true, false]);
  });

  it("refills over time", () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 3; i++) limiter.take("a");
    expect(limiter.take("a")).toBe(false);
    advance(1000);
    expect(limiter.take("a")).toBe(true);
    expect(limiter.take("a")).toBe(false);
  });

  it("keeps keys separate", () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i++) limiter.take("a");
    expect(limiter.take("b")).toBe(true);
  });

  it("forgets keys that have fully recovered", () => {
    const { limiter, advance } = setup();
    limiter.take("a");
    limiter.take("b");
    limiter.take("b");
    advance(1000);
    limiter.prune();
    expect(limiter.size).toBe(1);
    advance(1000);
    limiter.prune();
    expect(limiter.size).toBe(0);
  });
});
