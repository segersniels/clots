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
  /** Tells when a resting character moves again by itself, such as for a blink. */
  nextMove(): number;
}

/** How the window shows the characters. A hidden page counts as not focused, and nothing on it moves. */
type WindowState = "focused" | "unfocused" | "hidden";

/** The time between two frames, so the characters draw at 60 fps at most, also on a 120 Hz screen. */
const FOCUSED_FRAME_MS = 1000 / 60;

/** The time between two frames while the window has no focus, so moving characters run at about 30 fps. */
const UNFOCUSED_FRAME_MS = 1000 / 30;

/** How long before a frame is due the loop asks the browser for it, so a late timer does not miss the screen refresh. */
const FRAME_LEAD_MS = 5;

const animated = new Set<Animated>();
let frame = 0;
let frameTimer: ReturnType<typeof setTimeout> | undefined;
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

/** Reads the shortest time between two frames for how the window shows now. */
function frameMs() {
  return windowState === "focused" ? FOCUSED_FRAME_MS : UNFOCUSED_FRAME_MS;
}

/**
 * Asks for a frame at a given time. A timer waits until shortly before that time, so the page
 * does no work on the screen refreshes in between.
 */
function schedule(due: number) {
  clearTimeout(frameTimer);
  frameTimer = undefined;
  cancelAnimationFrame(frame);
  frame = 0;

  const wait = due - performance.now() - FRAME_LEAD_MS;
  if (wait <= 0) {
    frame = requestAnimationFrame(tick);

    return;
  }

  frameTimer = setTimeout(() => {
    frameTimer = undefined;
    frame = requestAnimationFrame(tick);
  }, wait);
}

/**
 * Starts the loop when it is stopped and the page shows. A character calls it when it starts to
 * move, such as a bot that starts to work or a character that gets a new shape.
 */
export function wake() {
  if (frame === 0 && windowState !== "hidden") {
    schedule(lastDraw + frameMs());
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
    clearTimeout(frameTimer);
    frameTimer = undefined;
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
 * Draws one frame and plans the next one. Resting characters cost nothing, so the loop stops when
 * no character moves, and starts again for the next blink.
 */
function tick(now: number) {
  const focused = windowState === "focused";
  let moving = false;
  frame = 0;
  lastDraw = now;

  for (const item of animated) {
    // Without focus, a resting character keeps its pose until the window gets focus back.
    if (focused || item.moves()) {
      item.draw(now, focused);
    }

    moving ||= item.moves();
  }

  if (moving) {
    schedule(now + frameMs());

    return;
  }

  // Without focus, no character blinks, so the loop stays stopped until a character wakes it.
  if (!focused) {
    return;
  }

  let nextMove = Infinity;
  for (const item of animated) {
    nextMove = Math.min(nextMove, item.nextMove());
  }

  if (nextMove < Infinity) {
    schedule(nextMove);
  }
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
