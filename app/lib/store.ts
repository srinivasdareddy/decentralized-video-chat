import { useCallback, useSyncExternalStore } from "react";

/** A minimal observable state container that React can subscribe to. */
export class Store<T extends object> {
  #state: T;
  readonly #listeners = new Set<() => void>();

  constructor(initial: T) {
    this.#state = initial;
  }

  get = (): T => this.#state;

  set = (patch: Partial<T>): void => {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };
}

/**
 * Reads a store's state and re-renders when it changes. Uses `fallback`
 * (which must be a stable value) until the store exists.
 */
export function useStore<T extends object>(store: Store<T> | null, fallback: T): T {
  const subscribe = useCallback(
    (listener: () => void) => store?.subscribe(listener) ?? (() => {}),
    [store],
  );
  return useSyncExternalStore(
    subscribe,
    () => store?.get() ?? fallback,
    () => fallback,
  );
}
