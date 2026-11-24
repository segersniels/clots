import { Effect } from "effect";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import type { StoredBot } from "../bots/BotRepository.ts";
import { runtimePaths } from "../paths.ts";
import { closeChrome, realAgentBrowser } from "./BotChrome.ts";

/** The directory that holds the real `agent-browser` CLI. */
const agentBrowserBin = dirname(runtimePaths.agentBrowser);

/** The directory of the `agent-browser` wrapper that starts the bot's own Chrome before each command. */
const clotsBin = runtimePaths.wrapperDirectory;

/** The distance from a bot's stream port to the DevTools port of its Chrome. */
const DEVTOOLS_PORT_OFFSET = 1000;

/** The app bundles where macOS keeps Chrome and Chromium. Neither puts a command on PATH. */
const MAC_BROWSERS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

/** The Chrome that clots gives to a bot when no executable is set. agent-browser downloads its own only after `agent-browser install`. */
const systemBrowser = Bun.which("chromium") ?? Bun.which("google-chrome") ?? MAC_BROWSERS.find((path) => existsSync(path));

/** The platform part of a normal Chrome user agent on each host system. */
const PLATFORM_TOKENS: Partial<Record<NodeJS.Platform, string>> = {
  linux: "X11; Linux x86_64",
  darwin: "Macintosh; Intel Mac OS X 10_15_7",
};

/**
 * Builds the user agent of a normal Chrome of the same version as `executable`. Headless Chrome
 * calls itself HeadlessChrome, and sites such as x.com refuse it. Returns `undefined` when the
 * version or the platform is unknown, so the browser keeps its own user agent.
 */
const normalUserAgent = (executable: string | undefined) => {
  const platform = PLATFORM_TOKENS[process.platform];
  if (executable === undefined || platform === undefined) return undefined;

  const version = Bun.spawnSync([executable, "--version"], { stderr: "ignore" }).stdout.toString();
  const major = /(\d+)\.\d+\.\d+/.exec(version)?.[1];
  if (major === undefined) return undefined;

  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
};

/** The Chrome that clots starts for each bot. Without one, agent-browser launches its own Chrome. */
const executable = process.env.AGENT_BROWSER_EXECUTABLE_PATH ?? systemBrowser ?? undefined;

/** The user agent of every bot browser. The server reads the Chrome version once, when it starts. */
const userAgent = normalUserAgent(executable);

/** The DevTools port of the bot's own Chrome. */
const devToolsPort = (bot: StoredBot) => bot.browserStreamPort + DEVTOOLS_PORT_OFFSET;

/**
 * Builds the variables that give a bot its own browser: one agent-browser session, one persistent
 * profile for logins, and one fixed stream port that the clots server can find.
 */
export const makeBrowserEnvironment = (bot: StoredBot): Record<string, string> => {
  const profile = join(bot.workingDirectory, ".browser-profile");
  const shared = {
    AGENT_BROWSER_SESSION: bot.id,
    AGENT_BROWSER_STREAM_PORT: String(bot.browserStreamPort),
    // The frame caps default to the CSS page size, so they must allow the 2x scale of the browser.
    AGENT_BROWSER_STREAM_MAX_WIDTH: "2560",
    AGENT_BROWSER_STREAM_MAX_HEIGHT: "1600",
  };

  // Without a Chrome on the host, agent-browser launches its own, which sites can tell is automated.
  if (executable === undefined) {
    return {
      ...shared,
      PATH: `${agentBrowserBin}:${process.env.PATH ?? ""}`,
      AGENT_BROWSER_PROFILE: profile,
      AGENT_BROWSER_ARGS: "--force-device-scale-factor=2",
    };
  }

  // The wrapper comes first in PATH, so each agent-browser command starts the bot's Chrome and attaches to it.
  return {
    ...shared,
    PATH: `${clotsBin}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    AGENT_BROWSER_CDP: String(devToolsPort(bot)),
    CLOTS_BROWSER_PORT: String(devToolsPort(bot)),
    CLOTS_BROWSER_EXECUTABLE: executable,
    CLOTS_BROWSER_PROFILE: profile,
    ...(userAgent === undefined ? {} : { CLOTS_BROWSER_USER_AGENT: userAgent }),
  };
};

/**
 * Closes the bot's browser. That frees its stream port for the next bot and stops Chromium from
 * writing to the bot's profile. A browser that hangs does not block the caller for long.
 */
export const closeBrowser = (bot: StoredBot) =>
  Effect.promise(async () => {
    // agent-browser only lets go of a Chrome that it did not launch, so clots closes the bot's Chrome itself.
    const detaching = Bun.spawn([realAgentBrowser, "close"], {
      env: { ...process.env, ...makeBrowserEnvironment(bot) },
      stdout: "ignore",
      stderr: "ignore",
    });
    await detaching.exited;
    await closeChrome(devToolsPort(bot));
  }).pipe(Effect.timeout("15 seconds"), Effect.ignore);
