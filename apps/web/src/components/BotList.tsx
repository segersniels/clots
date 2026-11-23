import { Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { client, useStore } from "../client.ts";
import { formatRecent } from "../time.ts";
import { Avatar } from "./Avatar.tsx";

export function BotList() {
  const bots = useStore(client.bots);
  const connection = useStore(client.connection);
  const [search, setSearch] = useState("");
  const shown = bots.filter((bot) => bot.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <nav className="flex h-full flex-col border-r bg-sidebar text-sidebar-foreground">
      <header className="window-drag window-buttons-inset flex h-14 shrink-0 items-center justify-end px-3">
        <Button variant="ghost" size="icon" aria-label="New bot" render={<Link to="/" />}>
          <PlusIcon className="size-5 text-muted-foreground" />
        </Button>
      </header>

      <div className="px-3 pb-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search"
          aria-label="Search bots"
          className="border-transparent bg-sidebar-accent"
        />
      </div>

      <ul className="flex-1 overflow-y-auto px-3">
        {shown.map((bot) => (
          <li key={bot.id}>
            <Link
              to="/bots/$botId"
              params={{ botId: bot.id }}
              className="flex items-center gap-3 rounded-xl px-2.5 py-2.5"
              activeProps={{ className: "bg-sidebar-accent" }}
            >
              <Avatar name={bot.name} color={bot.color} shape={bot.shape} size={44} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-[0.95rem] font-semibold">{bot.name}</span>
                  {bot.lastMessageAt !== null && (
                    <span className="shrink-0 text-xs text-muted-foreground">{formatRecent(bot.lastMessageAt)}</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${bot.status === "working" ? "animate-pulse motion-reduce:animate-none" : "text-muted-foreground"}`}
                  >
                    {bot.statusLine}
                  </span>
                  {/* The dot marks a bot that waits for the operator. */}
                  {bot.status === "waiting" && <span className="size-2 shrink-0 rounded-full bg-attention" />}
                </span>
              </span>
            </Link>
          </li>
        ))}

        {bots.length === 0 && <p className="pt-24 text-center text-sm text-muted-foreground">No chats yet</p>}
      </ul>

      {connection !== "connected" && (
        <footer className="px-5 py-3 text-xs text-muted-foreground">
          {connection === "connecting" ? "Connecting…" : "Disconnected. Trying again…"}
        </footer>
      )}
    </nav>
  );
}
