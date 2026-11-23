import { useSyncExternalStore } from "react";

/** Tells whether the window matches a media query, and updates when the window crosses it. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = matchMedia(query);
      list.addEventListener("change", onChange);

      return () => list.removeEventListener("change", onChange);
    },
    () => matchMedia(query).matches,
  );
}
