import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { followSystemColorScheme } from "./lib/color-scheme.ts";
import { startBotNotifications } from "./notifications.ts";
import { routeTree } from "./routeTree.gen.ts";
import "./styles.css";
import { keepWorkingThreadsCurrent } from "./thread-keep-alive.ts";

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// The desktop app marks itself in the user agent. The styles then make room for its window frame.
const desktop = /clots-desktop\/(\w+)/.exec(navigator.userAgent);
if (desktop !== null) {
  document.documentElement.classList.add("desktop", `desktop-${desktop[1]}`);
}

followSystemColorScheme();
startBotNotifications((botId) => void router.navigate({ to: "/bots/$botId", params: { botId } }));
keepWorkingThreadsCurrent();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
