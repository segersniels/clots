/** The result of one first-run check of the desktop app. `detail` describes what the check found. */
export type SetupCheck =
  { readonly status: "ok"; readonly detail: string } | { readonly status: "missing" };

/** The checks that a local clots server needs before it can start. */
export interface SetupChecks {
  /** Claude Code is installed. */
  readonly claude: SetupCheck;
  /** Claude Code has a subscription login. */
  readonly login: SetupCheck;
  /** A clots server answers on this machine. */
  readonly server: SetupCheck;
}

/** The steps that the desktop app takes to start a local server, in order. */
export type InstallStep = "install" | "browser" | "start" | "health";

export type InstallResult =
  { readonly ok: true } | { readonly ok: false; readonly message: string; readonly log: string };

/** The answer to a connection attempt. `code` is the network error, such as `net::ERR_NAME_NOT_RESOLVED`. */
export type ConnectResult = { readonly ok: true } | { readonly ok: false; readonly code: string };

/** The calls that the desktop app gives its setup page. The web client itself gets none. */
export interface DesktopBridge {
  checks(): Promise<SetupChecks>;
  /** Runs `claude auth login`, which opens the browser. Resolves when the login ends or is canceled. */
  loginClaude(): Promise<void>;
  cancelLogin(): Promise<void>;
  /** Installs and starts the local server. Reports each step as it starts. */
  installServer(onStep: (step: InstallStep) => void): Promise<InstallResult>;
  /** Opens the local server in the app and remembers the choice. */
  openLocal(): Promise<void>;
  /** Tries a remote server. On success, the app remembers it and opens it. */
  connect(address: string): Promise<ConnectResult>;
}

/**
 * Where the Clots app is with its own update. `off` means that the app cannot update itself: it runs
 * from source, or it has no Developer ID signature, which macOS needs to replace the app.
 */
export type AppUpdateState =
  | { readonly status: "off" }
  | { readonly status: "current" }
  | { readonly status: "available"; readonly version: string }
  | { readonly status: "downloading"; readonly version: string; readonly percent: number }
  | { readonly status: "ready"; readonly version: string }
  | { readonly status: "failed"; readonly version: string; readonly message: string };

/**
 * The calls of the Clots app that every page may make, also the web client of a remote server.
 * They only touch the app's own window and its signed update, so they need no guard.
 */
export interface DesktopAppBridge {
  /** Brings the app's window to the front, for example after a click on a notification. */
  revealWindow(): Promise<void>;
  /** Reads the update state now. An app from before the updater has none of the update calls. */
  updateState?(): Promise<AppUpdateState>;
  /** Calls `onState` on each change of the update state. Returns the call that stops it. */
  onUpdateState?(onState: (state: AppUpdateState) => void): () => void;
  /** Downloads the new version in the background. */
  downloadUpdate?(): Promise<void>;
  /** Quits the app, replaces it with the downloaded version, and opens it again. */
  installUpdate?(): Promise<void>;
  /** Shows the number of unread bots on the app icon. Zero removes the badge. An older app has no badge. */
  setBadgeCount?(count: number): Promise<void>;
}
