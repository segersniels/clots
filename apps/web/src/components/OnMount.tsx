import { useMountEffect } from "@/hooks/use-mount-effect";

/** Runs a task when it mounts, and its cleanup when it unmounts. The caller renders or keys it to run the task again. */
export function OnMount({ run }: { run: () => void | (() => void) }) {
  useMountEffect(run);

  return null;
}

/** Calls `onEnd` once `ms` have passed since it mounted, unless it unmounts first. */
export function Timeout({ ms, onEnd }: { ms: number; onEnd: () => void }) {
  useMountEffect(() => {
    const timer = setTimeout(onEnd, ms);

    return () => clearTimeout(timer);
  });

  return null;
}
