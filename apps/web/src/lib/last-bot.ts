import type { BotId } from "@clots/contracts";

/** The storage key of the bot that was open last, so that the app opens it again at the next start. */
const LAST_BOT_KEY = "clots.lastBot";

/** Is `true` until the app handles its first page. Only that page may go back to the last bot. */
let starting = true;

/** Keeps the bot that is open, or forgets it with `null`. A blocked storage only loses the bot. */
export function saveLastBot(botId: BotId | null) {
  try {
    if (botId === null) {
      localStorage.removeItem(LAST_BOT_KEY);
    } else {
      localStorage.setItem(LAST_BOT_KEY, botId);
    }
  } catch {
    // The app opens the first bot next time.
  }
}

/**
 * Gives the bot that was open last, on the first page of the app only. A later visit home, such as
 * on a phone, gets `null` and stays there.
 */
export function takeStartupBot(): BotId | null {
  if (!starting) {
    return null;
  }

  starting = false;

  try {
    return localStorage.getItem(LAST_BOT_KEY) as BotId | null;
  } catch {
    return null;
  }
}
