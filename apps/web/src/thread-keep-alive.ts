import type { BotId, ThreadLiveState } from "@clots/contracts";

import { client } from "./client.ts";
import { saveCachedThread } from "./thread-cache.ts";

/**
 * Keeps the thread of each working bot subscribed, also while another thread is open or the window
 * is hidden, so a thread is current when the operator opens it. A subscription is not a view, so
 * the bot still turns unread. A thread lets go when the bot is idle and its last messages are in.
 */
export const keepWorkingThreadsCurrent = () => {
  /** The release of each held thread, and its live state when the hold began. */
  const held = new Map<BotId, { release: () => void; liveBefore: ThreadLiveState }>();

  const update = () => {
    const bots = client.bots.get();

    for (const bot of bots) {
      if (bot.status === "idle" || held.has(bot.id)) {
        continue;
      }

      // The thread store changes on its own stream, so each change checks again whether the turn is over.
      const thread = client.thread(bot.id);
      const hold = { liveBefore: thread.get().live, release: () => {} };

      // A new subscription changes the thread at once, which runs this update again. The hold must exist by then, or each run subscribes again.
      held.set(bot.id, hold);
      hold.release = thread.subscribe(update);
    }

    for (const [botId, { release, liveBefore }] of held) {
      const bot = bots.find((candidate) => candidate.id === botId);
      const thread = client.thread(botId).get();

      /**
       * The bot list can say idle before the thread has its last messages. The idle live state comes after them.
       * A store that followed the thread before keeps its old live state, so only a new one counts.
       */
      const settled =
        bot === undefined ||
        (bot.status === "idle" && thread.live !== liveBefore && thread.live.status === "idle");

      if (!settled) {
        continue;
      }

      held.delete(botId);
      release();
      if (bot !== undefined) {
        saveCachedThread(botId, thread.messages);
      }
    }
  };

  client.bots.subscribe(update);
};
