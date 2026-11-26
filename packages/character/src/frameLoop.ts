/** One animated character on the page. The loop draws every character on each frame while the window has focus. */
export interface Animated {
  draw(now: number): void;
  /** Holds the motion while the window has no focus. */
  pause(): void;
  /** Takes up the motion again when the window gets focus back. */
  resume(): void;
}

const animated = new Set<Animated>();
let frame = 0;
let focused = false;
let reducedMotionQuery: MediaQueryList | undefined;

/** Checks whether the operator asked the system for less motion. */
export function prefersReducedMotion() {
  reducedMotionQuery ??= matchMedia("(prefers-reduced-motion: reduce)");

  return reducedMotionQuery.matches;
}

/** Checks whether the window has focus. A hidden page counts as not focused. */
function windowFocused() {
  return document.visibilityState === "visible" && document.hasFocus();
}

/** Stops the loop while the window has no focus, so idle characters cost no CPU, and starts it again on focus. */
function followFocus() {
  const nowFocused = windowFocused();

  if (nowFocused === focused) {
    return;
  }

  focused = nowFocused;

  if (!focused) {
    cancelAnimationFrame(frame);
    frame = 0;

    for (const item of animated) {
      item.pause();
    }

    return;
  }

  for (const item of animated) {
    item.resume();
  }

  frame = requestAnimationFrame(tick);
}

function tick(now: number) {
  for (const item of animated) {
    item.draw(now);
  }

  frame = animated.size > 0 ? requestAnimationFrame(tick) : 0;
}

/** Adds a character to the shared frame loop. The returned function removes it again. */
export function animate(item: Animated) {
  // All characters share one loop and one set of focus listeners, however many the page shows.
  if (animated.size === 0) {
    addEventListener("focus", followFocus);
    addEventListener("blur", followFocus);
    document.addEventListener("visibilitychange", followFocus);
    focused = windowFocused();
  }

  animated.add(item);
  if (frame === 0 && focused) {
    frame = requestAnimationFrame(tick);
  }

  return () => {
    animated.delete(item);
    if (animated.size === 0) {
      removeEventListener("focus", followFocus);
      removeEventListener("blur", followFocus);
      document.removeEventListener("visibilitychange", followFocus);
    }
  };
}
