import type { BotSkill, BotSummary } from "@clots/contracts";
import { BoxIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMountEffect } from "@/hooks/use-mount-effect";

import { client, useStore } from "../client.ts";
import { PANE_EMPTY, PANE_LABEL } from "./BotSettings.tsx";
import { Collapse } from "./Collapse.tsx";
import { CreateDialog, CreateDialogFooter, DIALOG_FIELD, THIN_SCROLLBAR } from "./CreateDialog.tsx";
import { SkillPreview } from "./SkillPreview.tsx";

/** How long a removed skill takes to close. It matches the Collapse transition. */
const CLOSE_MS = 200;

/** How long a skill that appeared while the pane was open keeps its ring. */
const RING_MS = 1600;

/** Claude Code takes skill names of up to 64 characters. */
const MAX_NAME = 64;

/** Turns typed text into a skill name while the operator types: lowercase, and a hyphen for any other character. */
const slugWhileTyping = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, MAX_NAME);

/** Finishes a typed skill name: one hyphen between words, and none at the ends. */
const finishName = (name: string) => name.replace(/-+/g, "-").replace(/^-|-$/g, "");

/** Tells the operator why the server did not save a skill. */
const SAVE_FAILURES = {
  name: "Use lowercase letters, digits and hyphens for the name.",
  taken: "This bot already has a skill with this name.",
  missing: "This skill was deleted. Cancel and add it again.",
} as const;

const failureOf = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "reason" in error &&
  typeof error.reason === "string" &&
  error.reason in SAVE_FAILURES
    ? SAVE_FAILURES[error.reason as keyof typeof SAVE_FAILURES]
    : "The skill could not be saved.";

/**
 * Adds a skill, or edits one with `skill`. A name that the operator's own Claude Code skills also
 * use gets a note, because this bot then uses its own skill instead. Cmd or Ctrl+Enter saves.
 */
function SkillForm({
  bot,
  skill,
  ownNames,
  operatorNames,
  onDone,
  onDelete,
}: {
  bot: BotSummary;
  skill: BotSkill | undefined;
  ownNames: ReadonlySet<string>;
  operatorNames: ReadonlySet<string>;
  onDone: () => void;
  onDelete: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [body, setBody] = useState(skill?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const finished = { name: finishName(name), description: description.trim(), body: body.trim() };
  const taken = finished.name !== skill?.name && ownNames.has(finished.name);
  const changed =
    skill === undefined ||
    finished.name !== skill.name ||
    finished.description !== skill.description ||
    finished.body !== skill.body;
  const canSave =
    finished.name !== "" &&
    finished.description !== "" &&
    finished.body !== "" &&
    changed &&
    !taken &&
    !saving;

  const save = async (event: FormEvent) => {
    event.preventDefault();

    if (!canSave) {
      return;
    }

    setSaving(true);

    try {
      await client.saveBotSkill(bot.id, finished, skill?.name);
      onDone();
    } catch (error) {
      setFailure(failureOf(error));
      setSaving(false);
    }
  };

  /** The capture phase runs before the steps field, which would otherwise make a new line. */
  const saveOnShortcut = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) {
      return;
    }

    event.preventDefault();
    form.current?.requestSubmit();
  };

  return (
    <form
      ref={form}
      onSubmit={save}
      onKeyDownCapture={saveOnShortcut}
      className="mt-4 flex flex-col gap-4"
    >
      <SkillPreview bot={bot} name={finished.name} when={finished.description} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="skill-name" className="px-1 text-[0.8125rem] text-muted-foreground">
          Name
        </label>
        <div className="relative">
          <BoxIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-skill" />
          <Input
            id="skill-name"
            value={name}
            onChange={(event) => {
              setName(slugWhileTyping(event.target.value));
              setFailure(null);
            }}
            autoFocus={skill === undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="pricing-page"
            aria-invalid={taken}
            className={`h-10 pr-3 pl-9 font-medium ${DIALOG_FIELD}`}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="skill-description" className="px-1 text-[0.8125rem] text-muted-foreground">
          Use it when
        </label>
        <Input
          id="skill-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="You change prices, plans or the pricing page."
          className={`h-10 px-3 ${DIALOG_FIELD}`}
        />
      </div>

      {operatorNames.has(finished.name) && (
        <p className="flex items-center gap-2 rounded-[10px] bg-skill/8 px-3 py-2 text-[13px] text-skill">
          <BoxIcon className="size-[15px] shrink-0" />
          Replaces your own {finished.name} skill for {bot.name}.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="skill-steps" className="px-1 text-[0.8125rem] text-muted-foreground">
          Steps
        </label>
        <Textarea
          id="skill-steps"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          autoFocus={skill !== undefined}
          spellCheck={false}
          placeholder={
            "1. Read the current pricing page.\n2. List what changes, and why.\n3. Show me the new copy before you publish."
          }
          className={`max-h-[300px] min-h-[148px] resize-none overflow-y-auto ${THIN_SCROLLBAR} px-3 py-2.5 text-[13.5px] leading-[1.55] md:text-[13.5px] ${DIALOG_FIELD}`}
        />
      </div>

      {(taken || failure !== null) && (
        <p role="alert" className="-mt-2 px-1 text-[12.5px] text-destructive">
          {taken ? SAVE_FAILURES.taken : failure}
        </p>
      )}

      <CreateDialogFooter
        submitLabel={skill === undefined ? "Add skill" : "Save"}
        disabled={!canSave}
        className="mt-1"
      >
        {skill !== undefined && (
          <Button
            type="button"
            variant="ghost"
            onClick={onDelete}
            className="order-3 text-destructive hover:text-destructive sm:order-none sm:mr-auto sm:-ml-2"
          >
            Delete
          </Button>
        )}
      </CreateDialogFooter>
    </form>
  );
}

/**
 * One own skill as a filled row. It opens on mount, so a skill that the bot writes eases in, and a
 * skill that appeared while the pane was open gets a short ring. A click opens the editor. In a
 * clone, the row only shows the skill, because the bot that the clone mirrors owns it.
 */
function SkillRow({
  skill,
  replaces,
  isNew,
  removing,
  readOnly,
  onEdit,
  onRemove,
}: {
  skill: BotSkill;
  replaces: boolean;
  isNew: boolean;
  removing: boolean;
  readOnly: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [ringing, setRinging] = useState(isNew);

  // The row mounts closed and opens on the next frame, so a new skill eases in.
  useMountEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));

    return () => cancelAnimationFrame(frame);
  });

  useMountEffect(() => {
    if (!isNew) {
      return;
    }

    const timer = setTimeout(() => setRinging(false), RING_MS);

    return () => clearTimeout(timer);
  });

  const content = (
    <>
      <BoxIcon className="row-span-2 size-[17px] text-skill" />
      <span className="col-start-2 truncate">
        {skill.name}
        {replaces && (
          <span className="ml-1.5 rounded-md bg-muted px-1.5 py-px align-[1px] text-[11.5px] text-muted-foreground">
            replaces yours
          </span>
        )}
      </span>
      <span className="col-start-2 row-start-2 truncate text-[0.8125rem] text-muted-foreground">
        {skill.description}
      </span>
    </>
  );

  if (readOnly) {
    return (
      <Collapse open={shown && !removing}>
        <div className="pb-1">
          <div className="grid grid-cols-[18px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-px rounded-xl bg-muted/60 py-2 pr-2.5 pl-2.5">
            {content}
          </div>
        </div>
      </Collapse>
    );
  }

  return (
    <Collapse open={shown && !removing}>
      <div className="pb-1">
        <div
          className={`group grid grid-cols-[minmax(0,1fr)_28px] items-center rounded-xl bg-muted/60 pr-1.5 transition-[background-color,box-shadow] duration-300 ease-out hover:bg-muted ${ringing ? "ring-[1.5px] ring-attention/55" : "ring-0 ring-attention/0"}`}
        >
          <button
            type="button"
            onClick={onEdit}
            className="grid grid-cols-[18px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-px rounded-xl py-2 pl-2.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
          >
            {content}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Skill actions"
                  className="text-muted-foreground data-popup-open:bg-muted data-popup-open:text-foreground group-hover:hover:bg-background/60"
                />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-36">
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onRemove}>
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </Collapse>
  );
}

/**
 * Lists the skills that only this bot has, from the skill files in its notes. The bot can write
 * them too, so the list follows the files while the pane is open. The editor opens in a dialog. A
 * clone shows the skills of the bot that it mirrors, and hides the section when that bot has none.
 */
export function BotSkills({ bot }: { bot: BotSummary }) {
  const own = useStore(client.botSkills(bot.id));
  const listed = useStore(client.skills(bot.id));
  const [editing, setEditing] = useState<{ skill: BotSkill | undefined; round: number } | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const isClone = bot.clonedFrom !== null;
  // The skills of the first list are not new. Each later skill is new once.
  const [lists, setLists] = useState<{
    own: typeof own;
    seen: ReadonlySet<string> | null;
  }>({ own, seen: null });

  // A row reads whether it is new when it mounts, so the names of a list count as seen when the next list arrives.
  if (lists.own !== own) {
    setLists({
      own,
      seen:
        lists.own === null
          ? lists.seen
          : new Set([...(lists.seen ?? []), ...lists.own.map((skill) => skill.name)]),
    });
  }

  const ownNames = new Set((own ?? []).map((skill) => skill.name));
  const replacing = new Set(
    listed.filter((skill) => skill.replaces === true).map((skill) => skill.name),
  );
  // An operator skill of an own skill's name is not listed, but the own skill marks it.
  const operatorNames = new Set([
    ...listed.filter((skill) => !ownNames.has(skill.name)).map((skill) => skill.name),
    ...replacing,
  ]);

  const openEditor = (skill: BotSkill | undefined) => {
    setEditing({ skill, round: (editing?.round ?? 0) + 1 });
    setDialogOpen(true);
  };

  const remove = (name: string) => {
    setRemoving((names) => new Set(names).add(name));
    setTimeout(() => {
      void client.deleteBotSkill(bot.id, name).finally(() =>
        setRemoving((names) => {
          const next = new Set(names);
          next.delete(name);

          return next;
        }),
      );
    }, CLOSE_MS);
  };

  if (isClone && (own === null || own.length === 0)) {
    return null;
  }

  return (
    <section className="flex flex-col gap-1">
      <div className="flex h-7 items-center justify-between">
        <h2 className={PANE_LABEL}>Skills</h2>
        {!isClone && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New skill"
            className="text-muted-foreground"
            onClick={() => openEditor(undefined)}
          >
            <PlusIcon />
          </Button>
        )}
      </div>

      {own !== null && own.length === 0 && (
        <p className={PANE_EMPTY}>No skills yet. Add one, or ask {bot.name} to write one.</p>
      )}

      {own !== null && own.length > 0 && (
        <div className="-mb-1">
          {own.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              replaces={replacing.has(skill.name)}
              isNew={lists.seen !== null && !lists.seen.has(skill.name)}
              removing={removing.has(skill.name)}
              readOnly={isClone}
              onEdit={() => openEditor(skill)}
              onRemove={() => setConfirmingDelete(skill.name)}
            />
          ))}
        </div>
      )}

      <CreateDialog
        title={editing?.skill === undefined ? "New skill" : "Edit skill"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        className="sm:max-w-[520px]"
      >
        {editing !== null && (
          <SkillForm
            key={editing.round}
            bot={bot}
            skill={editing.skill}
            ownNames={ownNames}
            operatorNames={operatorNames}
            onDone={() => setDialogOpen(false)}
            onDelete={() => {
              setDialogOpen(false);
              setConfirmingDelete(editing.skill!.name);
            }}
          />
        )}
      </CreateDialog>

      <AlertDialog
        open={confirmingDelete !== null}
        onOpenChange={(open) => !open && setConfirmingDelete(null)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmingDelete}?</AlertDialogTitle>
            <AlertDialogDescription>
              {bot.name} stops using this skill, and its folder is deleted. You cannot undo this.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove(confirmingDelete!)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
