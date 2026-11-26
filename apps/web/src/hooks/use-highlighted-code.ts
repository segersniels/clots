import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { loadHighlighter } from "@/lib/highlighter";

/** A highlighter for one language, or `null` for a language that is not listed. */
type Highlighter = Awaited<ReturnType<typeof loadHighlighter>>;

/** The highlighters that finished loading, by language, so every code block of a language shares one. */
const loadedHighlighters = new Map<string, Highlighter>();

export function useHighlightedCode(value: string, language: string) {
  // A trailing newline would render as an extra empty line.
  const code = value.endsWith("\n") ? value.slice(0, -1) : value;
  const subscribe = useCallback(
    (onLoaded: () => void) => {
      let cancelled = false;

      if (!loadedHighlighters.has(language)) {
        loadHighlighter(language)
          .then((next) => {
            // Two blocks can load one language at once. The first highlighter stays, so neither block highlights again.
            if (!loadedHighlighters.has(language)) {
              loadedHighlighters.set(language, next);
            }

            if (!cancelled) {
              onLoaded();
            }
          })
          .catch(() => {});
      }

      return () => {
        cancelled = true;
      };
    },
    [language],
  );
  const highlighter = useSyncExternalStore(
    subscribe,
    () => loadedHighlighters.get(language) ?? null,
  );

  /**
   * The complete lines, highlighted. While the code streams, only the new
   * lines are tokenized, starting from the grammar state of the last one.
   */
  const [done, setDone] = useState<{
    highlighter: typeof highlighter;
    text: string;
    lines: ReactNode[];
    state?: Parameters<NonNullable<typeof highlighter>["highlight"]>[1];
  }>({ highlighter: null, text: "", lines: [] });

  let next = done;

  if (next.highlighter !== highlighter || !code.startsWith(next.text)) {
    next = { highlighter, text: "", lines: [] };
  }

  const end = code.lastIndexOf("\n") + 1;

  if (highlighter && end > next.text.length) {
    const result = highlighter.highlight(code.slice(next.text.length, end - 1), next.state);

    next = {
      highlighter,
      text: code.slice(0, end),
      lines: [...next.lines, ...result.lines],
      state: result.state,
    };
  }

  if (next !== done) {
    setDone(next);
  }

  // The last line is still being written, so it is tokenized on every render.
  const tail = code.slice(end);

  return useMemo(() => {
    if (!highlighter) {
      return code.split("\n");
    }

    return [...next.lines, highlighter.highlight(tail, next.state).lines[0]];
  }, [code, highlighter, next, tail]);
}
