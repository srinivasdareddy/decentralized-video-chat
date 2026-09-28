import { useEffect, useState } from "react";

export interface MediaDevices {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

const NONE: MediaDevices = { cameras: [], microphones: [], speakers: [] };

/** The available cameras, microphones, and speakers, kept up to date while `active`. */
export function useMediaDevices(active: boolean): MediaDevices {
  const [devices, setDevices] = useState<MediaDevices>(NONE);

  useEffect(() => {
    if (!active || !navigator.mediaDevices?.enumerateDevices) return;
    let current = true;
    const refresh = () => {
      navigator.mediaDevices.enumerateDevices().then(
        (list) => {
          if (!current) return;
          // Some browsers list a device twice under the ids "default" and
          // "communications"; show each real device once.
          const byKind = (kind: MediaDeviceKind) =>
            list.filter(
              (device) =>
                device.kind === kind &&
                device.deviceId !== "" &&
                device.deviceId !== "communications",
            );
          setDevices({
            cameras: byKind("videoinput"),
            microphones: byKind("audioinput"),
            speakers: byKind("audiooutput"),
          });
        },
        () => {},
      );
    };
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      current = false;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, [active]);

  return devices;
}
