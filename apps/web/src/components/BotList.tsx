import { Character } from "@clots/character";
import type { BotId, BotSummary, Project } from "@clots/contracts";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ChevronDownIcon, FolderPlusIcon, PencilLineIcon, PlusIcon, SearchIcon, UserRoundPlusIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useMediaQuery } from "@/hooks/use-media-query";

import { client, useStore } from "../client.ts";
import { hasContent, useDraft, type Draft } from "../drafts.ts";
import { formatRecent } from "../time.ts";
import { BotMenu } from "./BotMenu.tsx";
import { Collapse } from "./Collapse.tsx";
import { ProjectMenu } from "./ProjectMenu.tsx";

/** The drag data type that carries the id of a bot. Other drags, such as files, do not have it. */
const BOT_DRAG_TYPE = "application/x-clots-bot";

const EMPTY_HINT = "px-2.5 py-1.5 text-[0.8125rem] text-muted-foreground/70";

/** Keeps the bot rows apart from each other and from the heading above them. */
const BOT_ROWS = "flex flex-col gap-1 pt-1";

/** Takes a dragged bot and moves it to a project, or to no project when `projectId` is `null`. */
function BotDropZone({ projectId, children }: { projectId: string | null; children: ReactNode }) {
  const [over, setOver] = useState(false);

  const allowDrop = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes(BOT_DRAG_TYPE)) return;

    // Without this, the browser refuses the drop.
    event.preventDefault();
    setOver(true);
  };

  const leave = (event: DragEvent<HTMLElement>) => {
    // The event also fires when the pointer moves onto a child of the zone.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
  };

  const drop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);

    const botId = event.dataTransfer.getData(BOT_DRAG_TYPE) as BotId;
    void client.setBotProject(botId, projectId);
  };

  return (
    <section
      onDragOver={allowDrop}
      onDragLeave={leave}
      onDrop={drop}
      className={`rounded-xl transition-colors duration-150 ${over ? "bg-sidebar-accent/60 outline-1 outline-ring" : ""}`}
    >
      {children}
    </section>
  );
}

/**
 * Is `true` once the list showed for the first time. A row that mounts later is a new bot or a bot
 * that moved to another project, so it eases in at its new place.
 */
let listHasShown = false;

/** Edits the name of a bot or a project in place. Enter or a click elsewhere saves the name, and Escape keeps the old one. */
function RenameField({
  name: savedName,
  label,
  ref,
  onSave,
  onDone,
  className = "",
}: {
  name: string;
  label: string;
  ref: RefObject<HTMLInputElement | null>;
  onSave: (name: string) => void;
  onDone: () => void;
  className?: string;
}) {
  const [name, setName] = useState(savedName);
  const cancelled = useRef(false);

  const finish = () => {
    const trimmed = name.trim();

    // A bot or a project always has a name, so an empty field keeps the saved one.
    if (!cancelled.current && trimmed !== "" && trimmed !== savedName) onSave(trimmed);

    onDone();
  };

  return (
    <Input
      ref={ref}
      value={name}
      onChange={(event) => setName(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={finish}
      onKeyDown={(event) => {
        if (event.key === "Escape") cancelled.current = true;
        if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
      }}
      aria-label={label}
      className={`-mx-1 h-5 flex-1 rounded-md border-0 px-1 py-0 select-text ${className} md:text-[length:inherit] text-[length:inherit] focus-visible:ring-2 dark:bg-transparent`}
    />
  );
}

/** Where an idle clot looks when it glances down at its draft. */
const DRAFT_GAZE = { x: 0.7, y: 1 };

/** Hides one of the two lines that share the place under the bot name. */
const LINE_HIDDEN = "pointer-events-none translate-y-1 opacity-0 motion-reduce:translate-y-0";

/** Describes a draft in one line, for example "can you also check · 2 files". */
function describeDraft({ text, fileCount }: Draft) {
  const files = fileCount === 1 ? "1 file" : `${fileCount} files`;

  if (text.trim() === "") return files;

  return fileCount > 0 ? `${text.trim()} · ${files}` : text.trim();
}

/**
 * Makes a clot glance down at its draft now and then, as if it reads what the operator started.
 * It looks down for a bit more than half of each cycle of about four seconds.
 */
function useGlance(active: boolean) {
  const [glancing, setGlancing] = useState(false);

  useEffect(() => {
    if (!active) return;

    let timer: ReturnType<typeof setTimeout>;
    const lookDown = () => {
      setGlancing(true);
      timer = setTimeout(lookUp, 2300);
    };
    const lookUp = () => {
      setGlancing(false);
      timer = setTimeout(lookDown, 1900);
    };

    // Each row starts at its own moment, so the clots do not glance in step.
    timer = setTimeout(lookDown, Math.random() * 4200);

    return () => clearTimeout(timer);
  }, [active]);

  return active && glancing;
}

function BotRow({ bot }: { bot: BotSummary }) {
  const [entersLate] = useState(listHasShown);
  const [renaming, setRenaming] = useState(false);
  const renameField = useRef<HTMLInputElement>(null);
  const openBotId = useParams({ strict: false }).botId;
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const draft = useDraft(bot.id);

  // A bot that needs the operator keeps its status line. The open bot already shows its draft in the composer.
  const showDraft = hasContent(draft) && bot.id !== openBotId && bot.status !== "waiting";
  const glancing = useGlance(showDraft && bot.status === "idle" && !reduceMotion);

  useEffect(() => {
    listHasShown = true;
  }, []);

  return (
    <BotMenu bot={bot} onRename={() => setRenaming(true)} renameField={renameField}>
      {/* While the name is in edit, a click in the field must not open the bot. */}
      <Link
        to="/bots/$botId"
        params={{ botId: bot.id }}
        disabled={renaming}
        draggable={!renaming}
        onDragStart={(event) => {
          event.dataTransfer.setData(BOT_DRAG_TYPE, bot.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-[color,opacity,translate] duration-200 ease-out ${
          entersLate ? "starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0" : ""
        }`}
        activeProps={{ className: "bg-sidebar-accent" }}
      >
        <Character shape={bot.shape} color={bot.color} mood={bot.status} size={32} gaze={glancing ? DRAFT_GAZE : undefined} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            {renaming ? (
              <RenameField
                ref={renameField}
                name={bot.name}
                label="Bot name"
                onSave={(name) => void client.updateBot(bot.id, { name })}
                onDone={() => setRenaming(false)}
                className="font-medium"
              />
            ) : (
              <span className={`min-w-0 flex-1 truncate ${bot.unread ? "font-semibold" : "font-medium"}`}>{bot.name}</span>
            )}
            {bot.lastMessageAt !== null && (
              <span className="shrink-0 text-[0.6875rem] text-muted-foreground">{formatRecent(bot.lastMessageAt)}</span>
            )}
          </span>
          <span className="flex items-center gap-2">
            {/* The status line and the draft share one place under the name and fade into each other. */}
            <span className="grid min-w-0 flex-1 text-[0.8125rem] *:col-start-1 *:row-start-1">
              <span
                aria-hidden={showDraft}
                className={`truncate transition-[opacity,translate] duration-200 ease-out ${
                  bot.status === "working" && !showDraft ? "animate-pulse motion-reduce:animate-none" : "text-muted-foreground"
                } ${showDraft ? LINE_HIDDEN : ""}`}
              >
                {bot.statusLine}
              </span>
              <span
                aria-hidden={!showDraft}
                className={`flex min-w-0 items-center gap-1.5 transition-[opacity,translate] duration-200 ease-out ${showDraft ? "" : LINE_HIDDEN}`}
              >
                <span className="inline-flex shrink-0 items-center gap-0.5 font-medium text-draft">
                  <PencilLineIcon className="size-3" />
                  Draft
                </span>
                <span className="min-w-0 truncate text-muted-foreground">{draft && describeDraft(draft)}</span>
              </span>
            </span>
            {/* The dot marks a bot that waits for the operator, or that the operator marked as unread. */}
            {(bot.status === "waiting" || bot.unread) && (
              <span className="size-2 shrink-0 rounded-full bg-attention transition-[scale,opacity] duration-200 ease-out starting:scale-0 starting:opacity-0" />
            )}
          </span>
        </span>
      </Link>
    </BotMenu>
  );
}

/** Shows the clones of an orchestrating bot as one closed line, which opens into their rows. */
function CloneGroup({ clones }: { clones: ReadonlyArray<BotSummary> }) {
  const openBotId = useParams({ strict: false }).botId;
  const [open, setOpen] = useState(false);
  // The open bot stays in view, also when it is a clone in a closed group.
  const expanded = open || clones.some((clone) => clone.id === openBotId);
  const working = clones.filter((clone) => clone.status !== "idle").length;

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        className="flex w-full items-center gap-1.5 rounded-lg py-1 pr-2.5 pl-[3.25rem] text-[0.8125rem] text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent"
      >
        <ChevronDownIcon
          className={`size-3.5 transition-[rotate] duration-200 ease-out motion-reduce:transition-none ${expanded ? "" : "-rotate-90"}`}
        />
        {clones.length === 1 ? "1 clone" : `${clones.length} clones`}
        {working > 0 && <span className="text-foreground/70">· {working} working</span>}
      </button>
      <Collapse open={expanded}>
        <div className={`${BOT_ROWS} pl-4`}>
          {clones.map((clone) => (
            <BotRow key={clone.id} bot={clone} />
          ))}
        </div>
      </Collapse>
    </div>
  );
}

/** Lists bots with the clones of each orchestrator grouped under it. A clone whose orchestrator is not in the list stays a plain row. */
function BotRows({ bots }: { bots: ReadonlyArray<BotSummary> }) {
  const listed = new Set(bots.map((bot) => bot.id));
  const grouped = (bot: BotSummary) => bot.clonedFrom !== null && listed.has(bot.clonedFrom);

  return bots
    .filter((bot) => !grouped(bot))
    .map((bot) => {
      const clones = bots.filter((candidate) => candidate.clonedFrom === bot.id);

      return (
        <Fragment key={bot.id}>
          <BotRow bot={bot} />
          {clones.length > 0 && <CloneGroup clones={clones} />}
        </Fragment>
      );
    });
}

/** Shows one project as a header that opens and closes the list of its bots. */
function ProjectSection({ project, bots, botCount }: { project: Project; bots: ReadonlyArray<BotSummary>; botCount: number }) {
  const [open, setOpen] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const renameField = useRef<HTMLInputElement>(null);

  return (
    <BotDropZone projectId={project.id}>
      <ProjectMenu project={project} botCount={botCount} onRename={() => setRenaming(true)} renameField={renameField}>
        {renaming ? (
          <div className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-[0.8125rem]">
            <RenameField
              ref={renameField}
              name={project.name}
              label="Project name"
              onSave={(name) => void client.renameProject(project.id, name)}
              onDone={() => setRenaming(false)}
            />
          </div>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[0.8125rem] text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent"
            title={project.directory ?? undefined}
          >
            <span className="truncate">{project.name}</span>
            <ChevronDownIcon
              className={`size-3.5 transition-[rotate] duration-200 ease-out motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
            />
          </button>
        )}
      </ProjectMenu>

      <Collapse open={open}>
        <div className={BOT_ROWS}>
          <BotRows bots={bots} />
          {bots.length === 0 && <p className={EMPTY_HINT}>Drag Bots here</p>}
        </div>
      </Collapse>
    </BotDropZone>
  );
}

export function BotList() {
  const navigate = useNavigate();
  const bots = useStore(client.bots);
  const projects = useStore(client.projects);
  const connection = useStore(client.connection);
  const [searching, setSearching] = useState(false);
  const [search, setSearch] = useState("");
  const searchField = useRef<HTMLInputElement>(null);
  const shown = bots.filter((bot) => bot.name.toLowerCase().includes(search.trim().toLowerCase()));
  const personal = shown.filter((bot) => bot.projectId === null);

  // The field is always in the page, so it takes the focus when it opens.
  useEffect(() => {
    if (searching) searchField.current?.focus();
  }, [searching]);

  /** Closes the search field and shows all bots again. */
  const stopSearching = () => {
    setSearching(false);
    setSearch("");
  };

  return (
    <nav className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <header className="window-drag window-buttons-inset flex h-13 shrink-0 items-center justify-end gap-1.5 px-3">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Search bots"
          aria-pressed={searching}
          className="rounded-full"
          onClick={() => (searching ? stopSearching() : setSearching(true))}
        >
          <SearchIcon />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="secondary" size="icon" aria-label="New" className="rounded-full" />}>
            <PlusIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem onClick={() => navigate({ to: "/" })}>
              <UserRoundPlusIcon className="text-muted-foreground" />
              New bot
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate({ to: "/projects/new" })}>
              <FolderPlusIcon className="text-muted-foreground" />
              New project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="px-3">
        <Collapse open={searching}>
          <Input
            ref={searchField}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.key === "Escape" && stopSearching()}
            placeholder="Search"
            aria-label="Search bots"
            className="mb-2 rounded-full border-transparent bg-sidebar-accent px-3.5"
          />
        </Collapse>
      </div>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-2 pb-3">
        {projects.map((project) => (
          <ProjectSection
            key={project.id}
            project={project}
            bots={shown.filter((bot) => bot.projectId === project.id)}
            botCount={bots.filter((bot) => bot.projectId === project.id).length}
          />
        ))}

        <BotDropZone projectId={null}>
          {/* Without a project there is one plain list, so the heading would only add noise. */}
          {projects.length > 0 && <h2 className="px-2.5 py-1.5 text-[0.8125rem] text-muted-foreground">Personal</h2>}
          <div className={BOT_ROWS}>
            <BotRows bots={personal} />
            {projects.length > 0 && personal.length === 0 && search === "" && <p className={EMPTY_HINT}>Drag Bots here</p>}
          </div>
        </BotDropZone>

        {bots.length === 0 && <p className="pt-24 text-center text-muted-foreground">No chats yet</p>}
        {bots.length > 0 && shown.length === 0 && <p className="pt-8 text-center text-muted-foreground">No bot matches</p>}
      </div>

      {connection !== "connected" && (
        <footer className="px-5 py-3 text-xs text-muted-foreground">
          {connection === "connecting" ? "Connecting…" : "Disconnected. Trying again…"}
        </footer>
      )}
    </nav>
  );
}
