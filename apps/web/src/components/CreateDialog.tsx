import { Character, type Gaze } from "@clots/character";
import type { BotColor, BotId, BotShape } from "@clots/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type ReactNode, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { client } from "../client.ts";
import { TEMPLATES, type BotTemplate } from "../templates.ts";
import { CharacterPicker } from "./CharacterPicker.tsx";
import { ProjectSelect } from "./ProjectPicker.tsx";
import { TemplateList, TemplatePage } from "./Templates.tsx";

/** The filled look of a dialog field. It matches the instructions field in the details pane. */
export const FILLED_FIELD =
  "rounded-xl border-transparent bg-muted/60 transition-[background-color,box-shadow] duration-150 focus-visible:border-transparent focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring/40 dark:bg-muted/60 dark:focus-visible:bg-muted";

/** The motion of the views of the New bot dialog: they slide 16 px and fade. Reduced motion keeps the fade. */
const VIEW = "transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-opacity";

const HIDDEN_LEFT = "pointer-events-none -translate-x-4 opacity-0 motion-reduce:translate-none";

const HIDDEN_RIGHT = "pointer-events-none translate-x-4 opacity-0 motion-reduce:translate-none";

/** The characters from the middle of the name field to its edge, where the eyes of the preview look furthest aside. */
const NAME_HALF_WIDTH = 14;

/** The bot that the operator just created. Its page opens the details pane, so the operator writes its instructions next. */
let createdBot: BotId | null = null;

/** Checks whether the operator just created this bot, and forgets it, so the page reacts only once. */
export function takeCreatedBot(botId: BotId) {
  if (createdBot !== botId) return false;

  createdBot = null;

  return true;
}

/**
 * Waits until the bot list has the new bot. The server answers before the list does, and the page
 * of a bot that is not in the list takes it for a deleted bot and goes home.
 */
const untilListed = (botId: BotId) =>
  new Promise<void>((resolve) => {
    const check = () => {
      if (!client.bots.get().some((bot) => bot.id === botId)) return;

      stop();
      resolve();
    };
    const stop = client.bots.subscribe(check);

    check();
  });

/** Makes the preview look down at the caret, so it reads along while the operator types its name. */
function gazeAtCaret(event: SyntheticEvent<HTMLInputElement>): Gaze {
  const field = event.currentTarget;

  // The field centers its text, so the caret moves out from the middle.
  const offset = (field.selectionStart ?? 0) - field.value.length / 2;

  return { x: Math.max(-1, Math.min(1, offset / NAME_HALF_WIDTH)) * 0.9, y: 1 };
}

/**
 * Shows a compact dialog that creates a bot or a project. Its parts below keep both dialogs alike,
 * and the skill editor uses them too. Without a `title`, the children render the header themselves,
 * such as the views of New bot.
 */
export function CreateDialog({
  title,
  open,
  onOpenChange,
  children,
  className = "sm:max-w-[440px]",
}: {
  title?: string;
  open: boolean;
  onOpenChange: NonNullable<ComponentProps<typeof Dialog>["onOpenChange"]>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* On a phone the dialog keeps 16 px on each side and scrolls when it does not fit. A hidden view waits 16 px to the side, so the sides clip. */}
      <DialogContent
        showCloseButton={false}
        className={`flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-x-hidden overflow-y-auto rounded-2xl px-6 py-5 ${className}`}
      >
        {title !== undefined && (
          <CreateDialogHeader>
            <DialogTitle className="mr-auto text-[15px] font-semibold">{title}</DialogTitle>
          </CreateDialogHeader>
        )}
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** The header row of a create dialog. The close button sits in it, so it lines up with the title. */
function CreateDialogHeader({ children }: { children: ReactNode }) {
  return (
    <DialogHeader className="relative z-10 h-7 flex-row items-center gap-2">
      {children}
      <DialogClose render={<Button variant="ghost" size="icon-sm" className="-mr-1.5 text-muted-foreground" />}>
        <XIcon />
        <span className="sr-only">Close</span>
      </DialogClose>
    </DialogHeader>
  );
}

/** Holds the fields of a create dialog. Enter in a field submits it. */
function CreateDialogForm({
  onSubmit,
  children,
  className = "",
  inert,
}: {
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
  className?: string;
  inert?: boolean;
}) {
  return (
    <form onSubmit={onSubmit} inert={inert} className={`flex flex-col ${className}`}>
      {children}
    </form>
  );
}

/** Shows the characters at the top of a create dialog, standing on one line. */
function CreateDialogHero({ children }: { children: ReactNode }) {
  return <div className="mt-5 mb-[22px] flex h-20 items-end justify-center gap-1">{children}</div>;
}

/** The name field of a create dialog. It has the focus when the dialog opens, and it rests lighter than the other fields. */
function CreateDialogName(props: Omit<ComponentProps<typeof Input>, "className" | "autoFocus" | "required">) {
  return (
    <Input
      {...props}
      required
      autoFocus
      aria-label="Name"
      className={`h-10 text-center text-[15px] md:text-[15px] ${FILLED_FIELD} bg-muted/45 dark:bg-muted/45`}
    />
  );
}

/**
 * Ends a create dialog with Cancel and the button that creates. `children`, such as a project select,
 * goes at the left. On a phone the footer stacks: the children, then the button that creates, then Cancel.
 */
export function CreateDialogFooter({
  submitLabel,
  disabled,
  children,
  className = "mt-[30px]",
}: {
  submitLabel: string;
  disabled: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <DialogFooter className={`mx-0 mb-0 ${className} flex-col rounded-none border-t-0 bg-transparent p-0 sm:flex-row`}>
      {children}
      <DialogClose render={<Button type="button" variant="ghost" className="order-2 sm:order-none" />}>Cancel</DialogClose>
      <Button type="submit" disabled={disabled} className="order-1 sm:order-none">
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}

/** Shows three grey clots side by side: a group of bots, as a project is. */
function ClotGroup() {
  return (
    <>
      <Character shape="drop" color="gray" size={36} />
      <Character shape="tumble" color="gray" size={50} />
      <Character shape="bean" color="gray" size={40} />
    </>
  );
}

/** Tells the operator that there are no bots yet and offers to create the first one. */
export function NoBots() {
  const [creating, setCreating] = useState<"form" | "templates" | false>(false);

  return (
    // The bot list arrives a moment after the page opens, so the empty state waits before it fades in.
    <div className="flex flex-col items-center gap-3 transition-opacity delay-300 duration-200 ease-out starting:opacity-0">
      <div className="flex items-end gap-1">
        <ClotGroup />
      </div>
      <p className="text-muted-foreground">No bots yet</p>
      <div className="flex flex-col items-center gap-1">
        <Button onClick={() => setCreating("form")}>New bot</Button>
        <Button variant="ghost" onClick={() => setCreating("templates")}>
          Start from a template
        </Button>
      </div>

      <NewBotDialog
        open={creating !== false}
        onOpenChange={(open) => setCreating(open && creating)}
        projectId={null}
        startOnTemplates={creating === "templates"}
      />
    </div>
  );
}

/** Creates a bot, then opens it. The operator can start from a template, which fills the form. */
export function NewBotDialog({
  open,
  onOpenChange,
  projectId,
  name = "",
  startOnTemplates = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project that the dialog proposes, such as the one of the bot that is open. */
  projectId: string | null;
  /** The name that the dialog proposes, such as a search that found no bot. */
  name?: string;
  /** Opens the dialog on the list of templates, such as from the empty state. */
  startOnTemplates?: boolean;
}) {
  const goBack = useRef<(() => void) | null>(null);

  return (
    <CreateDialog
      open={open}
      onOpenChange={(next, details) => {
        // In the templates, Escape goes back one view, like the back button.
        if (!next && details.reason === "escape-key" && goBack.current !== null) {
          details.cancel();
          goBack.current();

          return;
        }

        onOpenChange(next);
      }}
    >
      <NewBotForm
        projectId={projectId}
        proposedName={name}
        startOnTemplates={startOnTemplates}
        goBack={goBack}
        onCreated={() => onOpenChange(false)}
      />
    </CreateDialog>
  );
}

/**
 * Holds the fields of a new bot, and the templates in the same dialog: their list and the page of
 * one template. The three views share one grid cell, so the dialog keeps its height. It mounts with
 * the dialog, so each open starts fresh.
 */
function NewBotForm({
  projectId: proposedProject,
  proposedName,
  startOnTemplates,
  goBack,
  onCreated,
}: {
  projectId: string | null;
  proposedName: string;
  startOnTemplates: boolean;
  /** Receives what Escape does in the current view. The form view leaves it empty, so Escape closes the dialog. */
  goBack: { current: (() => void) | null };
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const [view, setView] = useState<"form" | "list" | "page">(startOnTemplates ? "list" : "form");
  const [viewing, setViewing] = useState<BotTemplate>();
  const [template, setTemplate] = useState<BotTemplate | null>(null);
  const [name, setName] = useState(proposedName);
  const [color, setColor] = useState<BotColor>("blue");
  const [shape, setShape] = useState<BotShape>("bean");
  const [projectId, setProjectId] = useState(proposedProject);
  const [gaze, setGaze] = useState<Gaze>();
  const [creating, setCreating] = useState(false);
  const nameField = useRef<HTMLInputElement>(null);
  const pill = useRef<HTMLButtonElement>(null);
  const focusOnForm = useRef<"name" | "pill" | null>(null);

  // The last template stays in the line under the name while the line fades out after Clear.
  const lastTemplate = useRef<BotTemplate | null>(null);

  useEffect(() => {
    goBack.current = view === "form" ? null : () => (view === "page" ? setView("list") : showForm());
  });

  // The form gets the focus back where the operator left it, or on the name of a picked template, selected so typing replaces it.
  useEffect(() => {
    if (view !== "form" || focusOnForm.current === null) return;

    if (focusOnForm.current === "name") nameField.current?.select();
    else pill.current?.focus();

    focusOnForm.current = null;
  }, [view]);

  const showForm = () => {
    focusOnForm.current = "pill";
    setView("form");
  };

  const openTemplate = (picked: BotTemplate) => {
    setViewing(picked);
    setView("page");
  };

  const useTemplate = (picked: BotTemplate) => {
    lastTemplate.current = picked;
    setTemplate(picked);
    setName(picked.name);
    setShape(picked.shape);
    setColor(picked.color);
    focusOnForm.current = "name";
    setView("form");
  };

  const clearTemplate = () => {
    setTemplate(null);
    setName("");
    setShape("bean");
    setColor("blue");
    nameField.current?.focus();
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);

    try {
      const bot = await client.createBot({
        name: name.trim(),
        instructions: template?.instructions ?? "",
        color,
        shape,
        projectId,
        skills: template?.skills ?? [],
      });
      await untilListed(bot.id);
      createdBot = bot.id;
      onCreated();
      await navigate({ to: "/bots/$botId", params: { botId: bot.id } });
    } finally {
      setCreating(false);
    }
  };

  const shownTemplate = template ?? lastTemplate.current;

  return (
    <>
      <CreateDialogHeader>
        {view !== "form" && (
          <Button type="button" variant="ghost" size="icon-sm" className="-ml-1.5" onClick={() => (view === "page" ? setView("list") : showForm())}>
            <ChevronLeftIcon />
            <span className="sr-only">Back</span>
          </Button>
        )}
        <DialogTitle className={view === "page" ? "sr-only" : "mr-auto text-[15px] font-semibold"}>
          {view === "form" && "New bot"}
          {view === "list" && "Templates"}
          {view === "page" && viewing?.name}
        </DialogTitle>
        {view === "page" && <span className="mr-auto" />}
        {view === "form" && (
          <button
            ref={pill}
            type="button"
            onClick={() => setView("list")}
            className="flex h-7 items-center gap-1.5 rounded-full bg-muted/60 pr-2.5 pl-1.5 text-[13px] font-medium outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-1 focus-visible:ring-ring/40"
          >
            <Character shape="trio" color="purple" size={18} />
            Templates
            <ChevronRightIcon className="size-[13px] text-muted-foreground" />
          </button>
        )}
      </CreateDialogHeader>

      <div className="relative grid">
        <CreateDialogForm onSubmit={create} inert={view !== "form"} className={`col-start-1 row-start-1 ${VIEW} ${view === "form" ? "" : HIDDEN_LEFT}`}>
          <CreateDialogHero>
            <Character shape={shape} color={color} size={76} gaze={gaze} />
          </CreateDialogHero>

          <CreateDialogName
            ref={nameField}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => setGaze(gazeAtCaret(event))}
            onSelect={(event) => setGaze(gazeAtCaret(event))}
            onBlur={() => setGaze(undefined)}
            placeholder="Name your bot"
          />

          {/* Says which template filled the form. It takes no room, so the form does not move when it shows. */}
          <div className="relative h-0">
            <div
              inert={template === null}
              className={`absolute inset-x-0 top-[7px] flex items-center justify-center gap-1.5 text-[12.5px] text-muted-foreground ${VIEW} ${
                template === null ? "pointer-events-none -translate-y-1 opacity-0 motion-reduce:translate-none" : ""
              }`}
            >
              <span>From the {shownTemplate?.name} template</span>
              <span aria-hidden>·</span>
              <button type="button" onClick={clearTemplate} className="underline decoration-muted-foreground/50 underline-offset-2 outline-none hover:text-foreground focus-visible:text-foreground">
                Clear
              </button>
            </div>
          </div>

          <div className="mt-[26px]">
            <CharacterPicker compact color={color} shape={shape} onColorChange={setColor} onShapeChange={setShape} />
          </div>

          <CreateDialogFooter submitLabel="Create bot" disabled={creating || name.trim() === ""}>
            <ProjectSelect projectId={projectId} onChange={setProjectId} className="mb-2 w-full sm:mr-auto sm:mb-0 sm:w-fit" />
          </CreateDialogFooter>
        </CreateDialogForm>

        <div inert={view !== "list"} className={`absolute inset-0 ${VIEW} ${view === "list" ? "" : view === "page" ? HIDDEN_LEFT : HIDDEN_RIGHT}`}>
          <TemplateList templates={TEMPLATES} active={view === "list"} onOpen={openTemplate} />
        </div>

        {/* The page reaches the dialog's edges, so its body scrolls under the floating header. */}
        <div inert={view !== "page"} className={`absolute -inset-x-6 -top-12 -bottom-5 ${VIEW} ${view === "page" ? "" : HIDDEN_RIGHT}`}>
          {viewing !== undefined && (
            <TemplatePage template={viewing} active={view === "page"} onBack={() => setView("list")} onUse={() => useTemplate(viewing)} />
          )}
        </div>
      </div>
    </>
  );
}

/** Creates a project. The new project then shows in the sidebar. */
export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <CreateDialog title="New project" open={open} onOpenChange={onOpenChange}>
      <NewProjectForm onCreated={() => onOpenChange(false)} />
    </CreateDialog>
  );
}

/** Holds the fields of a new project. It mounts with the dialog, so each open starts fresh. */
function NewProjectForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [directory, setDirectory] = useState("");
  const [directoryMissing, setDirectoryMissing] = useState(false);
  const [creating, setCreating] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);

    try {
      await client.createProject(name.trim(), directory.trim() === "" ? null : directory.trim());
      onCreated();
    } catch {
      // The server rejects a directory that does not exist on the host.
      setDirectoryMissing(true);
    } finally {
      setCreating(false);
    }
  };

  return (
    <CreateDialogForm onSubmit={create}>
      <CreateDialogHero>
        <ClotGroup />
      </CreateDialogHero>

      <CreateDialogName value={name} onChange={(event) => setName(event.target.value)} placeholder="Name your project" />

      <div className="mt-[22px] flex flex-col gap-[7px]">
        <label htmlFor="project-directory" className="px-1 text-[0.8125rem] text-muted-foreground">
          Directory
        </label>
        <Input
          id="project-directory"
          value={directory}
          onChange={(event) => {
            setDirectory(event.target.value);
            setDirectoryMissing(false);
          }}
          aria-invalid={directoryMissing}
          aria-describedby="project-directory-hint"
          placeholder="~/code/my-project"
          className={`h-10 px-3 font-mono text-[13.5px] md:text-[13.5px] ${FILLED_FIELD}`}
        />
        <p id="project-directory-hint" className="px-1 text-[12.5px] text-muted-foreground">
          Optional. A folder on the server. The bots of this project work in it.
        </p>
        {directoryMissing && (
          <p role="alert" className="px-1 text-[12.5px] text-destructive">
            This directory does not exist on the server.
          </p>
        )}
      </div>

      <CreateDialogFooter submitLabel="Create project" disabled={creating || name.trim() === ""} />
    </CreateDialogForm>
  );
}
