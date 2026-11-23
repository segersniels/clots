import { contextBridge, ipcRenderer } from "electron";

/** The calls that the connect page and the web client make into the app. */
contextBridge.exposeInMainWorld("clotsDesktop", {
  connect: (serverUrl: string) => ipcRenderer.invoke("connect", serverUrl),
  signIn: (url: string) => ipcRenderer.invoke("sign-in", url),
});
