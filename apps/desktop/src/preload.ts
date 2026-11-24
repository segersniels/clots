import { contextBridge, ipcRenderer } from "electron";

/** The one call that the connect page needs. The web client itself gets no desktop API. */
contextBridge.exposeInMainWorld("clotsDesktop", {
  connect: (serverUrl: string) => ipcRenderer.invoke("connect", serverUrl),
});
