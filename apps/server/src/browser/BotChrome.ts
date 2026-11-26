import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runtimePaths } from "../paths.ts";

/** The real `agent-browser` CLI, from the dependencies or the installation. */
export const realAgentBrowser = runtimePaths.agentBrowser;

/** The agent-browser commands that do not use the page, so they do not start a Chrome. */
const COMMANDS_WITHOUT_PAGE = new Set([
  "close",
  "session",
  "skills",
  "install",
  "doctor",
  "help",
  "--help",
  "-h",
  "--version",
]);

/** The size of each bot's browser screen, which the take-over window restores. */
export const SCREEN_SIZE = { width: 1280, height: 800 };

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
export const isRunning = async (port: number) => {
  try {
    return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok;
  } catch {
    return false;
  }
};

/**
 * Checks whether the Chrome on a DevTools port runs the given profile. Another clots server, such as
 * a test server, can give the same port to one of its own bots.
 */
const runsProfile = async (port: number, profile: string) => {
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as {
    webSocketDebuggerUrl: string;
  };
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  const reply = await new Promise<{
    result?: { processInfo: ReadonlyArray<{ type: string; id: number }> };
  }>((resolve, reject) => {
    socket.onopen = () =>
      socket.send(JSON.stringify({ id: 1, method: "SystemInfo.getProcessInfo" }));
    socket.onmessage = ({ data }) => resolve(JSON.parse(String(data)));
    socket.onerror = () => reject(new Error(`No DevTools connection on port ${port}.`));
  }).finally(() => socket.close());
  const browser = reply.result?.processInfo.find((process) => process.type === "browser");

  if (browser === undefined) {
    return false;
  }

  const commandLine = Bun.spawnSync([
    "ps",
    "-ww",
    "-o",
    "args=",
    "-p",
    String(browser.id),
  ]).stdout.toString();

  return commandLine.includes(`--user-data-dir=${profile}`);
};

/**
 * Checks whether Chrome restores the last session of a profile. It does so only after a clean
 * close, such as the idle close. After a crash or a kill, it opens a new tab page instead.
 */
const restoresSession = (profile: string) => {
  try {
    const preferences = JSON.parse(readFileSync(join(profile, "Default", "Preferences"), "utf8"));

    return preferences.profile?.exit_type === "Normal";
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
  if (await isRunning(port)) {
    if (await runsProfile(port, profile)) {
      return;
    }

    throw new Error(`Port ${port} has the Chrome of another profile, so the bot does not use it.`);
  }

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
      `--window-size=${SCREEN_SIZE.width},${SCREEN_SIZE.height}`,
      ...(userAgent === undefined ? [] : [`--user-agent=${userAgent}`]),
      // A browser that closed when idle gets its tabs and its session cookies back.
      "--restore-last-session",
      // A start page would add a tab to the restored ones.
      ...(restoresSession(profile) ? [] : ["about:blank"]),
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
    if (await isRunning(port)) {
      return;
    }

    await Bun.sleep(200);
  }

  throw new Error(`The bot's Chrome did not start on port ${port}.`);
};

/** Closes the bot's Chrome, if it runs. A Chrome of another profile on the port stays open. */
export const closeChrome = async (port: number, profile: string) => {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`)
    .then((response) => response.json() as Promise<{ webSocketDebuggerUrl: string }>)
    .catch(() => undefined);

  if (version === undefined || !(await runsProfile(port, profile))) {
    return;
  }

  await new Promise<void>((resolve) => {
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    socket.onclose = () => resolve();
    socket.onerror = () => resolve();
  });
};

/** The title and address of one page of the bot's Chrome. */
export interface PageInfo {
  readonly targetId: string;
  readonly title: string;
  readonly url: string;
}

/** Reads the title and address of each page of the bot's Chrome. Without a Chrome of its own, the bot has none. */
export const readPages = async (port: number): Promise<ReadonlyArray<PageInfo>> => {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
    .then(
      (response) =>
        response.json() as Promise<
          ReadonlyArray<{ id: string; type: string; title: string; url: string }>
        >,
    )
    .catch(() => []);

  return targets
    .filter((target) => target.type === "page")
    .map(({ id, title, url }) => ({ targetId: id, title, url }));
};

/** Stops the loading of one page of the bot's Chrome, as the stop button of a browser does. */
export const stopLoading = async (port: number, targetId: string) => {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
    .then(
      (response) =>
        response.json() as Promise<ReadonlyArray<{ id: string; webSocketDebuggerUrl?: string }>>,
    )
    .catch(() => []);
  const address = targets.find((target) => target.id === targetId)?.webSocketDebuggerUrl;

  if (address === undefined) {
    return;
  }

  await new Promise<void>((resolve) => {
    const socket = new WebSocket(address);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: "Page.stopLoading" }));
    socket.onmessage = () => {
      socket.close();
      resolve();
    };
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

  if (
    Number.isInteger(port) &&
    executable !== undefined &&
    profile !== undefined &&
    !COMMANDS_WITHOUT_PAGE.has(args[0] ?? "")
  ) {
    await ensureChrome({
      executable,
      port,
      profile,
      userAgent: process.env.CLOTS_BROWSER_USER_AGENT,
    });
  }

  const command = Bun.spawn([realAgentBrowser, ...args], {
    stdio: ["inherit", "inherit", "inherit"],
  });

  return await command.exited;
};
