import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Character, type Gaze } from "@clots/character";
import type { BotSummary, MessageHit } from "@clots/contracts";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import { ArrowUpIcon, FolderPlusIcon, GaugeIcon, MonitorIcon, MoonIcon, PlusIcon, SearchIcon, SunIcon, UserRoundPlusIcon, type LucideIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { client, useStore } from "@/client.ts";
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { setTheme } from "@/lib/color-scheme.ts";
import { formatRecent } from "@/time.ts";

/** The shortcuts use Command on a Mac and Control elsewhere. */
const ON_MAC = navigator.userAgent.includes("Mac");

const MODIFIER = ON_MAC ? "⌘" : "Ctrl ";

/** The thread search starts from this many characters, and shows at most this many lines. */
const THREAD_QUERY_MIN = 2;

const THREAD_HITS = 4;

/** How long the thread search waits for the typing to pause. */
const THREAD_SEARCH_DELAY_MS = 150;

/** How far into a line a match may start before the line loses its beginning. */
const LINE_LEAD = 36;

/** How many characters before the match a cut line keeps. */
const LINE_CONTEXT = 24;

/** How many bots have a shortcut: ⌘1 to ⌘9. */
const SHORTCUT_COUNT = 9;

/** Where the clot of the selected bot looks: up at the field, a bit to the left. */
const LOOK_AT_FIELD: Gaze = { x: -0.18, y: -0.93 };

/** The color of a status line that waits for the operator: the warn color of a usage limit near its end. */
const WAITING_TEXT = "text-[#b07610] dark:text-[#f5a524]";

const KBD = "shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-sans text-[11.5px] text-muted-foreground";

/** The floating panel of the search and of the New dialog: it scales in under the top of the window. */
const POPUP =
  "fixed top-[92px] left-1/2 z-50 flex w-[600px] max-w-[calc(100%-2rem)] -translate-x-1/2 origin-top flex-col overflow-hidden rounded-[20px] bg-popover text-sm text-popover-foreground shadow-2xl ring-1 ring-foreground/9 outline-none transition-[opacity,scale] duration-160 ease-out data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-ending-style:duration-120 data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-instant:transition-none motion-reduce:data-ending-style:scale-100 motion-reduce:data-starting-style:scale-100";

/** One row of a result list. The keys and the pointer both highlight it. */
export const ROW =
  "group flex min-h-11 cursor-default items-center gap-3 rounded-[14px] px-3 py-2 outline-none select-none data-highlighted:bg-[#ececed] dark:data-highlighted:bg-[#2a2a2d]";

/** What the search can do besides opening a bot. The sidebar owns the dialogs and menus that these open. */
export interface SearchCommands {
  newBot: (name?: string) => void;
  newProject: () => void;
  checkForUpdates: () => void;
  openAccount: () => void;
}

interface SearchAction {
  readonly id: string;
  readonly label: string;
  /** More words that find the action, besides its label. */
  readonly keywords: ReadonlyArray<string>;
  readonly icon: LucideIcon;
  readonly run: () => void;
  readonly hint?: string;
}

type SearchItem =
  | { readonly kind: "bot"; readonly id: string; readonly bot: BotSummary; readonly shortcut: number | undefined }
  | { readonly kind: "message"; readonly id: string; readonly hit: MessageHit; readonly bot: BotSummary }
  | { readonly kind: "action"; readonly id: string; readonly action: SearchAction };

interface SearchGroup {
  /** The group label. The single row of an empty result has none. */
  readonly value: string;
  readonly items: ReadonlyArray<SearchItem>;
}

/** Puts the bots in the order of their last message, which the search and the shortcuts share. */
const byRecent = (bots: ReadonlyArray<BotSummary>) => bots.toSorted((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

/** Lists the actions of the search. The theme actions also match on "mode" and "appearance". */
const actionsFor = (commands: SearchCommands): ReadonlyArray<SearchAction> => [
  { id: "new-bot", label: "New bot", keywords: ["create", "add"], icon: PlusIcon, run: () => commands.newBot() },
  { id: "new-project", label: "New project", keywords: ["create", "add", "folder"], icon: FolderPlusIcon, run: commands.newProject },
  { id: "theme-dark", label: "Theme: Dark", keywords: ["mode", "appearance"], icon: MoonIcon, run: () => setTheme("dark") },
  { id: "theme-light", label: "Theme: Light", keywords: ["mode", "appearance"], icon: SunIcon, run: () => setTheme("light") },
  { id: "theme-system", label: "Theme: System", keywords: ["mode", "appearance"], icon: MonitorIcon, run: () => setTheme("system") },
  { id: "updates", label: "Check for updates", keywords: ["version", "upgrade"], icon: ArrowUpIcon, run: commands.checkForUpdates },
  { id: "usage", label: "Usage and plan", keywords: ["limits", "account"], icon: GaugeIcon, run: commands.openAccount },
];

/**
 * Opens the search with ⌘K or ⌘F, the New dialog with ⌘N, and the first nine bots of the search with
 * ⌘1 to ⌘9, in the order of their last message. The bot shortcuts work while the search is closed too.
 */
export function useSearchShortcuts({ onToggle, onNew, onBotOpened }: { onToggle: () => void; onNew: () => void; onBotOpened: () => void }) {
  const navigate = useNavigate();
  const bots = useStore(client.bots);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(ON_MAC ? event.metaKey : event.ctrlKey) || event.shiftKey || event.altKey) return;

      const key = event.key.toLowerCase();

      if (key === "k" || key === "f") {
        event.preventDefault();
        onToggle();

        return;
      }

      if (key === "n") {
        event.preventDefault();
        onNew();

        return;
      }

      const place = Number(event.key);
      const bot = Number.isInteger(place) && place >= 1 ? byRecent(bots)[place - 1] : undefined;

      if (bot === undefined) return;

      event.preventDefault();
      void navigate({ to: "/bots/$botId", params: { botId: bot.id } });
      onBotOpened();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  });
}

/**
 * Asks the server for thread messages that match the query once the typing pauses. The last
 * results stay until the new ones arrive, so the list does not flicker.
 */
function useMessageHits(query: string) {
  const [hits, setHits] = useState<ReadonlyArray<MessageHit>>([]);
  const searchable = query.length >= THREAD_QUERY_MIN;

  useEffect(() => {
    if (!searchable) return;

    let current = true;
    const timer = setTimeout(
      () => void client.searchMessages(query, THREAD_HITS).then((found) => current && setHits(found), () => undefined),
      THREAD_SEARCH_DELAY_MS,
    );

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  return searchable ? hits : [];
}

/** Picks the line of a message that holds the match, as plain text, and cuts its start so the match stays in view. */
const matchLine = (text: string, term: string) => {
  const lines = text.split("\n");
  const line = (lines.find((candidate) => candidate.toLowerCase().includes(term)) ?? lines[0] ?? "")
    .replaceAll(/[#*_`>]+/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
  const start = line.toLowerCase().indexOf(term);

  if (start <= LINE_LEAD) return line;

  return `…${line.slice(start - LINE_CONTEXT)}`;
};

/** Shows the part of a text that matches the query in a stronger weight. */
function Highlight({ text, query }: { text: string; query: string }) {
  const start = query === "" ? -1 : text.toLowerCase().indexOf(query);

  if (start < 0) return <>{text}</>;

  return (
    <>
      {text.slice(0, start)}
      <mark className="bg-transparent font-semibold text-foreground">{text.slice(start, start + query.length)}</mark>
      {text.slice(start + query.length)}
    </>
  );
}

/** Grows and shrinks with the results, up to a height from which they scroll. */
function ResultsArea({ children }: { children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const element = content.current!;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      className="max-h-[470px] overflow-y-auto [scrollbar-width:none] transition-[height] duration-180 ease-out motion-reduce:transition-none"
      style={{ height }}
    >
      <div ref={content}>{children}</div>
    </div>
  );
}

/** One bot: its live clot, its name and project, and its status line. */
function BotResult({ item, query, projectName, highlighted }: { item: Extract<SearchItem, { kind: "bot" }>; query: string; projectName: string | undefined; highlighted: boolean }) {
  const { bot, shortcut } = item;

  return (
    <>
      <Character shape={bot.shape} color={bot.color} mood={bot.status} size={34} gaze={highlighted && bot.status === "idle" ? LOOK_AT_FIELD : undefined} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate font-medium">
            <Highlight text={bot.name} query={query} />
          </span>
          {projectName !== undefined && (
            <span className="shrink-0 text-[12.5px] text-muted-foreground">
              <Highlight text={projectName} query={query} />
            </span>
          )}
        </span>
        <span className={cn("block truncate text-[13px]", bot.status === "waiting" ? WAITING_TEXT : "text-muted-foreground")}>{bot.statusLine}</span>
      </span>
      {shortcut !== undefined && (
        <kbd className={KBD}>
          {MODIFIER}
          {shortcut}
        </kbd>
      )}
    </>
  );
}

/** One thread message: the bot's small clot and name, the line with the match, and when it was sent. */
function MessageResult({ item, query }: { item: Extract<SearchItem, { kind: "message" }>; query: string }) {
  // The server matches each word as a word start, so a query of several words may not be in the text as a whole.
  const term = item.hit.text.toLowerCase().includes(query) ? query : (query.split(" ")[0] ?? query);

  return (
    <>
      <span className="flex size-[34px] shrink-0 items-center justify-center">
        <Character shape={item.bot.shape} color={item.bot.color} size={26} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{item.bot.name}</span>
        <span className="block truncate text-[13px] text-muted-foreground">
          <Highlight text={matchLine(item.hit.text, term)} query={term} />
        </span>
      </span>
      <span className="shrink-0 text-[12.5px] text-muted-foreground">{formatRecent(item.hit.createdAt)}</span>
    </>
  );
}

/** One action: its icon in a round chip and its label. */
function ActionResult({ action }: { action: SearchAction }) {
  const Icon = action.icon;

  return (
    <>
      <span className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground group-data-highlighted:text-foreground">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{action.label}</span>
      {action.hint !== undefined && <kbd className={KBD}>{action.hint}</kbd>}
    </>
  );
}

/** The field and the results. It mounts with the dialog, so each open starts with an empty query. */
function SearchPanel({ commands, onSelect }: { commands: SearchCommands; onSelect: (item: SearchItem) => void }) {
  const bots = useStore(client.bots);
  const projects = useStore(client.projects);
  const [query, setQuery] = useState("");
  const [highlightedId, setHighlightedId] = useState<string>();
  const needle = query.trim().toLowerCase();
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const projectOf = (bot: BotSummary) => (bot.projectId === null ? undefined : projectNames.get(bot.projectId));
  const matches = (text: string | undefined) => text !== undefined && text.toLowerCase().includes(needle);
  const botsById = new Map(bots.map((bot) => [bot.id, bot]));
  const hits = useMessageHits(needle);

  const botItems: ReadonlyArray<SearchItem> = byRecent(bots)
    .filter((bot) => needle === "" || matches(bot.name) || matches(projectOf(bot)))
    .map((bot, index) => ({
      kind: "bot",
      id: bot.id,
      bot,
      shortcut: needle === "" && index < SHORTCUT_COUNT ? index + 1 : undefined,
    }));

  const messageItems: ReadonlyArray<SearchItem> = hits.flatMap((hit) => {
    const bot = botsById.get(hit.botId);

    return bot === undefined ? [] : [{ kind: "message", id: `message-${hit.messageId}`, hit, bot }];
  });

  // Actions show only for a query, so the empty search is a plain list of bots.
  const actionItems: ReadonlyArray<SearchItem> =
    needle === ""
      ? []
      : actionsFor(commands)
          .filter((action) => matches(action.label) || action.keywords.some(matches))
          .map((action) => ({ kind: "action", id: action.id, action }));

  const groups: ReadonlyArray<SearchGroup> = [
    { value: "Bots", items: botItems },
    { value: "In threads", items: messageItems },
    { value: "Actions", items: actionItems },
  ].filter((group) => group.items.length > 0);
  const empty = groups.length === 0;

  // Nothing matches, so the one row left makes a bot of the query.
  const createRow: SearchAction = {
    id: "new-bot-named",
    label: `New bot named “${query.trim()}”`,
    keywords: [],
    icon: PlusIcon,
    run: () => commands.newBot(query.trim()),
    hint: "↵",
  };
  const shownGroups = empty ? [{ value: "", items: [{ kind: "action", id: createRow.id, action: createRow } as const] }] : groups;

  return (
    <Autocomplete.Root
      inline
      open
      mode="none"
      autoHighlight="always"
      keepHighlight
      items={shownGroups}
      value={query}
      onValueChange={setQuery}
      onItemHighlighted={(item) => setHighlightedId(item?.id)}
      itemToStringValue={(item) => item.id}
    >
      <div className="flex h-[60px] shrink-0 items-center gap-3 pr-[18px] pl-5">
        <SearchIcon className="size-[19px] shrink-0 text-muted-foreground" />
        <Autocomplete.Input
          aria-label="Search"
          placeholder="Search bots, threads and actions"
          className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-muted-foreground"
        />
        <kbd className={KBD}>esc</kbd>
      </div>
      <ResultsArea>
        {empty && (
          <div className="flex flex-col items-center gap-3 pt-4 pb-4">
            <Character shape="puddle" color="gray" size={64} />
            <p className="text-muted-foreground">No results for “{query.trim()}”</p>
          </div>
        )}
        <Autocomplete.List className="px-2 pb-2">
          {(group: SearchGroup) => (
            <Autocomplete.Group key={group.value} items={group.items}>
              {group.value !== "" && (
                <Autocomplete.GroupLabel className="px-3 pt-1.5 pb-1 text-[12.5px] text-muted-foreground">{group.value}</Autocomplete.GroupLabel>
              )}
              <Autocomplete.Collection>
                {(item: SearchItem) => (
                  <Autocomplete.Item
                    key={item.id}
                    value={item}
                    onClick={() => onSelect(item)}
                    className={ROW}
                  >
                    {item.kind === "bot" && (
                      <BotResult item={item} query={needle} projectName={projectOf(item.bot)} highlighted={item.id === highlightedId} />
                    )}
                    {item.kind === "message" && <MessageResult item={item} query={needle} />}
                    {item.kind === "action" && <ActionResult action={item.action} />}
                  </Autocomplete.Item>
                )}
              </Autocomplete.Collection>
            </Autocomplete.Group>
          )}
        </Autocomplete.List>
      </ResultsArea>
    </Autocomplete.Root>
  );
}

/**
 * Searches the bots and the actions of clots. A bot opens at once. An action runs after the dialog
 * has closed, so a dialog or a menu that it opens takes the focus from here. A search that the
 * keyboard opened shows and goes without motion, because a shortcut is used many times a day.
 */
export function SearchDialog({
  open,
  onOpenChange,
  instant,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instant: boolean;
  commands: SearchCommands;
}) {
  const navigate = useNavigate();
  const pendingAction = useRef<() => void>(undefined);

  const select = (item: SearchItem) => {
    if (item.kind === "action") pendingAction.current = item.action.run;
    else void navigate({ to: "/bots/$botId", params: { botId: item.bot.id }, search: item.kind === "message" ? { message: item.hit.messageId } : {} });

    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) return;

        pendingAction.current?.();
        pendingAction.current = undefined;
      }}
    >
      <DialogPortal>
        <DialogOverlay className={cn(instant && "data-open:animate-none data-closed:animate-none")} />
        <DialogPrimitive.Popup data-instant={instant || undefined} className={POPUP}>
          <DialogTitle className="sr-only">Search</DialogTitle>
          <SearchPanel commands={commands} onSelect={select} />
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}

/**
 * Offers what the operator can make: a bot or a project. The + in the sidebar and ⌘N open it. The
 * arrow keys move the highlight, Enter picks, and the picked dialog opens once this one has closed.
 */
export function NewDialog({ open, onOpenChange, commands }: { open: boolean; onOpenChange: (open: boolean) => void; commands: SearchCommands }) {
  const choices = [
    { label: "New bot", icon: UserRoundPlusIcon, run: () => commands.newBot() },
    { label: "New project", icon: FolderPlusIcon, run: commands.newProject },
  ];
  const [highlighted, setHighlighted] = useState(0);
  const picked = useRef<() => void>(undefined);

  const pick = (run: () => void) => {
    picked.current = run;
    onOpenChange(false);
  };

  const moveHighlight = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length);
    }

    if (event.key === "Enter") {
      event.preventDefault();
      pick(choices[highlighted]!.run);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        // Each open starts on the first choice.
        if (isOpen) return setHighlighted(0);

        picked.current?.();
        picked.current = undefined;
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Popup className={POPUP} onKeyDown={moveHighlight}>
          <DialogTitle className="sr-only">New</DialogTitle>
          <div role="listbox" aria-label="New" className="p-2">
            {choices.map((choice, index) => (
              <div
                key={choice.label}
                role="option"
                aria-selected={index === highlighted}
                data-highlighted={index === highlighted || undefined}
                onMouseMove={() => setHighlighted(index)}
                onClick={() => pick(choice.run)}
                className={ROW}
              >
                <ActionResult action={{ id: choice.label, label: choice.label, keywords: [], icon: choice.icon, run: choice.run }} />
              </div>
            ))}
          </div>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
