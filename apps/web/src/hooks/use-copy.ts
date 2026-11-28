import { useState } from "react";

/** How long a copy button shows its check mark after a copy. */
const COPIED_MS = 1500;

/** Copies text to the clipboard and tells for a moment that it did, so a copy button can show a check mark. */
export function useCopy() {
  const [copied, setCopied] = useState(false);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };

  return { copied, copy };
}
