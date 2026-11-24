/** Reads a pane width in pixels that the operator chose. A missing value or a blocked storage gives `fallback`. */
export function readPaneWidth(key: string, fallback: number) {
  try {
    return Number(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

/** Keeps a pane width in pixels for the next visit. A blocked storage only loses the width. */
export function savePaneWidth(key: string, width: number) {
  try {
    localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // The pane opens at its default width next time.
  }
}

/** Reads whether the operator left a pane open. A missing value or a blocked storage gives `false`. */
export function readPaneOpen(key: string) {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

/** Keeps whether a pane is open for the next visit. A blocked storage only loses the choice. */
export function savePaneOpen(key: string, open: boolean) {
  try {
    localStorage.setItem(key, String(open));
  } catch {
    // The pane starts closed next time.
  }
}
