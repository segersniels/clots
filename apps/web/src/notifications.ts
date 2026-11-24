import type { BotId, DesktopAppBridge } from "@clots/contracts";

import { client } from "./client.ts";

declare global {
  interface Window {
    /** The calls of the Clots app. A browser has none, so it shows no notifications. */
    readonly clotsApp?: DesktopAppBridge;
  }
}

/**
 * Shows a system notification when a bot finishes a turn while the Clots window is in the
 * background, as a chat app does for a new message. A click opens that bot. Only the Clots app
 * does this: a browser tab stays quiet.
 */
export const startBotNotifications = (openBot: (botId: BotId) => void) => {
  const app = window.clotsApp;

  if (app === undefined) return;

  // The first list is the state at start, not a change, so it notifies nobody.
  let working: Set<BotId> | undefined;

  client.bots.subscribe(() => {
    const bots = client.bots.get();
    const before = working;
    working = new Set(bots.filter((bot) => bot.status === "working").map((bot) => bot.id));

    // The operator sees the change in the window, so only a window in the background notifies.
    const inBackground = !document.hasFocus();

    if (before === undefined || !inBackground) return;

    for (const bot of bots) {
      if (!before.has(bot.id) || bot.status !== "idle") continue;

      // The tag makes a new notification of the same bot replace its last one.
      const notification = new Notification(bot.name, { body: bot.statusLine, tag: bot.id });
      notification.addEventListener("click", () => {
        void app.revealWindow();
        openBot(bot.id);
      });
    }
  });
};
