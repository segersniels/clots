import type { BotId, Message } from "@clots/contracts";

/** The storage key prefix of the last messages of each thread, which show at once after the app starts again. */
const THREAD_CACHE_KEY = "clots.thread.";

/** The messages that the cache keeps of one thread: the page that the thread shows first. */
const CACHED_MESSAGES = 50;

/** The most characters that the cache of one thread takes, so the threads do not fill the storage. */
const THREAD_CACHE_LIMIT = 200_000;

/** Reads the messages that the thread showed before the app closed. A missing cache or a blocked storage gives `null`. */
export function readCachedThread(botId: BotId): ReadonlyArray<Message> | null {
  try {
    const cached = localStorage.getItem(THREAD_CACHE_KEY + botId);

    return cached === null ? null : (JSON.parse(cached) as ReadonlyArray<Message>);
  } catch {
    return null;
  }
}

/** Keeps the last page of a thread for the next start. Long messages make it keep fewer. A full or blocked storage only loses the cache. */
export function saveCachedThread(botId: BotId, messages: ReadonlyArray<Message>) {
  let kept = messages.slice(-CACHED_MESSAGES);
  let text = JSON.stringify(kept);

  while (text.length > THREAD_CACHE_LIMIT && kept.length > 1) {
    kept = kept.slice(Math.ceil(kept.length / 2));
    text = JSON.stringify(kept);
  }

  try {
    localStorage.setItem(THREAD_CACHE_KEY + botId, text);
  } catch {
    // The thread loads from the server at the next start.
  }
}

/** Forgets the cached threads of the bots that no longer exist, such as a clone that deleted itself or a bot deleted on another device. */
export function forgetDeletedThreads(botIds: ReadonlyArray<BotId>) {
  const kept = new Set(botIds.map((botId) => THREAD_CACHE_KEY + botId));

  try {
    const stale = Object.keys(localStorage).filter(
      (key) => key.startsWith(THREAD_CACHE_KEY) && !kept.has(key),
    );

    for (const key of stale) {
      localStorage.removeItem(key);
    }
  } catch {
    // A blocked storage holds no cache.
  }
}
