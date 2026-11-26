import type { AppUpdateState } from "@clots/contracts";
import { app, powerMonitor } from "electron";
import { autoUpdater } from "electron-updater";
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

/** How often the app asks GitHub for a new release. The web client asks the server for one as often. */
const CHECK_INTERVAL_MS = 15 * 60_000;

let state: AppUpdateState = { status: "off" };
let report: (state: AppUpdateState) => void = () => undefined;

const setState = (next: AppUpdateState) => {
  state = next;
  report(next);
};

/**
 * Checks whether the app has a Developer ID signature. macOS installs an update only when its
 * signature matches the running app, so an ad-hoc build, such as one from a fork, cannot update itself.
 */
const hasDeveloperIdSignature = async () => {
  const bundle = resolve(process.resourcesPath, "../..");

  try {
    const { stderr } = await promisify(execFile)("codesign", ["--display", "--verbose=2", bundle]);

    return stderr.includes("Authority=Developer ID Application:");
  } catch {
    return false;
  }
};

/** Reads the update state for the web client. */
export const updateState = () => state;

/**
 * Starts the updater of a signed app. It asks GitHub for a new release now, every 15 minutes and
 * after each wake, and reports each state change. The download waits for the operator's click.
 */
export const startUpdates = async (onChange: (state: AppUpdateState) => void) => {
  if (!app.isPackaged || process.platform !== "darwin" || !(await hasDeveloperIdSignature())) {
    return;
  }

  report = onChange;
  autoUpdater.autoDownload = false;
  autoUpdater.on("update-available", ({ version }) => setState({ status: "available", version }));
  autoUpdater.on("update-not-available", () => setState({ status: "current" }));
  autoUpdater.on("update-downloaded", ({ version }) => setState({ status: "ready", version }));
  autoUpdater.on("download-progress", ({ percent }) => {
    if (state.status === "downloading") {
      setState({ ...state, percent });
    }
  });

  // A failed check, for example without a network, keeps the last state. The next check tries again.
  autoUpdater.on("error", (error) => {
    if (state.status === "downloading") {
      setState({ status: "failed", version: state.version, message: error.message });
    }
  });

  setState({ status: "current" });
  void check();
  setInterval(() => void check(), CHECK_INTERVAL_MS);
  // The interval pauses while the Mac sleeps, so a wake checks at once.
  powerMonitor.on("resume", () => void check());
};

/** Asks GitHub for a new release. A failed check, for example without a network, keeps the last state. */
const check = async () => {
  // A check during a download or before the restart would forget the downloaded version.
  if (state.status === "downloading" || state.status === "ready") {
    return;
  }

  await autoUpdater.checkForUpdates().catch(() => undefined);
};

/** Checks for a new release now, for the operator's check, and returns the state that it leaves. */
export const checkForUpdates = async () => {
  if (state.status !== "off") {
    await check();
  }

  return state;
};

/** Downloads the version that the last check found. The error event reports a failed download. */
export const downloadUpdate = () => {
  if (state.status !== "available" && state.status !== "failed") {
    return;
  }

  setState({ status: "downloading", version: state.version, percent: 0 });
  void autoUpdater.downloadUpdate().catch(() => undefined);
};

/** Quits the app and opens the downloaded version. */
export const installUpdate = () => {
  if (state.status === "ready") {
    autoUpdater.quitAndInstall();
  }
};
