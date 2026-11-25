import type { ConnectResult } from "@clots/contracts";
import { isNewerVersion } from "@clots/contracts/version";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  MenuItem,
  net,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  cancelLogin,
  installedVersion,
  installServer,
  LOCAL_SERVER_URL,
  loginClaude,
  runChecks,
} from "./local.ts";
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  startUpdates,
  updateState,
} from "./updates.ts";

// The app menu shows the name in About, Hide and Quit. The data folder stays where versions named after the package kept it.
app.setPath("userData", app.getPath("userData"));
app.setName("Clots");

/** Resolves a file of the app. The bundler replaces `__dirname`, so the app path is the anchor. */
const appFile = (path: string) => join(app.getAppPath(), path);
const configPath = () => join(app.getPath("userData"), "config.json");

/** The web client reads this tag to make room for the window frame, and to offer a newer app. */
const USER_AGENT_TAG = ` clots-desktop/${process.platform === "darwin" ? "mac" : "other"}/${app.getVersion()}`;

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

  return (
    url !== undefined &&
    serverUrl !== undefined &&
    new URL(url).origin === new URL(serverUrl).origin
  );
};

let window: BrowserWindow | undefined;

/** Set when the app quits, so the window closes for real instead of hiding. */
let quitting = false;

/** Shows the setup page. `query` opens a given screen, such as the remote screen with its last error. */
const showSetup = (query: Record<string, string> = {}) =>
  window?.loadFile(appFile("resources/setup/setup.html"), { query });

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

  // On macOS the app keeps running in the dock after the close button. The page stays alive, so it still sends notifications.
  window.on("close", (event) => {
    if (process.platform !== "darwin" || quitting) {
      return;
    }

    event.preventDefault();
    window?.hide();
  });

  // The server does not answer. A local server gets its checklist again, which starts it. A remote one shows the error.
  webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    // Code -3 means that a newer navigation replaced this one.
    const replaced = code === -3;

    if (!isMainFrame || replaced || !isServerPage(url)) {
      return;
    }

    if (readConfig()?.mode === "local") {
      void showSetup({ screen: "local" });

      return;
    }

    void showSetup({ screen: "remote", address: new URL(url).host, error: `net::${description}` });
  });

  /** Only the clots server and the setup page show in the app. Other links open in the browser. */
  const isInApp = (url: string) => url.startsWith("file:") || isServerPage(url);

  webContents.on("will-navigate", (event, url) => {
    if (isInApp(url)) {
      return;
    }

    event.preventDefault();
    void shell.openExternal(url);
  });

  webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);

    return { action: "deny" };
  });

  void showStart();
};

/**
 * Opens what the operator chose. A local server older than the one in this app gets the new one
 * first, through the setup checklist, so an app update also updates the local server.
 */
const showStart = async () => {
  const config = readConfig();

  if (config === undefined) {
    return showSetup();
  }

  if (config.mode === "local") {
    const installed = await installedVersion();

    if (installed !== undefined && isNewerVersion(app.getVersion(), installed)) {
      return showSetup({ screen: "local", reinstall: "1" });
    }
  }

  return showServer(config.serverUrl);
};

/**
 * Registers a call of the setup page. Only the page from the app's own files may make it, so a
 * remote server's page cannot start programs on this Mac.
 */
const handleSetup = <A extends ReadonlyArray<unknown>>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: A) => unknown,
) =>
  ipcMain.handle(channel, (event, ...args) => {
    if (!event.senderFrame?.url.startsWith("file:")) {
      throw new Error(`${channel} is only for the setup page.`);
    }

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

ipcMain.handle("app:reveal-window", () => {
  if (window?.isMinimized()) {
    window.restore();
  }

  window?.show();
  app.focus({ steal: true });
});

ipcMain.handle("app:set-badge-count", (_event, count: number) => void app.setBadgeCount(count));

ipcMain.handle("app:update-state", () => updateState());
ipcMain.handle("app:check-for-updates", () => checkForUpdates());
ipcMain.handle("app:download-update", () => downloadUpdate());

ipcMain.handle("app:install-update", () => {
  // The window hides on close instead of closing, which would stop the quit that installs the update.
  quitting = true;
  installUpdate();
});

handleSetup("setup:checks", () => runChecks());
handleSetup("setup:login", () => loginClaude());
handleSetup("setup:cancel-login", () => cancelLogin());
handleSetup("setup:install", (event) =>
  installServer((step) => event.sender.send("setup:install-step", step)),
);
handleSetup("setup:connect", (_event, address: string) => connect(address));

handleSetup("setup:open-local", () => {
  writeConfig({ mode: "local", serverUrl: LOCAL_SERVER_URL });
  void showServer(LOCAL_SERVER_URL);
});

void app.whenReady().then(() => {
  // A packaged app takes its icon from the bundle. `electron .` would show the Electron icon instead.
  if (!app.isPackaged) {
    app.dock?.setIcon(appFile("resources/icon.png"));
  }

  const defaultMenu = Menu.getApplicationMenu();

  // On macOS the first menu is the app menu. The update check goes under About. The page checks the app and the server, and the sidebar shows what it finds.
  if (process.platform === "darwin") {
    const checkItem = new MenuItem({
      label: "Check for Updates…",
      click: () => window?.webContents.send("app:check-for-updates-requested"),
    });
    defaultMenu?.items[0]?.submenu?.insert(1, checkItem);
  }

  const menu = Menu.buildFromTemplate([
    ...(defaultMenu?.items ?? []),
    { label: "Server", submenu: [{ label: "Change Server…", click: () => void showSetup() }] },
  ]);
  Menu.setApplicationMenu(menu);

  createWindow();
  void startUpdates((state) => {
    if (window?.isDestroyed() === false) {
      window.webContents.send("app:update-changed", state);
    }
  });

  // On macOS the dock icon shows the hidden window again.
  app.on("activate", () => {
    if (window === undefined || window.isDestroyed()) {
      return createWindow();
    }

    window.show();
  });
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
