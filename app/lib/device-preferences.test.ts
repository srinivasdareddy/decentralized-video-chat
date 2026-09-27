import { describe, expect, it } from "vitest";
import { findDevice, parseDevicePreferences } from "./device-preferences.ts";

const devices = [
  { kind: "videoinput", deviceId: "cam-a", label: "Built-in camera" },
  { kind: "videoinput", deviceId: "cam-b", label: "USB camera" },
  { kind: "audioinput", deviceId: "mic-a", label: "USB camera" },
  { kind: "audiooutput", deviceId: "", label: "" },
] as const;

describe("findDevice", () => {
  it("finds the chosen device by id", () => {
    expect(findDevice(devices, "videoinput", { deviceId: "cam-b", label: "" })).toBe("cam-b");
  });

  it("finds it by name when its id has changed", () => {
    expect(findDevice(devices, "videoinput", { deviceId: "old-id", label: "USB camera" })).toBe(
      "cam-b",
    );
  });

  it("only matches devices of the same kind", () => {
    expect(findDevice(devices, "audioinput", { deviceId: "cam-b", label: "Built-in camera" })).toBe(
      undefined,
    );
    expect(findDevice(devices, "audioinput", { deviceId: "old-id", label: "USB camera" })).toBe(
      "mic-a",
    );
  });

  it("gives up when the device is gone, or nothing was chosen", () => {
    expect(findDevice(devices, "videoinput", { deviceId: "gone", label: "Gone" })).toBe(undefined);
    expect(findDevice(devices, "videoinput", { deviceId: "gone", label: "" })).toBe(undefined);
    expect(findDevice(devices, "audiooutput", { deviceId: "", label: "" })).toBe(undefined);
    expect(findDevice(devices, "videoinput", undefined)).toBe(undefined);
  });
});

describe("parseDevicePreferences", () => {
  it("reads stored choices", () => {
    const camera = { deviceId: "cam-b", label: "USB camera" };
    expect(parseDevicePreferences(JSON.stringify({ camera, extra: 1 }))).toEqual({ camera });
  });

  it.each([null, "", "not json", "null", "42", '{"camera":"cam-b"}', '{"camera":{"label":"x"}}'])(
    "ignores malformed data: %j",
    (stored) => {
      expect(parseDevicePreferences(stored)).toEqual({});
    },
  );
});
