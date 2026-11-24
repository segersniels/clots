import type { DesktopBridge } from "@clots/contracts";

declare global {
  interface Window {
    /** The calls of the desktop app. Its preload script puts them on the window of the setup page. */
    readonly clotsDesktop: DesktopBridge;
  }
}

export const desktop = window.clotsDesktop;

/** The guide for a clots server on another machine. */
export const SELF_HOSTING_GUIDE = "https://github.com/segersniels/clots/blob/main/docs/install.md";
