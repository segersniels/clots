import { app, BrowserWindow, ipcMain, Menu, session, shell, type Cookie } from "electron";
import { randomUUID } from "node:crypto";
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

/** Tells whether a page belongs to the clots server that the operator chose. */
const isServerPage = (url: string | undefined) => {
  const serverUrl = readServerUrl();

  return url !== undefined && serverUrl !== undefined && new URL(url).origin === new URL(serverUrl).origin;
};

/** A cookie in the form that the clots server loads into a bot's browser. */
interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

const SAME_SITE = { strict: "Strict", lax: "Lax", no_restriction: "None" } as const;

const toBrowserCookie = (cookie: Cookie): BrowserCookie => {
  const sameSite = SAME_SITE[cookie.sameSite as keyof typeof SAME_SITE];

  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain ?? "",
    path: cookie.path ?? "/",
    // A cookie without an expiry ends with the browser session.
    expires: cookie.expirationDate ?? -1,
    httpOnly: cookie.httpOnly ?? false,
    secure: cookie.secure ?? false,
    ...(sameSite === undefined ? {} : { sameSite }),
  };
};

/**
 * Tells whether a cookie belongs to the site that the operator signs in to: the site itself, one of
 * its subdomains, or a parent domain such as `example.com` for `accounts.example.com`.
 */
const belongsToSite = (cookie: Cookie, siteHost: string) => {
  const domain = (cookie.domain ?? "").replace(/^\./, "");

  // A parent domain needs two parts at least, so a bare suffix such as `com` never counts.
  return domain === siteHost || domain.endsWith(`.${siteHost}`) || (domain.includes(".") && siteHost.endsWith(`.${domain}`));
};

/**
 * Opens a site in its own window with a new, empty session, so the operator signs in as in any
 * browser. When the operator closes the window, returns the site's cookies and wipes the session
 * from this machine.
 */
const signIn = (url: string) =>
  new Promise<BrowserCookie[]>((resolve) => {
    const signInSession = session.fromPartition(`clots-sign-in-${randomUUID()}`);
    // Sign-in pages such as Google's refuse a browser that names itself Electron or an app, so the window names itself as the Chrome it is.
    signInSession.setUserAgent(
      app.userAgentFallback.replace(` ${app.getName()}/${app.getVersion()}`, "").replace(/ Electron\/\S+/, ""),
    );

    const signInWindow = new BrowserWindow({
      ...(window === undefined ? {} : { parent: window }),
      width: 520,
      height: 760,
      webPreferences: { session: signInSession },
    });
    // The window has no controls of its own, so its title tells the operator how to finish.
    signInWindow.on("page-title-updated", (event, title) => {
      event.preventDefault();
      signInWindow.setTitle(`${title} — close this window when you are signed in`);
    });
    signInWindow.on("closed", () => {
      void signInSession.cookies.get({}).then(async (cookies) => {
        await signInSession.clearStorageData();
        // A sign-in through another service, such as Google, leaves that service's login here too. Only the site's own login goes to the bot.
        const siteHost = new URL(url).hostname.replace(/^www\./, "");
        resolve(cookies.filter((cookie) => belongsToSite(cookie, siteHost)).map(toBrowserCookie));
      });
    });
    void signInWindow.loadURL(url);
  });

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

  const serverUrl = readServerUrl();
  void (serverUrl === undefined ? showConnectPage() : showServer(serverUrl));
};

ipcMain.handle("connect", (_event, input: string) => {
  // A bare host name such as `clots.example.ts.net` means HTTPS.
  const serverUrl = new URL(/^https?:\/\//.test(input) ? input : `https://${input}`).origin;
  writeServerUrl(serverUrl);
  void showServer(serverUrl);
});

ipcMain.handle("sign-in", (event, input: string) => {
  // Only the clots web client may open a sign-in window, because it receives the cookies.
  if (event.sender !== window?.webContents || !isServerPage(event.senderFrame?.url)) throw new Error("Only the clots client can sign in.");

  // A bare host name such as `x.com` means HTTPS.
  return signIn(new URL(/^https?:\/\//.test(input) ? input : `https://${input}`).href);
});

void app.whenReady().then(() => {
  // A packaged app takes its icon from the bundle. `electron .` would show the Electron icon instead.
  if (!app.isPackaged) app.dock?.setIcon(appFile("resources/icon.png"));

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
