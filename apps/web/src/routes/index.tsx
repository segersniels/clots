import { createFileRoute, Navigate } from "@tanstack/react-router";

import { useMediaQuery } from "@/hooks/use-media-query";

import { client, useStore } from "../client.ts";
import { BotList } from "../components/BotList.tsx";
import { NoBots } from "../components/CreateDialog.tsx";

export const Route = createFileRoute("/")({ component: Home });

/** The window width from which the sidebar shows. It matches the Tailwind `md` breakpoint. */
const WIDE_WINDOW = "(min-width: 48rem)";

/** Opens a bot. A phone has no sidebar, so there the home page is the bot list. */
function Home() {
  const wide = useMediaQuery(WIDE_WINDOW);
  const firstBot = useStore(client.bots)[0]?.id;

  if (!wide) {
    return <BotList />;
  }

  if (firstBot !== undefined) {
    return <Navigate to="/bots/$botId" params={{ botId: firstBot }} replace />;
  }

  return (
    <div className="window-drag flex h-full items-center justify-center">
      <NoBots />
    </div>
  );
}
