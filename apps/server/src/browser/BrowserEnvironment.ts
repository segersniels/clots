import type { BrowserCookie } from "@clots/contracts";
import { Effect } from "effect";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { StoredBot } from "../bots/BotRepository.ts";

/** The directory that holds the `agent-browser` CLI, which clots installs as a dependency. */
const agentBrowserBin = join(import.meta.dir, "../../node_modules/.bin");

/** The Chrome that clots gives to a bot when no executable is set. agent-browser downloads its own only after `agent-browser install`. */
const systemBrowser = Bun.which("chromium") ?? Bun.which("google-chrome");

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

/** The user agent of every bot browser. The server reads the Chrome version once, when it starts. */
const userAgent = normalUserAgent(process.env.AGENT_BROWSER_EXECUTABLE_PATH ?? systemBrowser ?? undefined);

/**
 * Builds the variables that give a bot its own browser: one agent-browser session, one persistent
 * profile for logins, and one fixed stream port that the clots server can find.
 */
export const makeBrowserEnvironment = (bot: StoredBot): Record<string, string> => ({
  PATH: `${agentBrowserBin}:${process.env.PATH ?? ""}`,
  AGENT_BROWSER_SESSION: bot.id,
  AGENT_BROWSER_PROFILE: join(bot.workingDirectory, ".browser-profile"),
  AGENT_BROWSER_STREAM_PORT: String(bot.browserStreamPort),
  // A real 2x scale gives sharp retina frames. The frame caps default to the CSS page size, so they must allow 2x.
  AGENT_BROWSER_ARGS: "--force-device-scale-factor=2",
  AGENT_BROWSER_STREAM_MAX_WIDTH: "2560",
  AGENT_BROWSER_STREAM_MAX_HEIGHT: "1600",
  ...(process.env.AGENT_BROWSER_EXECUTABLE_PATH === undefined && systemBrowser !== null
    ? { AGENT_BROWSER_EXECUTABLE_PATH: systemBrowser }
    : {}),
  ...(userAgent === undefined ? {} : { AGENT_BROWSER_USER_AGENT: userAgent }),
});

/** Runs one agent-browser command in the bot's browser session and returns its exit code. */
const runAgentBrowser = (bot: StoredBot, args: ReadonlyArray<string>) =>
  Effect.promise(async () => {
    const running = Bun.spawn([join(agentBrowserBin, "agent-browser"), ...args], {
      env: { ...process.env, ...makeBrowserEnvironment(bot) },
      stdout: "ignore",
      stderr: "ignore",
    });

    return await running.exited;
  });

/**
 * Closes the bot's browser. That frees its stream port for the next bot and stops Chromium from
 * writing to the bot's profile. A browser that hangs does not block the caller for long.
 */
export const closeBrowser = (bot: StoredBot) =>
  runAgentBrowser(bot, ["close"]).pipe(Effect.timeout("15 seconds"), Effect.ignore);

/**
 * Loads the cookies of a site that the operator signed in to on their own machine into the bot's
 * browser, which starts if it is closed. Then it opens `url`, so the preview shows the bot signed in.
 */
export const importLogin = (bot: StoredBot, url: string, cookies: ReadonlyArray<BrowserCookie>) =>
  Effect.gen(function* () {
    // The state file holds session tokens, so only the owner can read it, and it goes away at once.
    const stateFile = join(bot.workingDirectory, `.sign-in-${crypto.randomUUID()}.json`);
    const state = { cookies: cookies.map((cookie) => ({ ...cookie, session: cookie.expires === -1 })), origins: [] };
    writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });

    const loaded = yield* runAgentBrowser(bot, ["state", "load", stateFile]).pipe(
      Effect.ensuring(Effect.sync(() => rmSync(stateFile, { force: true }))),
    );
    if (loaded !== 0) return yield* Effect.die(new Error("The bot's browser could not load the login."));

    yield* runAgentBrowser(bot, ["open", url]);
  }).pipe(Effect.timeout("60 seconds"), Effect.orDie);
