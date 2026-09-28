/** A camera, microphone, or speaker the person chose. */
export interface DeviceChoice {
  deviceId: string;
  /**
   * Device ids can change between visits (browsers rotate them in private
   * windows, for instance), so the name is kept to find the device again.
   */
  label: string;
}

export interface DevicePreferences {
  camera?: DeviceChoice;
  microphone?: DeviceChoice;
  speaker?: DeviceChoice;
}

const STORAGE_KEY = "zipcall.devices";
const KINDS = ["camera", "microphone", "speaker"] as const;

/** The devices chosen in earlier calls. Storage can be unavailable (private windows), so this never throws. */
export function loadDevicePreferences(): DevicePreferences {
  try {
    return parseDevicePreferences(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

export function saveDevicePreference(kind: keyof DevicePreferences, choice: DeviceChoice): void {
  try {
    const { deviceId, label } = choice;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...loadDevicePreferences(), [kind]: { deviceId, label } }),
    );
  } catch {
    // Not remembering the choice is fine.
  }
}

/** Reads stored preferences, ignoring anything malformed. */
export function parseDevicePreferences(stored: string | null): DevicePreferences {
  let value: unknown;
  try {
    value = JSON.parse(stored ?? "{}");
  } catch {
    return {};
  }
  if (typeof value !== "object" || value === null) return {};
  const preferences: DevicePreferences = {};
  for (const kind of KINDS) {
    const choice = (value as Record<string, unknown>)[kind];
    if (isDeviceChoice(choice)) {
      preferences[kind] = { deviceId: choice.deviceId, label: choice.label };
    }
  }
  return preferences;
}

/** The id the chosen device has now, found by id or else by name; undefined if it's gone. */
export function findDevice(
  devices: readonly Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[],
  kind: MediaDeviceKind,
  choice: DeviceChoice | undefined,
): string | undefined {
  if (choice === undefined) return undefined;
  const candidates = devices.filter((device) => device.kind === kind && device.deviceId !== "");
  const match =
    candidates.find((device) => device.deviceId === choice.deviceId) ??
    candidates.find((device) => choice.label !== "" && device.label === choice.label);
  return match?.deviceId;
}

function isDeviceChoice(value: unknown): value is DeviceChoice {
  if (typeof value !== "object" || value === null) return false;
  const { deviceId, label } = value as Record<string, unknown>;
  return typeof deviceId === "string" && deviceId !== "" && typeof label === "string";
}
