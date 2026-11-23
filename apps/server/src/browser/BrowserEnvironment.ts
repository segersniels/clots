import { Effect } from "effect";
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
    // A real 2x scale gives sharp retina frames. The frame caps default to the CSS page size, so they must allow 2x.
    AGENT_BROWSER_ARGS: "--force-device-scale-factor=2",
    AGENT_BROWSER_STREAM_MAX_WIDTH: "2560",
    AGENT_BROWSER_STREAM_MAX_HEIGHT: "1600",
    // agent-browser downloads its own Chrome only after `agent-browser install`.
    ...(process.env.AGENT_BROWSER_EXECUTABLE_PATH === undefined && systemBrowser !== null
      ? { AGENT_BROWSER_EXECUTABLE_PATH: systemBrowser }
      : {}),
  };
};

/**
 * Closes the bot's browser. That frees its stream port for the next bot and stops Chromium from
 * writing to the bot's profile. A browser that hangs does not block the caller for long.
 */
export const closeBrowser = (bot: StoredBot) =>
  Effect.promise(async () => {
    const closing = Bun.spawn([join(agentBrowserBin, "agent-browser"), "close"], {
      env: { ...process.env, ...makeBrowserEnvironment(bot) },
      stdout: "ignore",
      stderr: "ignore",
    });
    await closing.exited;
  }).pipe(Effect.timeout("15 seconds"), Effect.ignore);
