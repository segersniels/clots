import { join } from "node:path";

import type { StoredBot } from "../bots/BotRepository.ts";

/** The directory that holds the `agent-browser` CLI, which clots installs as a dependency. */
const agentBrowserBin = join(import.meta.dir, "../../node_modules/.bin");

/**
 * Builds the variables that give a bot its own browser: one agent-browser session, one persistent
 * profile for logins, and one fixed stream port that the clots server can find.
 */
export const makeBrowserEnvironment = (bot: StoredBot): Record<string, string> => {
  const systemBrowser = Bun.which("chromium") ?? Bun.which("google-chrome");

  return {
    PATH: `${agentBrowserBin}:${process.env.PATH ?? ""}`,
    AGENT_BROWSER_SESSION: bot.id,
    AGENT_BROWSER_PROFILE: join(bot.workingDirectory, ".browser-profile"),
    AGENT_BROWSER_STREAM_PORT: String(bot.browserStreamPort),
    // agent-browser downloads its own Chrome only after `agent-browser install`.
    ...(process.env.AGENT_BROWSER_EXECUTABLE_PATH === undefined && systemBrowser !== null
      ? { AGENT_BROWSER_EXECUTABLE_PATH: systemBrowser }
      : {}),
  };
};
