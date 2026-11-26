import { Character } from "@clots/character";
import type { BotId, BotSummary, Project } from "@clots/contracts";
import {
  closestCenter,
  defaultDropAnimation,
  DndContext,
  DragOverlay,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link, useParams } from "@tanstack/react-router";
import {
  ChevronDownIcon,
  LoaderCircleIcon,
  PencilLineIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { readPaneOpen, savePaneOpen } from "@/lib/pane-width";

import { client, useStore } from "../client.ts";
import { hasContent, useDraft, type Draft } from "../drafts.ts";
import { forgetDeletedThreads } from "../thread-cache.ts";
import { formatRecent } from "../time.ts";
import { BotMenu } from "./BotMenu.tsx";
import { Collapse } from "./Collapse.tsx";
import { NewBotDialog, NewProjectDialog, NoBots } from "./CreateDialog.tsx";
import { AccountMenu } from "./AccountMenu.tsx";
import { UpdatePill, useUpdates } from "./UpdateControl.tsx";
import { ProjectMenu } from "./ProjectMenu.tsx";
import {
  NewDialog,
  SearchDialog,
  useSearchShortcuts,
  type SearchCommands,
} from "./SearchDialog.tsx";

/** The line of an empty group. It sits on the label line, like the empty lines of the details pane. */
const EMPTY_HINT = "px-1 text-sm text-muted-foreground";

/**
 * The label row of a group: 28 px high, with its text on the label line. The hover background reaches
 * past the line, so its padding moves into a negative margin.
 */
const GROUP_LABEL =
  "-mx-1.5 flex h-7 w-[calc(100%+0.75rem)] items-center rounded-lg px-2.5 text-[0.8125rem]";

/** The window width from which the sidebar shows beside the main area. It matches the Tailwind `md` breakpoint. */
const WIDE_WINDOW = "(min-width: 48rem)";

/** Keeps the bot rows apart from each other and from the heading above them. */
const BOT_ROWS = "flex flex-col gap-1 pt-1";

/** The group of the bots without a project. The other groups use their project id. */
const PERSONAL = "personal";

/** The ids of the top-level bot rows of each group, in the order that the sidebar shows them. */
type Groups = Readonly<Record<string, ReadonlyArray<BotId>>>;

/** A top-level row of a group: a bot and the clones that it orchestrates. */
interface Row {
  readonly bot: BotSummary;
  readonly clones: ReadonlyArray<BotSummary>;
}

/** Slides the rows out of the way of a dragged bot, and the dragged copy into its place on the drop. */
const SLIDE = { duration: 250, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };

/** Gives the drop area of a group an id that cannot be the id of a bot. */
const groupDropId = (group: string) => `group:${group}`;

/** Finds the group of a bot row, or of the drop area of a group. */
function groupOf(groups: Groups, id: UniqueIdentifier) {
  const name = String(id);
  if (name.startsWith("group:")) {
    return name.slice("group:".length);
  }

  return Object.keys(groups).find((group) => groups[group]?.includes(name as BotId));
}

/** Takes a dragged bot into a group, also when the group is empty or closed. */
function BotDropZone({
  group,
  highlighted,
  children,
}: {
  group: string;
  highlighted: boolean;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: groupDropId(group) });

  return (
    <section
      ref={setNodeRef}
      className={`rounded-xl transition-colors duration-150 ${highlighted ? "bg-sidebar-accent/60 outline-1 outline-ring" : ""}`}
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
    if (!cancelled.current && trimmed !== "" && trimmed !== savedName) {
      onSave(trimmed);
    }

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
        if (event.key === "Escape") {
          cancelled.current = true;
        }

        if (event.key === "Enter" || event.key === "Escape") {
          event.currentTarget.blur();
        }
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

  if (text.trim() === "") {
    return files;
  }

  return fileCount > 0 ? `${text.trim()} · ${files}` : text.trim();
}

/**
 * Makes a clot glance down at its draft now and then, as if it reads what the operator started.
 * It looks down for a bit more than half of each cycle of about four seconds, while it is mounted.
 */
function DraftGlance({ onGlance }: { onGlance: (glancing: boolean) => void }) {
  useMountEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const lookDown = () => {
      onGlance(true);
      timer = setTimeout(lookUp, 2300);
    };
    const lookUp = () => {
      onGlance(false);
      timer = setTimeout(lookDown, 1900);
    };

    // Each row starts at its own moment, so the clots do not glance in step.
    timer = setTimeout(lookDown, Math.random() * 4200);

    return () => clearTimeout(timer);
  });

  return null;
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
  const dotShown = bot.status === "waiting" || bot.unread;
  // A bot that waits or is unread needs the operator more than a working bot, so the dot wins.
  const spinnerShown = bot.status === "working" && !dotShown;
  // An idle bot with an unread reply calls the operator, as a bot that waits for an answer does.
  const mood = bot.status === "idle" && bot.unread ? "waiting" : bot.status;

  // An unread reply reads like the name above it, so it catches the eye. A working bot pulses instead.
  let statusTone = "text-muted-foreground";
  if (bot.status === "working" && !showDraft) {
    statusTone = "animate-pulse motion-reduce:animate-none";
  } else if (bot.unread) {
    statusTone = "text-foreground";
  }

  const glanceShown = showDraft && mood === "idle" && !reduceMotion;
  const [glancing, setGlancing] = useState(false);

  useMountEffect(() => {
    listHasShown = true;
  });

  return (
    <BotMenu bot={bot} onRename={() => setRenaming(true)} renameField={renameField}>
      {/* While the name is in edit, a click in the field must not open the bot. */}
      <Link
        to="/bots/$botId"
        params={{ botId: bot.id }}
        disabled={renaming}
        className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-[color,opacity,translate] duration-200 ease-out ${
          entersLate
            ? "starting:translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0"
            : ""
        }`}
        activeProps={{ className: "bg-sidebar-accent" }}
      >
        <Character
          shape={bot.shape}
          color={bot.color}
          mood={mood}
          size={36}
          gaze={glanceShown && glancing ? DRAFT_GAZE : undefined}
        />
        {glanceShown && <DraftGlance onGlance={setGlancing} />}
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
              <span
                className={`min-w-0 flex-1 truncate ${bot.unread ? "font-semibold" : "font-medium"}`}
              >
                {bot.name}
              </span>
            )}
            {bot.lastMessageAt !== null && (
              <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                {formatRecent(bot.lastMessageAt)}
              </span>
            )}
          </span>
          <span className="flex items-center">
            {/* The status line and the draft share one place under the name and fade into each other. */}
            <span className="grid min-w-0 flex-1 text-[0.8125rem] *:col-start-1 *:row-start-1">
              <span
                aria-hidden={showDraft}
                className={`truncate transition-[opacity,translate,color] duration-200 ease-out ${statusTone} ${showDraft ? LINE_HIDDEN : ""}`}
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
                <span className="min-w-0 truncate text-muted-foreground">
                  {draft && describeDraft(draft)}
                </span>
              </span>
            </span>
            {/* The dot marks a bot that waits for the operator or is unread, the spinner a working bot. Their place opens and closes, so the status line does not jump. */}
            <span
              aria-hidden
              className={`grid shrink-0 items-center justify-items-end overflow-hidden transition-[width] duration-200 ease-out ${dotShown || spinnerShown ? "w-4" : "w-0"}`}
            >
              <span
                className={`col-start-1 row-start-1 size-2 shrink-0 rounded-full bg-attention transition-[scale,opacity] duration-200 ease-out motion-reduce:scale-100 ${
                  dotShown ? "scale-100 opacity-100" : "scale-50 opacity-0"
                }`}
              />
              {/* The turn runs on a box around the icon, so the browser does not draw the page again on every frame. A hidden spinner does not turn. */}
              <span
                className={`col-start-1 row-start-1 inline-flex size-3 shrink-0 text-foreground transition-[scale,opacity] duration-200 ease-out motion-reduce:scale-100 ${
                  spinnerShown
                    ? "scale-100 animate-spin opacity-100 motion-reduce:animate-none"
                    : "scale-50 opacity-0"
                }`}
              >
                <LoaderCircleIcon className="size-full" />
              </span>
            </span>
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

  // The line keeps the same 4 px from the bot row above it as the rows keep from each other.
  return (
    <div className="pt-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        className="flex w-full items-center gap-1.5 rounded-lg py-1 pr-2.5 pl-14 text-[0.8125rem] text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent"
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

/** Makes a top-level row draggable. While the operator drags it, its place stays empty and shows where it lands. */
function SortableRow({ bot, clones }: Row) {
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: bot.id,
    transition: reduceMotion ? null : SLIDE,
  });

  // The row keeps the link as its only focus stop, so it leaves out the drag handle attributes.
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...listeners}
      className={isDragging ? "rounded-xl bg-sidebar-accent/50 *:opacity-0" : undefined}
    >
      <BotRow bot={bot} />
      {clones.length > 0 && <CloneGroup clones={clones} />}
    </div>
  );
}

/** Lists the top-level rows of one group. The clones of each orchestrator are grouped under it. */
function BotRows({ rows }: { rows: ReadonlyArray<Row> }) {
  return (
    <SortableContext items={rows.map((row) => row.bot.id)} strategy={verticalListSortingStrategy}>
      {/* An empty group hides the list, so its empty line keeps the same 4 px under the label as a row. */}
      <div className="flex flex-col gap-1 empty:hidden">
        {rows.map((row) => (
          <SortableRow key={row.bot.id} {...row} />
        ))}
      </div>
    </SortableContext>
  );
}

/**
 * Lets the operator drag a bot to another place in its group, or into another group. During the drag,
 * and until the store shows the new order, the list shows the dragged order instead of the store order.
 */
function useBotDrag(storeGroups: Groups) {
  const [dragged, setDragged] = useState<{ botId: BotId; from: string } | null>(null);
  const [override, setOverride] = useState<Groups | null>(null);

  // The server saved the drop, so the store order is the same as the dragged order now.
  if (
    dragged === null &&
    override !== null &&
    JSON.stringify(override) === JSON.stringify(storeGroups)
  ) {
    setOverride(null);
  }

  const groups = override ?? storeGroups;

  const sensors = useSensors(
    // A drag starts after a short move, so a click still opens the bot.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // On a touch screen a swipe scrolls the list, and a press and hold starts a drag.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  /** Aims at the nearest row of the group under the pointer, so a bot can only land in that group. */
  const collisionDetection: CollisionDetection = (args) => {
    const zone = pointerWithin(args).find((collision) => String(collision.id).startsWith("group:"));
    const group = zone === undefined ? undefined : groupOf(groups, zone.id);
    const rows = args.droppableContainers.filter((container) =>
      group === undefined
        ? !String(container.id).startsWith("group:")
        : groups[group]?.includes(container.id as BotId),
    );

    // An empty group takes the bot as its only row.
    if (zone !== undefined && rows.length === 0) {
      return [zone];
    }

    return closestCenter({ ...args, droppableContainers: rows });
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    const from = groupOf(groups, active.id);
    if (from === undefined) {
      return;
    }

    setDragged({ botId: active.id as BotId, from });
    setOverride(groups);
  };

  /** Moves the dragged bot into the group under the pointer. Inside a group, the sortable list moves it. */
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (over === null) {
      return;
    }

    const from = groupOf(groups, active.id);
    const to = groupOf(groups, over.id);
    if (from === undefined || to === undefined || from === to) {
      return;
    }

    const target = [...(groups[to] ?? [])];
    const overIndex = target.indexOf(over.id as BotId);
    target.splice(overIndex === -1 ? target.length : overIndex, 0, active.id as BotId);

    setOverride({
      ...groups,
      [from]: (groups[from] ?? []).filter((botId) => botId !== active.id),
      [to]: target,
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null);

    const group = groupOf(groups, active.id);
    if (dragged === null || group === undefined) {
      return setOverride(null);
    }

    const rows = groups[group] ?? [];
    const overIndex = over === null ? -1 : rows.indexOf(over.id as BotId);
    const order =
      overIndex === -1 ? rows : arrayMove([...rows], rows.indexOf(active.id as BotId), overIndex);
    const dropped = { ...groups, [group]: order };
    setOverride(dropped);

    const joins = group !== dragged.from;
    if (!joins && order.join() === storeGroups[group]?.join()) {
      return;
    }

    const botId = dragged.botId;
    void (async () => {
      // A bot from another group joins this one first, then takes its place.
      if (joins) {
        await client.setBotProject(botId, group === PERSONAL ? null : group);
      }

      await client.reorderBots(order);
    })().finally(() => {
      // A failed call, or a bot that came or went meanwhile, must not hold the dragged order forever.
      setTimeout(() => setOverride((current) => (current === dropped ? null : current)), 2000);
    });
  };

  const onDragCancel = () => {
    setDragged(null);
    setOverride(null);
  };

  const joinedGroup = dragged === null ? undefined : groupOf(groups, dragged.botId);

  return {
    groups,
    draggedBotId: dragged?.botId,
    // The group lights up when the dragged bot joins it from another group.
    highlightedGroup: dragged !== null && joinedGroup !== dragged.from ? joinedGroup : undefined,
    context: { sensors, collisionDetection, onDragStart, onDragOver, onDragEnd, onDragCancel },
  };
}

/**
 * Keeps whether a bot group is open across restarts. The storage holds the closed groups, so a
 * new group starts open.
 */
function useGroupOpen(group: string) {
  const key = `clots.groupClosed.${group}`;
  const [open, setOpen] = useState(() => !readPaneOpen(key));

  const toggle = () => {
    setOpen(!open);
    savePaneOpen(key, open);
  };

  return [open, toggle] as const;
}

/** The header of a bot group. It opens and closes the group's list. */
function GroupToggle({
  name,
  open,
  onToggle,
  title,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={`${GROUP_LABEL} justify-between text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent`}
      title={title}
    >
      <span className="truncate">{name}</span>
      <ChevronDownIcon
        className={`size-3.5 transition-[rotate] duration-200 ease-out motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
      />
    </button>
  );
}

/** Shows one project as a header that opens and closes the list of its bots. */
function ProjectSection({
  project,
  rows,
  botCount,
  highlighted,
}: {
  project: Project;
  rows: ReadonlyArray<Row>;
  botCount: number;
  highlighted: boolean;
}) {
  const [open, toggleOpen] = useGroupOpen(project.id);
  const [renaming, setRenaming] = useState(false);
  const renameField = useRef<HTMLInputElement>(null);

  return (
    <BotDropZone group={project.id} highlighted={highlighted}>
      <ProjectMenu
        project={project}
        botCount={botCount}
        onRename={() => setRenaming(true)}
        renameField={renameField}
      >
        {renaming ? (
          <div className={GROUP_LABEL}>
            <RenameField
              ref={renameField}
              name={project.name}
              label="Project name"
              onSave={(name) => void client.renameProject(project.id, name)}
              onDone={() => setRenaming(false)}
            />
          </div>
        ) : (
          <GroupToggle
            name={project.name}
            open={open}
            onToggle={toggleOpen}
            {...(project.directory === null ? {} : { title: project.directory })}
          />
        )}
      </ProjectMenu>

      <Collapse open={open}>
        <div className={BOT_ROWS}>
          <BotRows rows={rows} />
          {rows.length === 0 && <p className={EMPTY_HINT}>Drag Bots here</p>}
        </div>
      </Collapse>
    </BotDropZone>
  );
}

/** Removes the cached threads of bots that no longer exist. A new bot list mounts it again by its `key`. */
function ThreadCacheCleanup({ botIds }: { botIds: string }) {
  useMountEffect(() => forgetDeletedThreads(botIds.split(",") as Array<BotId>));

  return null;
}

export function BotList() {
  const bots = useStore(client.bots);
  const openBotId = useParams({ strict: false }).botId;
  const [creating, setCreating] = useState<"bot" | "project" | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newBotName, setNewBotName] = useState("");
  /** Closes the create dialog when it reports that it closed. */
  const closeCreate = (open: boolean) => open || setCreating(null);
  const projects = useStore(client.projects);
  const connection = useStore(client.connection);
  const updates = useUpdates();
  const [search, setSearch] = useState<{ open: boolean; instant: boolean }>({
    open: false,
    instant: false,
  });
  const [accountOpen, setAccountOpen] = useState(false);
  const [personalOpen, togglePersonal] = useGroupOpen(PERSONAL);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const wide = useMediaQuery(WIDE_WINDOW);
  const botsById = new Map(bots.map((bot) => [bot.id, bot]));
  const groupOfBot = (bot: BotSummary) => bot.projectId ?? PERSONAL;
  const botIds = bots.map((bot) => bot.id).join();

  /** Checks whether a bot shows under its orchestrator, which is the case when both are in the same group. */
  const isGroupedClone = (bot: BotSummary) => {
    const orchestrator = bot.clonedFrom === null ? undefined : botsById.get(bot.clonedFrom);

    return orchestrator !== undefined && groupOfBot(orchestrator) === groupOfBot(bot);
  };

  const storeGroups: Groups = Object.fromEntries(
    [...projects.map((project) => project.id), PERSONAL].map((group) => [
      group,
      bots.filter((bot) => groupOfBot(bot) === group && !isGroupedClone(bot)).map((bot) => bot.id),
    ]),
  );
  const drag = useBotDrag(storeGroups);
  const draggedBot = drag.draggedBotId === undefined ? undefined : botsById.get(drag.draggedBotId);

  /** Lists the rows of a group in the order that the store or the running drag gives. */
  const rowsOf = (group: string): ReadonlyArray<Row> =>
    (drag.groups[group] ?? []).flatMap((botId) => {
      const bot = botsById.get(botId);
      if (bot === undefined) {
        return [];
      }

      return [
        {
          bot,
          clones: bots.filter((clone) => clone.clonedFrom === botId && isGroupedClone(clone)),
        },
      ];
    });

  const personal = rowsOf(PERSONAL);

  const searchCommands: SearchCommands = {
    newBot: (name = "") => {
      setNewBotName(name);
      setCreating("bot");
    },
    newProject: () => setCreating("project"),
    checkForUpdates: () => void updates.checkNow(),
    openAccount: () => setAccountOpen(true),
  };

  // A shortcut opens the search without motion. The button opens it with motion.
  useSearchShortcuts({
    onToggle: () => setSearch((current) => ({ open: !current.open, instant: true })),
    onNew: () => setNewOpen(true),
    onBotOpened: () => setSearch((current) => ({ ...current, open: false })),
  });

  return (
    <nav className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Bots also go away by their own hand or on another device. An empty list may not have arrived yet, so it forgets nothing. */}
      {botIds !== "" && <ThreadCacheCleanup key={botIds} botIds={botIds} />}
      <header className="window-drag window-buttons-inset flex h-13 shrink-0 items-center justify-end gap-1.5 px-3">
        <Button
          variant="secondary"
          size="icon"
          aria-label="Search"
          className="rounded-full"
          onClick={() => setSearch({ open: true, instant: false })}
        >
          <SearchIcon />
        </Button>
        <SearchDialog
          open={search.open}
          onOpenChange={(open) => setSearch((current) => ({ ...current, open }))}
          instant={search.instant}
          commands={searchCommands}
        />

        <Button
          variant="secondary"
          size="icon"
          aria-label="New"
          className="rounded-full"
          onClick={() => setNewOpen(true)}
        >
          <PlusIcon />
        </Button>
        <NewDialog open={newOpen} onOpenChange={setNewOpen} commands={searchCommands} />

        {/* A new bot joins the project of the bot that is open, unless the operator picks another. */}
        <NewBotDialog
          open={creating === "bot"}
          onOpenChange={closeCreate}
          projectId={bots.find((bot) => bot.id === openBotId)?.projectId ?? null}
          name={newBotName}
        />
        <NewProjectDialog open={creating === "project"} onOpenChange={closeCreate} />
      </header>

      <DndContext {...drag.context}>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-5 px-3 pb-3">
            {projects.map((project) => (
              <ProjectSection
                key={project.id}
                project={project}
                rows={rowsOf(project.id)}
                botCount={bots.filter((bot) => bot.projectId === project.id).length}
                highlighted={drag.highlightedGroup === project.id}
              />
            ))}

            <BotDropZone group={PERSONAL} highlighted={drag.highlightedGroup === PERSONAL}>
              {/* Without a project there is one plain list, so the heading would only add noise. */}
              {projects.length > 0 && (
                <GroupToggle name="Personal" open={personalOpen} onToggle={togglePersonal} />
              )}
              <Collapse open={personalOpen || projects.length === 0}>
                <div className={BOT_ROWS}>
                  <BotRows rows={personal} />
                  {projects.length > 0 && personal.length === 0 && (
                    <p className={EMPTY_HINT}>Drag Bots here</p>
                  )}
                </div>
              </Collapse>
            </BotDropZone>

            {/* A wide window shows the empty state in the main area. On a phone the list is the home page, so it shows it here. */}
            {bots.length === 0 && !wide && (
              <div className="pt-24">
                <NoBots />
              </div>
            )}
          </div>
        </ScrollArea>

        {/* The copy under the pointer. Its rows do not animate, so it shows at once and stays still. */}
        <DragOverlay dropAnimation={reduceMotion ? null : { ...defaultDropAnimation, ...SLIDE }}>
          {draggedBot !== undefined && (
            <div className="rounded-xl bg-sidebar-accent shadow-lg ring-1 ring-foreground/10 **:transition-none">
              <BotRow bot={draggedBot} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <footer className="flex items-center gap-2 px-3 pt-1.5 pb-3">
        {/* A restart that this client asked for drops the connection by design. The update pill tells that story. */}
        <AccountMenu
          connected={connection === "connected"}
          connecting={connection !== "connected" && !updates.restarting}
          open={accountOpen}
          onOpenChange={setAccountOpen}
        />
        <UpdatePill updates={updates} />
      </footer>
    </nav>
  );
}
