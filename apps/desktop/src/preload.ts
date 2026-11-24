import type { DesktopBridge, InstallStep } from "@clots/contracts";
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
