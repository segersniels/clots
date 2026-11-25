import type { AppUpdateState, DesktopAppBridge, DesktopBridge, InstallStep } from "@clots/contracts";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

/** The calls of the setup page. Only the app's own setup page gets them, never the web client of a server. */
const bridge: DesktopBridge = {
  checks: () => ipcRenderer.invoke("setup:checks"),
  loginClaude: () => ipcRenderer.invoke("setup:login"),
  cancelLogin: () => ipcRenderer.invoke("setup:cancel-login"),
  installServer: async (onStep) => {
    const listener = (_event: IpcRendererEvent, step: InstallStep) => onStep(step);
    ipcRenderer.on("setup:install-step", listener);

    try {
      return await ipcRenderer.invoke("setup:install");
    } finally {
      ipcRenderer.removeListener("setup:install-step", listener);
    }
  },
  openLocal: () => ipcRenderer.invoke("setup:open-local"),
  connect: (address) => ipcRenderer.invoke("setup:connect", address),
};

if (location.protocol === "file:") contextBridge.exposeInMainWorld("clotsDesktop", bridge);

/** The calls that every page gets: notifications that lead back to the app, and the app's own update. */
const appBridge: DesktopAppBridge = {
  revealWindow: () => ipcRenderer.invoke("app:reveal-window"),
  updateState: () => ipcRenderer.invoke("app:update-state"),
  onUpdateState: (onState) => {
    const listener = (_event: IpcRendererEvent, state: AppUpdateState) => onState(state);
    ipcRenderer.on("app:update-changed", listener);

    return () => ipcRenderer.removeListener("app:update-changed", listener);
  },
  downloadUpdate: () => ipcRenderer.invoke("app:download-update"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
  setBadgeCount: (count) => ipcRenderer.invoke("app:set-badge-count", count),
};

contextBridge.exposeInMainWorld("clotsApp", appBridge);
