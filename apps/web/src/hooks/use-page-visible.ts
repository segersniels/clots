import { useSyncExternalStore } from "react";

/** Tells whether the page is on screen. A hidden window, a minimized app or a locked screen makes it `false`. */
export function usePageVisible() {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("visibilitychange", onChange);

      return () => document.removeEventListener("visibilitychange", onChange);
    },
    () => document.visibilityState === "visible",
  );
}
