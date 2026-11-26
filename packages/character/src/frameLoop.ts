/** One animated character on the page. */
export interface Animated {
  /** Draws one frame. Without focus, an idle character does not breathe or blink. */
  draw(now: number, focused: boolean): void;
  /** Checks whether the character still moves: it works, waits, or has not reached its resting pose. */
  moves(): boolean;
  /** Holds the idle breath while the window has no focus. */
  pause(): void;
  /** Takes up the motion again when the window gets focus back or the page shows again. */
  resume(): void;
}

/** How the window shows the characters. A hidden page counts as not focused, and nothing on it moves. */
type WindowState = "focused" | "unfocused" | "hidden";

/** The time between two frames while the window has no focus, so moving characters run at about 30 fps. */
const UNFOCUSED_FRAME_MS = 1000 / 30;

/** How early a frame may arrive and still count, so a 60 Hz screen draws on every second frame. */
const FRAME_MARGIN_MS = 2;

const animated = new Set<Animated>();
let frame = 0;
let lastDraw = -Infinity;
let windowState: WindowState = "hidden";
let reducedMotionQuery: MediaQueryList | undefined;

/** Checks whether the operator asked the system for less motion. */
export function prefersReducedMotion() {
  reducedMotionQuery ??= matchMedia("(prefers-reduced-motion: reduce)");

  return reducedMotionQuery.matches;
}

/** Reads how the window shows the characters now. */
function readWindowState(): WindowState {
  if (document.visibilityState !== "visible") {
    return "hidden";
  }

  return document.hasFocus() ? "focused" : "unfocused";
}

/**
 * Starts the loop when it is stopped and the page shows. A character calls it when it starts to
 * move, such as a bot that starts to work while the window has no focus.
 */
export function wake() {
  if (frame === 0 && windowState !== "hidden") {
    frame = requestAnimationFrame(tick);
  }
}

/** Pauses the idle breaths when the window loses focus, stops everything on a hidden page, and takes up the motion again on focus. */
function followWindow() {
  const previous = windowState;
  windowState = readWindowState();

  if (windowState === previous) {
    return;
  }

  if (previous === "focused") {
    for (const item of animated) {
      item.pause();
    }
  }

  if (windowState === "hidden") {
    cancelAnimationFrame(frame);
    frame = 0;

    return;
  }

  // Changes that arrived while the characters did not draw show at once and do not replay.
  if (previous === "hidden" || windowState === "focused") {
    for (const item of animated) {
      item.resume();
    }
  }

  wake();
}

/**
 * Draws the characters that move at about 30 fps while the window has no focus. Idle characters
 * cost nothing, so the loop stops when no character moves.
 */
function tickUnfocused(now: number) {
  let moving = false;

  for (const item of animated) {
    moving ||= item.moves();
  }

  if (!moving) {
    frame = 0;

    return;
  }

  frame = requestAnimationFrame(tick);

  // A time limit, not a frame count, gives the same rate on a 60 Hz and a 120 Hz screen.
  if (now - lastDraw < UNFOCUSED_FRAME_MS - FRAME_MARGIN_MS) {
    return;
  }

  lastDraw = now;

  for (const item of animated) {
    if (item.moves()) {
      item.draw(now, false);
    }
  }
}

function tick(now: number) {
  if (windowState === "unfocused") {
    tickUnfocused(now);

    return;
  }

  for (const item of animated) {
    item.draw(now, true);
  }

  frame = animated.size > 0 ? requestAnimationFrame(tick) : 0;
}

/** Adds a character to the shared frame loop. The returned function removes it again. */
export function animate(item: Animated) {
  // All characters share one loop and one set of window listeners, however many the page shows.
  if (animated.size === 0) {
    addEventListener("focus", followWindow);
    addEventListener("blur", followWindow);
    document.addEventListener("visibilitychange", followWindow);
    windowState = readWindowState();
  }

  animated.add(item);
  wake();

  return () => {
    animated.delete(item);
    if (animated.size === 0) {
      removeEventListener("focus", followWindow);
      removeEventListener("blur", followWindow);
      document.removeEventListener("visibilitychange", followWindow);
    }
  };
}
