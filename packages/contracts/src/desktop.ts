/** The result of one first-run check of the desktop app. `detail` describes what the check found. */
export type SetupCheck = { readonly status: "ok"; readonly detail: string } | { readonly status: "missing" };

/** The checks that a local clots server needs before it can start. */
export interface SetupChecks {
  /** Claude Code is installed. */
  readonly claude: SetupCheck;
  /** Claude Code has a subscription login. */
  readonly login: SetupCheck;
  /** Chrome or Chromium is installed for the bots' browser. The server also runs without it. */
  readonly browser: SetupCheck;
  /** A clots server answers on this machine. */
  readonly server: SetupCheck;
}

/** The steps that the desktop app takes to start a local server, in order. */
export type InstallStep = "install" | "start" | "health";

export type InstallResult = { readonly ok: true } | { readonly ok: false; readonly message: string; readonly log: string };

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
 * The calls of the Clots app that every page may make, also the web client of a remote server.
 * They only touch the app's own window, so they need no guard.
 */
export interface DesktopAppBridge {
  /** Brings the app's window to the front, for example after a click on a notification. */
  revealWindow(): Promise<void>;
}
