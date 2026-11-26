import { useEffect } from "react";

/**
 * Runs an effect once when the component mounts, and its cleanup when it unmounts. It is the only
 * way to sync with a system outside React, such as a subscription, a timer or a DOM API. A
 * component that must sync again when a prop changes gets a `key`, so it mounts again.
 */
export function useMountEffect(effect: () => void | (() => void)) {
  // oxlint-disable-next-line react-hooks-js/exhaustive-deps -- The effect runs on mount only, by design.
  useEffect(effect, []);
}
