import { useEffect } from "react";

/**
 * Keeps the screen on while `enabled`, where the browser supports it.
 * Browsers drop the lock when the tab is hidden, so it's re-requested when
 * the tab becomes visible again.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;
    let active = true;
    let sentinel: WakeLockSentinel | null = null;

    const request = () => {
      if (document.visibilityState !== "visible") return;
      navigator.wakeLock.request("screen").then(
        (lock) => {
          if (active) sentinel = lock;
          else void lock.release();
        },
        () => {
          // Refused (e.g. battery saver); the call works without it.
        },
      );
    };
    const onVisibilityChange = () => {
      if (sentinel === null || sentinel.released) request();
    };

    request();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      void sentinel?.release();
    };
  }, [enabled]);
}
