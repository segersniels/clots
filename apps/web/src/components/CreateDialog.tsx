import { Character, type Gaze } from "@clots/character";
import type { BotColor, BotId, BotShape } from "@clots/contracts";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState, type ComponentProps, type FormEvent, type ReactNode, type SyntheticEvent } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { client } from "../client.ts";
import { CharacterPicker } from "./CharacterPicker.tsx";
import { ProjectSelect } from "./ProjectPicker.tsx";

/** The filled look of a dialog field. It matches the instructions field in the details pane. */
const FILLED_FIELD =
  "rounded-xl border-transparent bg-muted/60 transition-[background-color,box-shadow] duration-150 focus-visible:border-transparent focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring/40 dark:bg-muted/60";

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

/** Shows a compact dialog that creates a bot or a project. Its parts below keep both dialogs alike. */
function CreateDialog({
  title,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* On a phone the dialog keeps 16 px on each side and scrolls when it does not fit. */}
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-y-auto rounded-2xl px-6 py-5 sm:max-w-[440px]"
      >
        {/* The close button sits in the header row, so it lines up with the title. */}
        <DialogHeader className="flex-row items-center justify-between">
          <DialogTitle className="text-[15px] font-semibold">{title}</DialogTitle>
          <DialogClose render={<Button variant="ghost" size="icon-sm" className="-mr-1.5 text-muted-foreground" />}>
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Holds the fields of a create dialog. Enter in a field submits it. */
function CreateDialogForm({ onSubmit, children }: { onSubmit: (event: FormEvent) => void; children: ReactNode }) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col">
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
function CreateDialogFooter({ submitLabel, disabled, children }: { submitLabel: string; disabled: boolean; children?: ReactNode }) {
  return (
    <DialogFooter className="mx-0 mb-0 mt-[30px] flex-col rounded-none border-t-0 bg-transparent p-0 sm:flex-row">
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
  const [creating, setCreating] = useState(false);

  return (
    // The bot list arrives a moment after the page opens, so the empty state waits before it fades in.
    <div className="flex flex-col items-center gap-3 transition-opacity delay-300 duration-200 ease-out starting:opacity-0">
      <div className="flex items-end gap-1">
        <ClotGroup />
      </div>
      <p className="text-muted-foreground">No bots yet</p>
      <Button onClick={() => setCreating(true)}>New bot</Button>

      <NewBotDialog open={creating} onOpenChange={setCreating} projectId={null} />
    </div>
  );
}

/** Creates a bot, then opens it with its details, so the operator writes its instructions next. */
export function NewBotDialog({
  open,
  onOpenChange,
  projectId,
  name = "",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The project that the dialog proposes, such as the one of the bot that is open. */
  projectId: string | null;
  /** The name that the dialog proposes, such as a search that found no bot. */
  name?: string;
}) {
  return (
    <CreateDialog title="New bot" open={open} onOpenChange={onOpenChange}>
      <NewBotForm projectId={projectId} proposedName={name} onCreated={() => onOpenChange(false)} />
    </CreateDialog>
  );
}

/** Holds the fields of a new bot. It mounts with the dialog, so each open starts fresh. */
function NewBotForm({
  projectId: proposedProject,
  proposedName,
  onCreated,
}: {
  projectId: string | null;
  proposedName: string;
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const [name, setName] = useState(proposedName);
  const [color, setColor] = useState<BotColor>("blue");
  const [shape, setShape] = useState<BotShape>("bean");
  const [projectId, setProjectId] = useState(proposedProject);
  const [gaze, setGaze] = useState<Gaze>();
  const [creating, setCreating] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setCreating(true);

    try {
      const bot = await client.createBot({ name: name.trim(), instructions: "", color, shape, projectId });
      await untilListed(bot.id);
      createdBot = bot.id;
      onCreated();
      await navigate({ to: "/bots/$botId", params: { botId: bot.id } });
    } finally {
      setCreating(false);
    }
  };

  return (
    <CreateDialogForm onSubmit={create}>
      <CreateDialogHero>
        <Character shape={shape} color={color} size={76} gaze={gaze} />
      </CreateDialogHero>

      <CreateDialogName
        value={name}
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => setGaze(gazeAtCaret(event))}
        onSelect={(event) => setGaze(gazeAtCaret(event))}
        onBlur={() => setGaze(undefined)}
        placeholder="Name your bot"
      />

      <div className="mt-[26px]">
        <CharacterPicker compact color={color} shape={shape} onColorChange={setColor} onShapeChange={setShape} />
      </div>

      <CreateDialogFooter submitLabel="Create bot" disabled={creating || name.trim() === ""}>
        <ProjectSelect projectId={projectId} onChange={setProjectId} className="mb-2 w-full sm:mr-auto sm:mb-0 sm:w-fit" />
      </CreateDialogFooter>
    </CreateDialogForm>
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
