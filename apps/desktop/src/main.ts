import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Resolves a file of the app. The bundler replaces `__dirname`, so the app path is the anchor. */
const appFile = (path: string) => join(app.getAppPath(), path);
const configPath = () => join(app.getPath("userData"), "config.json");

/** The web client reads this tag to make room for the window frame. */
const USER_AGENT_TAG = ` clots-desktop/${process.platform === "darwin" ? "mac" : "other"}`;

/** Reads the address of the clots server that the operator chose. */
const readServerUrl = (): string | undefined => {
  try {
    return JSON.parse(readFileSync(configPath(), "utf8")).serverUrl;
  } catch {
    return undefined;
  }
};

const writeServerUrl = (serverUrl: string) => {
  mkdirSync(dirname(configPath()), { recursive: true });
  writeFileSync(configPath(), JSON.stringify({ serverUrl }));
};

let window: BrowserWindow | undefined;

const showConnectPage = (error?: string) =>
  window?.loadFile(appFile("resources/connect.html"), {
    query: { url: readServerUrl() ?? "", ...(error === undefined ? {} : { error }) },
  });

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

  // The server is off or the Mac is not on the tailnet. The operator can try again or change it.
  webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    // Code -3 means that a newer navigation replaced this one.
    if (isMainFrame && code !== -3) void showConnectPage(description);
  });

  // Only the clots server and the connect page show in the app. Other links open in the browser.
  const isInApp = (url: string) => {
    const serverUrl = readServerUrl();

    return url.startsWith("file:") || (serverUrl !== undefined && new URL(url).origin === new URL(serverUrl).origin);
  };

  webContents.on("will-navigate", (event, url) => {
    if (isInApp(url)) return;

    event.preventDefault();
    void shell.openExternal(url);
  });

  webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);

    return { action: "deny" };
  });

  const serverUrl = readServerUrl();
  void (serverUrl === undefined ? showConnectPage() : showServer(serverUrl));
};

ipcMain.handle("connect", (_event, input: string) => {
  // A bare host name such as `clots.example.ts.net` means HTTPS.
  const serverUrl = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`).origin;
  writeServerUrl(serverUrl);
  void showServer(serverUrl);
});

void app.whenReady().then(() => {
  const defaultMenu = Menu.getApplicationMenu();
  const menu = Menu.buildFromTemplate([
    ...(defaultMenu?.items ?? []),
    { label: "Server", submenu: [{ label: "Change Server…", click: () => void showConnectPage() }] },
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
