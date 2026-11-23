/** A value that views can read and observe. The shape fits React's `useSyncExternalStore`. */
export interface Store<T> {
  get(): T;
  subscribe(listener: () => void): () => void;
}

/**
 * Makes a store that runs `start` while at least one listener observes it. The value stays when the
 * last listener leaves, so a view that opens again shows the last state at once.
 */
export const makeStore = <T>(
  initial: T,
  start?: (set: (update: (current: T) => T) => void) => () => void,
): Store<T> & { set(update: (current: T) => T): void } => {
  let value = initial;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();

  const set = (update: (current: T) => T) => {
    value = update(value);
    for (const listener of listeners) listener();
  };

  return {
    get: () => value,
    set,
    subscribe: (listener) => {
      listeners.add(listener);
      if (listeners.size === 1) stop = start?.(set);

      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;

        stop?.();
        stop = undefined;
      };
    },
  };
};
