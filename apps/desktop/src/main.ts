import type { ConnectResult } from "@clots/contracts";
import { app, BrowserWindow, ipcMain, Menu, net, shell, type IpcMainInvokeEvent } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { cancelLogin, installServer, LOCAL_SERVER_URL, loginClaude, runChecks } from "./local.ts";

/** Resolves a file of the app. The bundler replaces `__dirname`, so the app path is the anchor. */
const appFile = (path: string) => join(app.getAppPath(), path);
const configPath = () => join(app.getPath("userData"), "config.json");

/** The web client reads this tag to make room for the window frame. */
const USER_AGENT_TAG = ` clots-desktop/${process.platform === "darwin" ? "mac" : "other"}`;

/** Where the operator chose to run clots. A config from before the local mode has only a server address. */
interface Config {
  readonly mode: "local" | "remote";
  readonly serverUrl: string;
}

const readConfig = (): Config | undefined => {
  try {
    const { mode = "remote", serverUrl } = JSON.parse(readFileSync(configPath(), "utf8"));

    return typeof serverUrl === "string" ? { mode, serverUrl } : undefined;
  } catch {
    return undefined;
  }
};

const writeConfig = (config: Config) => {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config));
};

/** Tells whether a page belongs to the clots server that the operator chose. */
const isServerPage = (url: string | undefined) => {
  const serverUrl = readConfig()?.serverUrl;

  return url !== undefined && serverUrl !== undefined && new URL(url).origin === new URL(serverUrl).origin;
};

let window: BrowserWindow | undefined;

/** Shows the setup page. `query` opens a given screen, such as the remote screen with its last error. */
const showSetup = (query: Record<string, string> = {}) => window?.loadFile(appFile("resources/setup/setup.html"), { query });

/** Shows the web client that the clots server serves. The app holds no copy of the client. */
const showServer = (serverUrl: string) => window?.loadURL(serverUrl);

const createWindow = () => {
  window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 420,
    minHeight: 480,
    backgroundColor: "#0c0c0d",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: { preload: appFile("dist/preload.cjs") },
  });
  const { webContents } = window;
  webContents.setUserAgent(webContents.getUserAgent() + USER_AGENT_TAG);

  // The server does not answer. A local server gets its checklist again, which starts it. A remote one shows the error.
  webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    // Code -3 means that a newer navigation replaced this one.
    const replaced = code === -3;

    if (!isMainFrame || replaced || !isServerPage(url)) return;

    if (readConfig()?.mode === "local") {
      void showSetup({ screen: "local" });

      return;
    }

    void showSetup({ screen: "remote", address: new URL(url).host, error: `net::${description}` });
  });

  // Only the clots server and the setup page show in the app. Other links open in the browser.
  const isInApp = (url: string) => url.startsWith("file:") || isServerPage(url);

  webContents.on("will-navigate", (event, url) => {
    if (isInApp(url)) return;

    event.preventDefault();
    void shell.openExternal(url);
  });

  webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);

    return { action: "deny" };
  });

  const config = readConfig();
  void (config === undefined ? showSetup() : showServer(config.serverUrl));
};

/**
 * Registers a call of the setup page. Only the page from the app's own files may make it, so a
 * remote server's page cannot start programs on this Mac.
 */
const handleSetup = <A extends ReadonlyArray<unknown>>(channel: string, handler: (event: IpcMainInvokeEvent, ...args: A) => unknown) =>
  ipcMain.handle(channel, (event, ...args) => {
    if (!event.senderFrame?.url.startsWith("file:")) throw new Error(`${channel} is only for the setup page.`);

    return handler(event, ...(args as unknown as A));
  });

/** Checks a remote server and opens it. Electron's network errors name the cause, such as `net::ERR_NAME_NOT_RESOLVED`. */
const connect = async (input: string): Promise<ConnectResult> => {
  let serverUrl: string;

  // A bare host name such as `clots.example.ts.net` means HTTPS.
  try {
    serverUrl = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`).origin;
  } catch {
    return { ok: false, code: "Not a valid address" };
  }

  try {
    await net.fetch(serverUrl, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return { ok: false, code: /net::\w+/.exec(message)?.[0] ?? message };
  }

  writeConfig({ mode: "remote", serverUrl });
  void showServer(serverUrl);

  return { ok: true };
};

handleSetup("setup:checks", () => runChecks());
handleSetup("setup:login", () => loginClaude());
handleSetup("setup:cancel-login", () => cancelLogin());
handleSetup("setup:install", (event) => installServer((step) => event.sender.send("setup:install-step", step)));
handleSetup("setup:connect", (_event, address: string) => connect(address));

handleSetup("setup:open-local", () => {
  writeConfig({ mode: "local", serverUrl: LOCAL_SERVER_URL });
  void showServer(LOCAL_SERVER_URL);
});

void app.whenReady().then(() => {
  // A packaged app takes its icon from the bundle. `electron .` would show the Electron icon instead.
  if (!app.isPackaged) app.dock?.setIcon(appFile("resources/icon.png"));

  const defaultMenu = Menu.getApplicationMenu();
  const menu = Menu.buildFromTemplate([
    ...(defaultMenu?.items ?? []),
    { label: "Server", submenu: [{ label: "Change Server…", click: () => void showSetup() }] },
  ]);
  Menu.setApplicationMenu(menu);

  createWindow();

  // On macOS the app stays open without a window, and the dock icon opens a new one.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
