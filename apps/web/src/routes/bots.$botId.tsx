import type { BotId } from "@clots/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, MonitorIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { client, useStore } from "../client.ts";
import { Avatar } from "../components/Avatar.tsx";
import { BrowserPane } from "../components/BrowserPane.tsx";
import { Chat } from "../components/Chat.tsx";
import { ModelPicker } from "../components/ModelPicker.tsx";
import { Routines } from "../components/Routines.tsx";

export const Route = createFileRoute("/bots/$botId")({ component: BotPage });

function BotPage() {
  const botId = Route.useParams().botId as BotId;
  const bot = useStore(client.bots).find((candidate) => candidate.id === botId);
  const [detailsOpen, setDetailsOpen] = useState(true);

  // The bot list arrives a moment after the page opens.
  if (bot === undefined) return null;

  return (
    <div className={`grid h-full min-h-0 grid-cols-1 ${detailsOpen ? "xl:grid-cols-[1fr_24rem]" : ""}`}>
      <section className="flex min-h-0 flex-col">
        <header className="window-drag flex h-14 shrink-0 items-center gap-2.5 px-5">
          <Button variant="ghost" size="icon" aria-label="All bots" className="md:hidden" render={<Link to="/" />}>
            <ArrowLeftIcon />
          </Button>
          <Avatar name={bot.name} color={bot.color} shape={bot.shape} size={24} />
          <h1 className="min-w-0 flex-1 truncate font-semibold">{bot.name}</h1>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Show the bot's screen"
            className="hidden text-muted-foreground xl:inline-flex"
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            <MonitorIcon />
          </Button>
        </header>

        {/* The key gives each bot its own chat state, such as the draft. */}
        <Chat key={botId} botId={botId} botName={bot.name} />
      </section>

      <aside className={`${detailsOpen ? "xl:flex" : ""} hidden min-h-0 flex-col border-l`}>
        <header className="window-drag flex h-14 shrink-0 items-center justify-end px-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close details"
            className="text-muted-foreground"
            onClick={() => setDetailsOpen(false)}
          >
            <XIcon />
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-4 pb-4">
          <BrowserPane key={botId} botId={botId} botName={bot.name} />
          <ModelPicker bot={bot} />
          <Routines botId={botId} />
        </div>
      </aside>
    </div>
  );
}
