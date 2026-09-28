import { useSyncExternalStore } from "react";

const subscribeToNothing = () => () => {};

/**
 * A value that only exists in the browser, such as something from the URL
 * or a random suggestion. Pre-rendering and hydration see `serverValue`; the
 * browser then renders with `getValue()`. `getValue` must return the same
 * value each time it's called until it actually changes.
 */
export function useClientValue<T>(getValue: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribeToNothing, getValue, () => serverValue);
}
