import { createRootRoute, Outlet, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { usePanelRef } from "react-resizable-panels";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/use-media-query";
import { takeStartupBot } from "@/lib/last-bot";
import { readPaneWidth, savePaneWidth } from "@/lib/pane-width";

import { BotList } from "../components/BotList.tsx";

export const Route = createRootRoute({
  component: Layout,
  // The app opens where the operator left off. Only its first page does this, so the + menu still opens the new bot page.
  beforeLoad: ({ location }) => {
    const lastBot = takeStartupBot();

    if (location.pathname === "/" && lastBot !== null) throw redirect({ to: "/bots/$botId", params: { botId: lastBot }, replace: true });
  },
});

/** The width of the sidebar in pixels until the operator drags the divider. */
const DEFAULT_SIDEBAR_WIDTH = 240;

/** The storage key of the sidebar width that the operator chose. */
const SIDEBAR_WIDTH_KEY = "clots.sidebarWidth";

/** The window width from which the sidebar shows. It matches the Tailwind `md` breakpoint. */
const WIDE_WINDOW = "(min-width: 48rem)";

function Layout() {
  const wide = useMediaQuery(WIDE_WINDOW);
  const [sidebarWidth] = useState(() => readPaneWidth(SIDEBAR_WIDTH_KEY, DEFAULT_SIDEBAR_WIDTH));
  const sidebar = usePanelRef();
  const [resetting, setResetting] = useState(false);

  /** Brings the sidebar back to its default width, as a double-click on the divider does in most apps. */
  const resetSidebar = () => {
    setResetting(true);
    sidebar.current?.resize(DEFAULT_SIDEBAR_WIDTH);
  };

  const main = (
    <main className="h-full min-h-0 min-w-0">
      <Outlet />
    </main>
  );

  // A phone has no sidebar. The home page shows the bot list under the form instead.
  if (!wide) return <div className="h-full text-sm">{main}</div>;

  return (
    // Only the reset animates. During a drag the sidebar follows the pointer at once.
    <ResizablePanelGroup
      className={`text-sm ${resetting ? "*:transition-[flex-grow] *:duration-300 *:ease-drawer motion-reduce:*:transition-none" : ""}`}
      onTransitionEnd={(event) => event.propertyName === "flex-grow" && setResetting(false)}
    >
      {/* The sidebar keeps its width in pixels when the window changes size. */}
      <ResizablePanel
        id="sidebar"
        panelRef={sidebar}
        defaultSize={sidebarWidth}
        minSize={200}
        maxSize={400}
        groupResizeBehavior="preserve-pixel-size"
        onResize={(size) => savePaneWidth(SIDEBAR_WIDTH_KEY, size.inPixels)}
      >
        <BotList />
      </ResizablePanel>
      <ResizableHandle disableDoubleClick onDoubleClick={resetSidebar} />
      <ResizablePanel id="main">{main}</ResizablePanel>
    </ResizablePanelGroup>
  );
}
