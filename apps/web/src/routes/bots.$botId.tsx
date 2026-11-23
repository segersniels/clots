import { Character } from "@clots/character";
import type { BotId } from "@clots/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type TransitionEvent } from "react";
import { usePanelRef, type PanelSize } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useMediaQuery } from "@/hooks/use-media-query";
import { readPaneWidth, savePaneWidth } from "@/lib/pane-width";

import { client, useStore } from "../client.ts";
import { BotIdentity, BotInstructions } from "../components/BotSettings.tsx";
import { BrowserPane } from "../components/BrowserPane.tsx";
import { Chat } from "../components/Chat.tsx";
import { ModelPicker } from "../components/ModelPicker.tsx";
import { ProjectPicker } from "../components/ProjectPicker.tsx";
import { Routines } from "../components/Routines.tsx";

export const Route = createFileRoute("/bots/$botId")({ component: BotPage });

/** The width of the details pane in pixels until the operator drags its divider. */
const DEFAULT_DETAILS_WIDTH = 288;

/** The storage key of the details pane width that the operator chose. */
const DETAILS_WIDTH_KEY = "clots.detailsWidth";

/** The window width from which the details pane is a column beside the chat. It matches the Tailwind `lg` breakpoint. */
const WIDE_WINDOW = "(min-width: 64rem)";

/** The transitions that slide the details pane over the chat on a narrow window. */
const SLIDE_TRANSITIONS = ["translate", "opacity"];

function BotPage() {
  const botId = Route.useParams().botId as BotId;
  const bot = useStore(client.bots).find((candidate) => candidate.id === botId);
  const wide = useMediaQuery(WIDE_WINDOW);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const details = usePanelRef();
  const [detailsOpen, setDetailsOpen] = useState(false);
  // The content stays mounted while the pane closes, and leaves when the pane is gone.
  const [detailsMounted, setDetailsMounted] = useState(false);
  // The column animates only when it opens, closes or resets. During a drag it follows the pointer at once.
  const [animating, setAnimating] = useState(false);
  // A ref, so that a drag does not render the whole page on each move.
  const detailsWidth = useRef(readPaneWidth(DETAILS_WIDTH_KEY, DEFAULT_DETAILS_WIDTH));

  // To open a bot is to read it. A bot that the operator marks as unread while it is open keeps the mark.
  useEffect(() => {
    void client.setBotUnread(botId, false);
  }, [botId]);

  // The bot list arrives a moment after the page opens.
  if (bot === undefined) return null;

  const toggleDetails = () => {
    const open = !detailsOpen;
    if (open) setDetailsMounted(true);
    setDetailsOpen(open);

    // A narrow window slides the pane with CSS alone.
    if (!wide) return;

    // Without the animation no transition ends, so the content leaves at once.
    if (reduceMotion && !open) setDetailsMounted(false);
    if (!reduceMotion) setAnimating(true);

    if (open) details.current?.resize(detailsWidth.current);
    else details.current?.collapse();
  };

  /** Brings the pane back to its default width, as a double-click on the divider does in most apps. */
  const resetDetailsWidth = () => {
    if (Math.round(details.current?.getSize().inPixels ?? 0) === DEFAULT_DETAILS_WIDTH) return;

    detailsWidth.current = DEFAULT_DETAILS_WIDTH;
    savePaneWidth(DETAILS_WIDTH_KEY, DEFAULT_DETAILS_WIDTH);
    if (!reduceMotion) setAnimating(true);
    details.current?.resize(DEFAULT_DETAILS_WIDTH);
  };

  const followDetailsWidth = ({ inPixels }: PanelSize) => {
    // The sizes during an animation are steps on the way, not a width that the operator chose.
    if (animating) return;

    // A drag past the minimum width closes the pane.
    if (inPixels === 0 && detailsOpen) {
      setDetailsOpen(false);
      setDetailsMounted(false);
    }

    if (inPixels === 0) return;

    detailsWidth.current = inPixels;
    savePaneWidth(DETAILS_WIDTH_KEY, inPixels);
  };

  const finishTransition = (event: TransitionEvent) => {
    const columnMoved = event.propertyName === "flex-grow";
    const paneSlid = (event.target as Element).id === "bot-details" && SLIDE_TRANSITIONS.includes(event.propertyName);

    if (columnMoved) setAnimating(false);
    if ((columnMoved || paneSlid) && !detailsOpen) setDetailsMounted(false);
  };

  // Without `min-w-0`, one long line in the thread makes this column wider than the window.
  const chat = (
    <section className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {/* The header floats over the thread, which fades out below it. A scroll over the header still reaches the thread. */}
      <header className="window-drag pointer-events-none absolute inset-x-0 top-0 z-10 grid h-13 grid-cols-[1fr_auto_1fr] items-center px-3 *:pointer-events-auto">
        <Button variant="ghost" size="icon" aria-label="All bots" className="md:hidden" render={<Link to="/" />}>
          <ArrowLeftIcon />
        </Button>

        <Button
          variant="secondary"
          aria-expanded={detailsOpen}
          aria-controls="bot-details"
          className="col-start-2 gap-2 rounded-full px-2.5 font-medium"
          onClick={toggleDetails}
        >
          <Character shape={bot.shape} color={bot.color} mood={bot.status} size={20} />
          <span className="max-w-[40vw] truncate">{bot.name}</span>
        </Button>
      </header>

      {/* The key gives each bot its own chat state, such as the draft. */}
      <Chat key={botId} botId={botId} botName={bot.name} />
    </section>
  );

  const detailsContent = (
    <>
      <header className="window-drag flex h-13 shrink-0 items-center justify-end px-3">
        <Button variant="secondary" size="icon" aria-label="Close details" className="rounded-full" onClick={toggleDetails}>
          <XIcon />
        </Button>
      </header>

      {detailsMounted && (
        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pb-4">
          <BotIdentity key={botId} bot={bot} />
          <BrowserPane key={`browser-${botId}`} botId={botId} botName={bot.name} />
          <ProjectPicker bot={bot} />
          <ModelPicker bot={bot} />
          <Routines botId={botId} />
          <BotInstructions key={`instructions-${botId}`} bot={bot} />
        </div>
      )}
    </>
  );

  // On a narrow window the pane has no column. It slides over the chat.
  if (!wide) {
    return (
      <div onTransitionEnd={finishTransition} className="relative h-full min-h-0 overflow-hidden">
        {chat}

        <aside
          id="bot-details"
          inert={!detailsOpen}
          className={`absolute inset-y-0 right-0 w-full overflow-hidden bg-background transition-[translate,opacity] duration-300 ease-drawer motion-reduce:duration-200 sm:w-72 ${
            detailsOpen ? "" : "translate-x-full motion-reduce:translate-x-0 motion-reduce:opacity-0"
          }`}
        >
          <div className="flex h-full w-full flex-col border-l">{detailsContent}</div>
        </aside>
      </div>
    );
  }

  return (
    // On a wide window the pane is a column that grows, so the chat makes room at the same pace.
    <ResizablePanelGroup
      onTransitionEnd={finishTransition}
      className={animating ? "*:transition-[flex-grow] *:duration-300 *:ease-drawer" : ""}
    >
      <ResizablePanel id="chat" minSize={360}>
        {chat}
      </ResizablePanel>
      <ResizableHandle
        disabled={!detailsOpen}
        disableDoubleClick
        onDoubleClick={resetDetailsWidth}
        className={detailsOpen ? "" : "invisible"}
      />
      {/* The pane keeps its width in pixels when the window changes size. */}
      <ResizablePanel
        id="details"
        panelRef={details}
        collapsible
        collapsedSize={0}
        defaultSize={detailsOpen ? detailsWidth.current : 0}
        minSize={256}
        maxSize={560}
        groupResizeBehavior="preserve-pixel-size"
        onResize={followDetailsWidth}
      >
        <aside id="bot-details" inert={!detailsOpen} className="h-full w-full overflow-hidden bg-background">
          {/* While the column grows or shrinks, the content keeps its width, so it does not reflow on each frame. */}
          <div className="flex h-full flex-col" style={{ width: animating ? detailsWidth.current : "100%" }}>
            {detailsContent}
          </div>
        </aside>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
