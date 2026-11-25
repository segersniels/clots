import type { BotSummary, RoutinePlace, Schedule } from "@clots/contracts";
import {
  CirclePauseIcon,
  ClockIcon,
  CopyIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

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
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { client, useStore } from "../client.ts";
import { knownNames, type KnownNames } from "../references.ts";
import { formatClock, formatNextDay } from "../time.ts";
import { CHIP_PICKER_CLASSES, PANE_EMPTY, PANE_LABEL } from "./BotSettings.tsx";
import { Collapse } from "./Collapse.tsx";
import { ComposerField } from "./ComposerField.tsx";
import {
  CreateDialog,
  CreateDialogFooter,
  DIALOG_CHIP_FIELD,
  DIALOG_FIELD,
  THIN_SCROLLBAR,
} from "./CreateDialog.tsx";
import { FOOTER_SELECT_TRIGGER } from "./ProjectPicker.tsx";
import { ReferenceText } from "./ReferenceText.tsx";

/**
 * Styles a select in the routine's when-and-where row. The selects share the full row width, and a
 * long value truncates. The value is a block, because the shared trigger makes it a flex line clamp,
 * which cuts the text without an ellipsis.
 */
const ROW_SELECT_TRIGGER = cn(
  FOOTER_SELECT_TRIGGER,
  "min-w-0 flex-1 basis-0 justify-between *:data-[slot=select-value]:block",
);

const CUSTOM = "custom";

/** The schedules that the form offers. `rule` is how often a preset runs, without its time, for the row. */
const PRESETS = [
  { label: "Every day, 9:00 AM", value: "0 9 * * *", rule: "every day" },
  { label: "Weekdays, 9:00 AM", value: "0 9 * * 1-5", rule: "weekdays" },
  { label: "Weekdays, 6:00 PM", value: "0 18 * * 1-5", rule: "weekdays" },
  { label: "Every hour", value: "0 * * * *", rule: "every hour" },
  { label: "Mondays, 9:00 AM", value: "0 9 * * 1", rule: "mondays" },
];

/** The schedule of a new routine. */
const DEFAULT_PRESET = PRESETS[1]!.value;

/** The labels of the select. The menu says "Custom…", because it opens a field, and the button says "Custom". */
const OPTIONS = [...PRESETS, { label: "Custom", value: CUSTOM }];

/** Checks whether the server refused a clone, because the bot has the most clones already. */
const isTooManyClones = (error: unknown) =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === "TooManyClones";

/** How long a removed routine takes to close. It matches the Collapse transition. */
const CLOSE_MS = 200;

/** Describes how often a routine runs, such as "weekdays". A cron expression without a preset shows as it is. */
const ruleOf = (cron: string) => PRESETS.find((preset) => preset.value === cron)?.rule ?? cron;

/**
 * Adds a routine, or edits one with `schedule`. Its schedule is a preset or a custom cron
 * expression. Escape closes the dialog, and Cmd or Ctrl+Enter saves.
 */
function RoutineForm({
  bot,
  schedule,
  onDone,
}: {
  bot: BotSummary;
  schedule: Schedule | undefined;
  onDone: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const cronField = useRef<HTMLInputElement>(null);
  const isPreset = PRESETS.some((preset) => preset.value === schedule?.cron);
  const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
  const [preset, setPreset] = useState(() => {
    if (schedule === undefined) {
      return DEFAULT_PRESET;
    }

    return isPreset ? schedule.cron : CUSTOM;
  });
  const [customCron, setCustomCron] = useState(
    schedule !== undefined && !isPreset ? schedule.cron : "",
  );
  const [place, setPlace] = useState<RoutinePlace>(schedule?.place ?? "here");
  const [invalidCron, setInvalidCron] = useState(false);
  const [tooManyClones, setTooManyClones] = useState(false);
  const [saving, setSaving] = useState(false);
  const cron = preset === CUSTOM ? customCron.trim() : preset;
  // An edit that changes nothing would only restart the schedule, so Save waits for a change.
  const changed =
    schedule === undefined ||
    prompt.trim() !== schedule.prompt ||
    cron !== schedule.cron ||
    place !== schedule.place;
  const canSave =
    prompt.trim() !== "" && cron !== "" && changed && !invalidCron && !tooManyClones && !saving;
  const places = [
    { value: "here", label: "This conversation", icon: MessageSquareIcon },
    { value: "clone", label: `A clone of ${bot.name}`, icon: CopyIcon },
  ] as const;
  const PlaceIcon = place === "here" ? MessageSquareIcon : CopyIcon;

  const save = async (event: FormEvent) => {
    event.preventDefault();

    if (!canSave) {
      return;
    }

    setSaving(true);

    try {
      if (schedule === undefined) {
        await client.createSchedule(bot.id, cron, prompt.trim(), place);
      } else {
        await client.updateSchedule(schedule.id, cron, prompt.trim(), place);
      }

      onDone();
    } catch (error) {
      // The server rejects a cron expression that it cannot parse, and a clone past the limit.
      if (isTooManyClones(error)) {
        setTooManyClones(true);
      } else {
        setInvalidCron(true);
      }

      setSaving(false);
    }
  };

  const choosePreset = (value: string) => {
    setPreset(value);
    setInvalidCron(false);

    // The field opens with the focus, so the operator can type the expression at once.
    if (value === CUSTOM) {
      requestAnimationFrame(() => cronField.current?.focus());
    }
  };

  return (
    <form ref={form} onSubmit={save} className="mt-4 flex flex-col">
      <div className="relative">
        <ComposerField
          botId={bot.id}
          label="Routine prompt"
          placeholder={`What should ${bot.name} do?`}
          initialText={prompt}
          onTextChange={setPrompt}
          onSubmit={() => form.current?.requestSubmit()}
          className={`${DIALOG_CHIP_FIELD} ${THIN_SCROLLBAR} max-h-[220px] overflow-y-auto px-0.5 py-1 [&_.tiptap]:min-h-20`}
          pickerClassName={`${CHIP_PICKER_CLASSES} z-10`}
        />
      </div>

      <Collapse open={preset === CUSTOM}>
        <Input
          ref={cronField}
          value={customCron}
          onChange={(event) => {
            setCustomCron(event.target.value);
            setInvalidCron(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              form.current?.requestSubmit();
            }
          }}
          placeholder="0 9 * * *"
          aria-label="Cron expression"
          aria-invalid={invalidCron}
          spellCheck={false}
          autoComplete="off"
          className={`mt-2 h-9 px-3 font-mono ${DIALOG_FIELD} text-[13px] md:text-[13px]`}
        />
      </Collapse>

      <div className="mt-3 flex items-center gap-1.5">
        <Select
          items={OPTIONS}
          value={preset}
          onValueChange={(value) => choosePreset(value as string)}
        >
          <SelectTrigger aria-label="Schedule" title="Schedule" className={ROW_SELECT_TRIGGER}>
            <ClockIcon className="text-muted-foreground" />
            <SelectValue className="min-w-0 truncate" />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              {PRESETS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectItem value={CUSTOM}>Custom…</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Select
          items={places}
          value={place}
          onValueChange={(value) => {
            setPlace(value as RoutinePlace);
            setTooManyClones(false);
          }}
        >
          <SelectTrigger aria-label="Runs in" title="Runs in" className={ROW_SELECT_TRIGGER}>
            <PlaceIcon className="text-muted-foreground" />
            <SelectValue className="min-w-0 truncate" />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectGroup>
              {places.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {tooManyClones && (
        <p className="mt-2 text-[0.8125rem] text-destructive">
          {bot.name} has the most clones already. Delete one, or run the routine here.
        </p>
      )}

      <CreateDialogFooter
        submitLabel={schedule === undefined ? "Add routine" : "Save"}
        disabled={!canSave}
        className="mt-5"
      />
    </form>
  );
}

/**
 * One routine as a filled row. It opens on mount, so a new routine eases in, and it closes before
 * the server deletes it. A click opens the editor. In a clone, the row only shows the routine, because
 * the bot that the clone mirrors owns it.
 */
function RoutineRow({
  schedule,
  known,
  removing,
  readOnly,
  onEdit,
  onRemove,
}: {
  schedule: Schedule;
  known: KnownNames;
  removing: boolean;
  readOnly: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const bots = useStore(client.bots);
  const [shown, setShown] = useState(false);

  // The row mounts closed and opens on the next frame, so a new routine eases in.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));

    return () => cancelAnimationFrame(frame);
  }, []);

  // The next run comes first, so the narrow pane cuts off the rule and not the next run.
  const rule = ruleOf(schedule.cron);
  const when = schedule.paused
    ? `Paused · ${rule.charAt(0).toUpperCase()}${rule.slice(1)}`
    : `${formatNextDay(schedule.nextRunAt)}, ${formatClock(schedule.nextRunAt)} · ${rule}`;
  // The clone's own pane shows only this routine, so it needs no sign of where the routine runs.
  const PlaceIcon = schedule.place === "clone" && !readOnly ? CopyIcon : ClockIcon;
  const Icon = schedule.paused ? CirclePauseIcon : PlaceIcon;
  const content = (
    <>
      <Icon
        className={`row-span-2 size-[17px] text-muted-foreground transition-opacity ${schedule.paused ? "opacity-50" : ""}`}
      />
      <span
        title={schedule.prompt}
        className={`col-start-2 truncate transition-opacity ${schedule.paused ? "opacity-50" : ""}`}
      >
        <ReferenceText text={schedule.prompt} known={known} bots={bots} />
      </span>
      <span className="col-start-2 row-start-2 truncate text-[0.8125rem] text-muted-foreground tabular-nums">
        {when}
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
        <div className="group grid grid-cols-[minmax(0,1fr)_28px] items-center rounded-xl bg-muted/60 pr-1.5 transition-colors duration-150 hover:bg-muted">
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
                  aria-label="Routine actions"
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
              <DropdownMenuItem
                onClick={() => void client.setSchedulePaused(schedule.id, !schedule.paused)}
              >
                {schedule.paused ? <PlayIcon /> : <CirclePauseIcon />}
                {schedule.paused ? "Resume" : "Pause"}
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
 * Lists the routines of a bot. The editor opens in a dialog, as the editor of a skill does. A clone
 * only shows the routine that it runs, and hides the section when it runs none.
 */
export function Routines({ bot }: { bot: BotSummary }) {
  const schedules = useStore(client.schedules(bot.id));
  const skills = useStore(client.skills(bot.id));
  const bots = useStore(client.bots);
  const known = knownNames(
    skills.map((skill) => skill.name),
    bots.map((other) => other.name),
  );
  const [editing, setEditing] = useState<{ schedule: Schedule | undefined; round: number } | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState<Schedule | null>(null);
  const isClone = bot.clonedFrom !== null;
  // The clone that runs the routine goes with it, so the confirmation names it.
  const runnerName = bots.find((other) => other.id === confirmingDelete?.runnerId)?.name;

  const openEditor = (schedule: Schedule | undefined) => {
    setEditing({ schedule, round: (editing?.round ?? 0) + 1 });
    setDialogOpen(true);
  };

  const remove = (id: string) => {
    setRemoving((ids) => new Set(ids).add(id));
    setTimeout(() => {
      void client.deleteSchedule(id).finally(() =>
        setRemoving((ids) => {
          const next = new Set(ids);
          next.delete(id);

          return next;
        }),
      );
    }, CLOSE_MS);
  };

  if (isClone && schedules.length === 0) {
    return null;
  }

  return (
    <section className="flex flex-col gap-1">
      <div className="flex h-7 items-center justify-between">
        <h2 className={PANE_LABEL}>Routines</h2>
        {!isClone && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New routine"
            className="text-muted-foreground"
            onClick={() => openEditor(undefined)}
          >
            <PlusIcon />
          </Button>
        )}
      </div>

      {schedules.length === 0 && <p className={PANE_EMPTY}>No routines yet.</p>}

      {schedules.length > 0 && (
        <div className="-mb-1">
          {schedules.map((schedule) => (
            <RoutineRow
              key={schedule.id}
              schedule={schedule}
              known={known}
              removing={removing.has(schedule.id)}
              readOnly={isClone}
              onEdit={() => openEditor(schedule)}
              onRemove={() => setConfirmingDelete(schedule)}
            />
          ))}
        </div>
      )}

      {/* The dialog is short, so the reference picker can reach past its top edge. */}
      <CreateDialog
        title={editing?.schedule === undefined ? "New routine" : "Edit routine"}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        className="overflow-visible sm:max-w-[440px]"
      >
        {editing !== null && (
          <RoutineForm
            key={editing.round}
            bot={bot}
            schedule={editing.schedule}
            onDone={() => setDialogOpen(false)}
          />
        )}
      </CreateDialog>

      <AlertDialog
        open={confirmingDelete !== null}
        onOpenChange={(open) => !open && setConfirmingDelete(null)}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this routine?</AlertDialogTitle>
            <AlertDialogDescription>
              {runnerName === undefined
                ? `${bot.name} stops running it. You cannot undo this.`
                : `${bot.name} stops running it, and ${runnerName} is deleted with it. You cannot undo this.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => remove(confirmingDelete!.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
