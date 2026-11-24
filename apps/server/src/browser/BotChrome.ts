import { spawn } from "node:child_process";
import { join } from "node:path";

import { runtimePaths } from "../paths.ts";

/** The real `agent-browser` CLI, from the dependencies or the installation. */
export const realAgentBrowser = runtimePaths.agentBrowser;

/** The agent-browser commands that do not use the page, so they do not start a Chrome. */
const COMMANDS_WITHOUT_PAGE = new Set(["close", "session", "skills", "install", "doctor", "help", "--help", "-h", "--version"]);

/** The Chrome that clots runs for one bot. */
export interface BotChrome {
  readonly executable: string;
  /** The DevTools port on the loopback address. agent-browser attaches through it. */
  readonly port: number;
  /** The Chrome user data directory, which keeps the bot's logins. */
  readonly profile: string;
  readonly userAgent: string | undefined;
}

/** Tells whether a Chrome answers on a DevTools port. */
const isRunning = async (port: number) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
  } catch {
    return false;
  }
};

/**
 * Starts the bot's Chrome when it does not run yet. It runs headless, because the server has no
 * screen, and clots starts it without the automation switch that agent-browser sets, so sites see a
 * normal browser. It runs apart from the server, so a server restart keeps the bot's open pages.
 */
export const ensureChrome = async ({ executable, port, profile, userAgent }: BotChrome) => {
  if (await isRunning(port)) return;

  const chrome = spawn(
    executable,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      // Cookies stay in the bot's profile and never reach the operator's keyring, which a server may not have.
      "--password-store=basic",
      // A real 2x scale gives sharp retina frames in the preview.
      "--force-device-scale-factor=2",
      "--window-size=1280,800",
      ...(userAgent === undefined ? [] : [`--user-agent=${userAgent}`]),
      "about:blank",
    ],
    {
      detached: true,
      stdio: "ignore",
      // Some distributions start Chromium through a launcher that adds the operator's own flags and extensions from this directory.
      env: { ...process.env, XDG_CONFIG_HOME: join(profile, "launcher-config") },
    },
  );
  chrome.unref();

  for (let attempt = 0; attempt < 50; attempt++) {
    if (await isRunning(port)) return;

    await Bun.sleep(200);
  }

  throw new Error(`The bot's Chrome did not start on port ${port}.`);
};

/** Closes the bot's Chrome, if it runs. */
export const closeChrome = async (port: number) => {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`)
    .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>)
    .catch(() => undefined);

  if (version === undefined) return;

  await new Promise<void>((resolve) => {
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    socket.onclose = () => resolve();
    socket.onerror = () => resolve();
  });
};

/**
 * Runs an agent-browser command for the bot whose Chrome the environment names. It starts that
 * Chrome first, so the real agent-browser can attach to it. Returns the command's exit code.
 */
export const runAgentBrowserCommand = async (args: ReadonlyArray<string>) => {
  const port = Number(process.env.CLOTS_BROWSER_PORT);
  const executable = process.env.CLOTS_BROWSER_EXECUTABLE;
  const profile = process.env.CLOTS_BROWSER_PROFILE;

  if (Number.isInteger(port) && executable !== undefined && profile !== undefined && !COMMANDS_WITHOUT_PAGE.has(args[0] ?? "")) {
    await ensureChrome({ executable, port, profile, userAgent: process.env.CLOTS_BROWSER_USER_AGENT });
  }

  const command = Bun.spawn([realAgentBrowser, ...args], { stdio: ["inherit", "inherit", "inherit"] });

  return await command.exited;
};
