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
