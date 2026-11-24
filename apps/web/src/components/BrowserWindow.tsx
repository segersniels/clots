import { Character } from "@clots/character";
import type { BotSummary } from "@clots/contracts";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon, LockIcon, PlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

import { ProgressLine } from "./UpdateControl.tsx";

/** One tab of the bot's browser, as the stream lists it. */
export interface BrowserTab {
  readonly tabId: string;
  readonly targetId: string;
  readonly title: string;
  readonly url: string;
  readonly active: boolean;
}

/** The height of the tab strip and of the toolbar, and the margin around the page, in pixels. */
const TAB_STRIP_HEIGHT = 40;
const TOOLBAR_HEIGHT = 52;
const VIEWPORT_MARGIN = 10;

/** The narrowest window, so the toolbar fits. A tall page then fits by its height, in the middle of the window. */
const MIN_WINDOW_WIDTH = 520;

/** How long the copy button shows its check after a copy. */
const COPIED_MS = 1500;

/** Marks an element that handles Escape itself, so Escape there does not give the screen back. */
export const OWN_ESCAPE = { "data-own-escape": "" };

/** Splits an address into the parts that the address bar shows: the host stands out, the rest is muted. */
function splitAddress(address: string) {
  try {
    const url = new URL(address);

    if (!url.protocol.startsWith("http")) return { secure: false, host: address, rest: "" };

    return {
      secure: url.protocol === "https:",
      host: url.host,
      rest: `${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`,
    };
  } catch {
    return { secure: false, host: address, rest: "" };
  }
}

/** Turns what the operator typed into an address. A bare host such as `example.com` gets `https://`. */
function toAddress(typed: string) {
  const trimmed = typed.trim();

  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Shows the bot's screen as a browser window: tabs, a toolbar and the page, which takes the operator's input. */
export function BrowserWindow({
  botName,
  open,
  onOpenChange,
  frameRatio,
  initialFocus,
  children,
}: {
  botName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  frameRatio: number;
  initialFocus: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const chrome = TAB_STRIP_HEIGHT + TOOLBAR_HEIGHT + 2 * VIEWPORT_MARGIN;
  // The page may take the height that is left 44 px from the top and the bottom of the app window.
  const pageMaxHeight = `calc(100dvh - 5.5rem - ${chrome}px)`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next, details) => {
        const ownsEscape = document.activeElement?.closest("[data-own-escape]") != null;

        // Sites need Escape for their own popups, so Escape on the page or in the address bar keeps the window.
        if (!next && details.reason === "escape-key" && ownsEscape) {
          details.cancel();

          return;
        }

        onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={initialFocus}
        overlayClassName="supports-backdrop-filter:backdrop-blur-[3px]"
        // The largest window that fits 44 px from the top and 40 px from the sides and keeps the page's shape, so a click maps to the right spot.
        style={
          {
            "--page-max-height": pageMaxHeight,
            width: `min(calc(100vw - 5rem), max(${MIN_WINDOW_WIDTH}px, calc(${pageMaxHeight} * ${frameRatio} + ${2 * VIEWPORT_MARGIN}px)))`,
          } as CSSProperties
        }
        // A new page shape eases the width, so the window does not jump when the first frame arrives.
        className="flex max-w-none flex-col gap-0 overflow-hidden rounded-2xl bg-popover p-0 sm:max-w-none motion-safe:[transition:width_200ms_var(--ease-out)]"
      >
        <DialogTitle className="sr-only">{botName}'s screen</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Lists the tabs of the bot's browser. A click switches the bot's tab. */
export function BrowserTabStrip({
  tabs,
  onSelect,
  onNew,
  onClose,
}: {
  tabs: ReadonlyArray<BrowserTab>;
  onSelect: (tab: BrowserTab) => void;
  onNew: () => void;
  onClose: (tab: BrowserTab) => void;
}) {
  return (
    <div className="flex h-10 items-end gap-1 bg-[color-mix(in_oklab,var(--muted)_55%,var(--popover))] px-2.5">
      <div className="flex min-w-0 items-end gap-1" role="tablist">
        {tabs.map((tab) => (
          <div
            key={tab.tabId}
            className={`group/tab flex h-8 max-w-[220px] min-w-0 items-center rounded-t-[10px] text-[13px] transition-colors duration-150 ${
              tab.active ? "bg-popover text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.active}
              title={tab.title || tab.url}
              onClick={() => onSelect(tab)}
              // Without a close button next to it, the name gets the same room on both sides.
              className={`flex h-full min-w-0 items-center gap-2 pl-3 outline-none ${tabs.length > 1 ? "pr-1" : "pr-3"}`}
            >
              {/* The stream sends no favicon, so a dot stands in for it. */}
              <span className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
              <span className="truncate">{tab.title || splitAddress(tab.url).host}</span>
            </button>
            {/* The last tab stays: a window without a page has nothing to take over. */}
            {tabs.length > 1 && (
              <Button variant="ghost" size="icon-xs" aria-label={`Close ${tab.title || "tab"}`} title="Close tab" className="mr-1 shrink-0" onClick={() => onClose(tab)}>
                <XIcon />
              </Button>
            )}
          </div>
        ))}
      </div>
      {/* The tabs sit on the bottom edge. The margin puts the + on the same middle line as their names. */}
      <Button variant="ghost" size="icon-xs" aria-label="New tab" title="New tab" className="mb-1 shrink-0 text-muted-foreground" onClick={onNew}>
        <PlusIcon />
      </Button>
    </div>
  );
}

/** Holds the buttons and the address bar above the page. */
export function BrowserToolbar({ children }: { children: ReactNode }) {
  return <div className="flex h-[52px] items-center gap-1.5 px-2.5">{children}</div>;
}

/** Back, Forward, and Reload, which becomes Stop while a page loads. */
export function BrowserNavigation({
  loading,
  onNavigate,
}: {
  loading: boolean;
  onNavigate: (action: "back" | "forward" | "reload" | "stop") => void;
}) {
  return (
    <div className="flex items-center [&_svg]:size-[17px]">
      <Button variant="ghost" size="icon" aria-label="Back" title="Back" onClick={() => onNavigate("back")}>
        <ChevronLeftIcon />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Forward" title="Forward" onClick={() => onNavigate("forward")}>
        <ChevronRightIcon />
      </Button>
      {loading ? (
        <Button variant="ghost" size="icon" aria-label="Stop" title="Stop" onClick={() => onNavigate("stop")}>
          <XIcon />
        </Button>
      ) : (
        <Button variant="ghost" size="icon" aria-label="Reload" title="Reload" onClick={() => onNavigate("reload")}>
          <RotateCwIcon />
        </Button>
      )}
    </div>
  );
}

/** Shows the page's address. A click turns it into a field: Enter opens what the operator typed, Escape keeps the address. */
export function AddressBar({ address, loading, onOpen }: { address: string; loading: boolean; onOpen: (address: string) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { secure, host, rest } = splitAddress(address);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), COPIED_MS);

    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
  };

  const finish = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && typed !== null && typed.trim() !== "") onOpen(toAddress(typed));

    if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
  };

  return (
    <div
      className={`relative flex h-[34px] min-w-0 flex-1 items-center gap-2 rounded-full pr-1 pl-3 transition-[background-color,box-shadow] duration-150 ${
        typed === null ? "bg-muted/60" : "bg-popover ring-2 ring-attention"
      }`}
    >
      <LockIcon className={`size-3.5 shrink-0 text-muted-foreground ${secure ? "" : "invisible"}`} />

      {typed === null ? (
        <>
          <button
            type="button"
            onClick={() => setTyped(address)}
            aria-label="Address"
            className="min-w-0 flex-1 truncate text-left text-sm"
          >
            <span className="text-foreground">{host}</span>
            <span className="text-muted-foreground">{rest}</span>
          </button>
          {address !== "" && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy link"
                title="Copy link"
                className="size-[26px] rounded-full"
                onClick={() => void copy()}
              >
                {copied ? <CheckIcon className="text-attention" /> : <CopyIcon />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open in your browser"
                title="Open in your browser"
                className="size-[26px] rounded-full"
                render={<a href={address} target="_blank" rel="noreferrer" />}
              >
                <ExternalLinkIcon />
              </Button>
            </>
          )}
        </>
      ) : (
        <input
          {...OWN_ESCAPE}
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={finish}
          onBlur={() => setTyped(null)}
          aria-label="Address"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent pr-2 text-sm outline-none"
        />
      )}

      {/* The line creeps while a page loads, because the stream tells when a navigation starts and ends, not how far it got. */}
      {loading && <ProgressLine from={0.1} to={0.85} durationMs={8000} />}
    </div>
  );
}

/** Ends the take-over. The bot's character hops, because it waits for its screen. */
export function GiveBackButton({ bot }: { bot: BotSummary }) {
  return (
    <DialogClose
      render={
        <Button
          variant="ghost"
          aria-label={`Give the screen back to ${bot.name}`}
          title={`Give the screen back to ${bot.name}`}
          className="h-[34px] shrink-0 gap-1.5 rounded-full bg-muted/60 pr-3.5 pl-2 font-medium hover:bg-muted"
        />
      }
    >
      <Character shape={bot.shape} color={bot.color} mood="waiting" size={20} />
      Give back
    </DialogClose>
  );
}

/** Frames the page under the toolbar. The ring tells that clicks and keys go to the page. */
export function BrowserViewport({
  botName,
  frameRatio,
  live,
  children,
}: {
  botName: string;
  frameRatio: number;
  /** Is `true` once frames arrive, so the operator's clicks and keys reach the page. */
  live: boolean;
  children: ReactNode | null;
}) {
  return (
    // The frame hugs the page, so a tall page sits in the middle of the window with the ring around it.
    <div className="mx-2.5 mb-2.5 flex justify-center">
      <div
        className={`max-w-full overflow-hidden rounded-[10px] transition-[box-shadow] duration-200 ease-out ${live ? "ring-2 ring-attention" : "w-full ring-1 ring-border"}`}
      >
        {/* Before the first frame, the window shows that it connects instead of an empty box. */}
        {children ?? (
          <div
            className="flex max-h-(--page-max-height) w-full items-center justify-center gap-2 text-muted-foreground"
            style={{ aspectRatio: frameRatio }}
          >
            <Spinner />
            Connecting to {botName}'s screen
          </div>
        )}
      </div>
    </div>
  );
}
