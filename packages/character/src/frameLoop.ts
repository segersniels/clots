/** One animated character on the page. The loop reads every layout first and writes after, so frames do not thrash layout. */
export interface Animated {
  measure(): void;
  draw(now: number): void;
}

/** The last known pointer position in the viewport. The eyes of each character follow it. */
export const pointer = { x: 0, y: 0, seen: false };

const animated = new Set<Animated>();
let frame = 0;
let reducedMotionQuery: MediaQueryList | undefined;

/** Checks whether the operator asked the system for less motion. */
export function prefersReducedMotion() {
  reducedMotionQuery ??= matchMedia("(prefers-reduced-motion: reduce)");

  return reducedMotionQuery.matches;
}

function trackPointer(event: PointerEvent) {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  pointer.seen = true;
}

function tick(now: number) {
  for (const item of animated) item.measure();

  for (const item of animated) item.draw(now);

  frame = animated.size > 0 ? requestAnimationFrame(tick) : 0;
}

/** Adds a character to the shared frame loop. The returned function removes it again. */
export function animate(item: Animated) {
  // All characters share one loop and one pointer listener, however many the page shows.
  if (animated.size === 0) addEventListener("pointermove", trackPointer, { passive: true });

  animated.add(item);
  if (frame === 0) frame = requestAnimationFrame(tick);

  return () => {
    animated.delete(item);
    if (animated.size === 0) removeEventListener("pointermove", trackPointer);
  };
}
