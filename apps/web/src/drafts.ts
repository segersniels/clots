import { makeStore } from "@clots/client-runtime";
import type { BotId } from "@clots/contracts";
import { useSyncExternalStore } from "react";

/** The storage key prefix of the unsent text of each bot, so that a draft survives a reload. */
const DRAFT_KEY_PREFIX = "clots.draft.";

/** A message that the operator started for a bot and did not send yet. */
export interface Draft {
  readonly text: string;
  /** The files wait in the composer of this window only, because a file cannot go in storage. */
  readonly fileCount: number;
}

/** Reads the saved draft texts of all bots. A blocked storage gives no drafts. */
function readSavedDrafts(): ReadonlyMap<BotId, Draft> {
  const saved = new Map<BotId, Draft>();

  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(DRAFT_KEY_PREFIX)) {
        saved.set(key.slice(DRAFT_KEY_PREFIX.length) as BotId, {
          text: localStorage.getItem(key) ?? "",
          fileCount: 0,
        });
      }
    }
  } catch {
    // The drafts of this window still work. They only do not survive a reload.
  }

  return saved;
}

/** The unsent drafts of all bots. The sidebar shows them, and the composer starts from them. */
export const drafts = makeStore(readSavedDrafts(), (set) => {
  /** A composer in another window saves its draft there. The storage event brings it here. */
  const takeOtherWindow = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(DRAFT_KEY_PREFIX)) {
      set(readSavedDrafts);
    }
  };

  set(readSavedDrafts);
  addEventListener("storage", takeOtherWindow);

  return () => removeEventListener("storage", takeOtherWindow);
});

/** Tells whether a draft has anything to send. */
export const hasContent = (draft: Draft | undefined): draft is Draft =>
  draft !== undefined && (draft.text.trim() !== "" || draft.fileCount > 0);

/** Keeps the draft of a bot, or forgets it when it is empty. A blocked storage only loses the text at a reload. */
export function saveDraft(botId: BotId, draft: Draft) {
  const current = drafts.get().get(botId);

  if (current?.text === draft.text && current.fileCount === draft.fileCount) {
    return;
  }

  drafts.set((all) => {
    const next = new Map(all);
    if (hasContent(draft)) {
      next.set(botId, draft);
    } else {
      next.delete(botId);
    }

    return next;
  });

  try {
    if (draft.text === "") {
      localStorage.removeItem(DRAFT_KEY_PREFIX + botId);
    } else {
      localStorage.setItem(DRAFT_KEY_PREFIX + botId, draft.text);
    }
  } catch {
    // The draft still lives in this window until a reload.
  }
}

/** Reads the draft of one bot. Only a change to that draft renders the caller again. */
export const useDraft = (botId: BotId) =>
  useSyncExternalStore(drafts.subscribe, () => drafts.get().get(botId));
