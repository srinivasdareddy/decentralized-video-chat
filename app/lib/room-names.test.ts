import { describe, expect, it } from "vitest";
import { randomRoomName } from "./room-names.ts";

describe("randomRoomName", () => {
  it("reads as two words and a short code", () => {
    expect(randomRoomName()).toMatch(/^[a-z]+-[a-z]+-[a-hj-km-np-z2-9]{4}$/);
  });

  it("doesn't repeat itself", () => {
    const names = new Set(Array.from({ length: 1000 }, randomRoomName));
    expect(names.size).toBe(1000);
  });
});
