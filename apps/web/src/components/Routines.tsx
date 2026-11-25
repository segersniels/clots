import type { BotId, Schedule } from "@clots/contracts";
import { CirclePauseIcon, ClockIcon, MoreHorizontalIcon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { client, useStore } from "../client.ts";
import { knownNames, type KnownNames } from "../references.ts";
import { formatClock, formatNextDay } from "../time.ts";
import { CHIP_FIELD_CLASSES, CHIP_PICKER_CLASSES, PANE_EMPTY, PANE_LABEL } from "./BotSettings.tsx";
import { Collapse } from "./Collapse.tsx";
import { ComposerField, type ComposerFieldHandle } from "./ComposerField.tsx";
import { ReferenceText } from "./ReferenceText.tsx";

const CUSTOM = "custom";

/** The schedules that the form offers. `rule` is how often a preset runs, without its time, for the row. */
const PRESETS = [
  { label: "Every day at 9:00 AM", value: "0 9 * * *", rule: "every day" },
  { label: "Weekdays at 9:00 AM", value: "0 9 * * 1-5", rule: "weekdays" },
  { label: "Weekdays at 6:00 PM", value: "0 18 * * 1-5", rule: "weekdays" },
  { label: "Every hour", value: "0 * * * *", rule: "every hour" },
  { label: "Mondays at 9:00 AM", value: "0 9 * * 1", rule: "mondays" },
];

const OPTIONS = [...PRESETS, { label: "Custom cron", value: CUSTOM }];

/** Stands for the add form in the section's one open form. A routine id stands for its edit form. */
const NEW_ROUTINE = "new";

/** How long a removed routine takes to close. It matches the Collapse transition. */
const CLOSE_MS = 200;

/** Describes how often a routine runs, such as "weekdays". A cron expression without a preset shows as it is. */
const ruleOf = (cron: string) => PRESETS.find((preset) => preset.value === cron)?.rule ?? cron;

/**
 * Asks for a routine's prompt and schedule. Without `schedule` it adds a routine and clears itself
 * for the next one. With `schedule` it edits that routine and starts from its prompt and schedule.
 * Escape cancels, and Cmd or Ctrl+Enter submits.
 */
function RoutineForm({
  botId,
  schedule,
  onDone,
  className = "",
}: {
  botId: BotId;
  schedule?: Schedule;
  onDone: () => void;
  className?: string;
}) {
  const field = useRef<ComposerFieldHandle>(null);
  const form = useRef<HTMLFormElement>(null);
  const isPreset = PRESETS.some((preset) => preset.value === schedule?.cron);
  const [prompt, setPrompt] = useState(schedule?.prompt ?? "");
  const [preset, setPreset] = useState(() => {
    if (schedule === undefined) return PRESETS[0]!.value;

    return isPreset ? schedule.cron : CUSTOM;
  });
  const [customCron, setCustomCron] = useState(schedule !== undefined && !isPreset ? schedule.cron : "");
  const [error, setError] = useState(false);
  const cron = preset === CUSTOM ? customCron.trim() : preset;
  // An edit that changes nothing would only restart the schedule, so Save waits for a change.
  const changed = schedule === undefined || prompt.trim() !== schedule.prompt || cron !== schedule.cron;
  const canSubmit = prompt.trim() !== "" && cron !== "" && changed;

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (!canSubmit) return;

    try {
      if (schedule === undefined) {
        await client.createSchedule(botId, cron, prompt.trim());
        field.current?.clear();
      } else {
        await client.updateSchedule(schedule.id, cron, prompt.trim());
      }

      setError(false);
      onDone();
    } catch {
      // The server rejects a cron expression that it cannot parse.
      setError(true);
    }
  };

  // The capture phase runs before the prompt field, which would otherwise make a new line.
  const submitOnShortcut = (event: KeyboardEvent) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;

    event.preventDefault();
    event.stopPropagation();
    form.current?.requestSubmit();
  };

  // The prompt field reports its own Escape through onEscape, after its picker, and marks it as used.
  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;

    onDone();
  };

  return (
    <form ref={form} onSubmit={submit} onKeyDownCapture={submitOnShortcut} onKeyDown={cancelOnEscape} className={`flex flex-col gap-2 ${className}`}>
      <div className="relative">
        <ComposerField
          ref={field}
          botId={botId}
          label="Routine prompt"
          placeholder="Morning briefing"
          initialText={prompt}
          onTextChange={setPrompt}
          onEscape={onDone}
          autoFocus={schedule !== undefined}
          className={`${CHIP_FIELD_CLASSES} min-h-16`}
          pickerClassName={CHIP_PICKER_CLASSES}
        />
      </div>
      <Select items={OPTIONS} value={preset} onValueChange={(value) => setPreset(value as string)}>
        <SelectTrigger className="w-full" aria-label="Schedule">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Collapse open={preset === CUSTOM}>
        <Input
          value={customCron}
          onChange={(event) => setCustomCron(event.target.value)}
          required={preset === CUSTOM}
          placeholder="0 9 * * *"
          aria-label="Cron expression"
          aria-invalid={error}
          className="font-mono"
        />
      </Collapse>
      {error && <p className="text-xs text-destructive">This cron expression is not valid.</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!canSubmit}>
          {schedule === undefined ? "Add routine" : "Save"}
        </Button>
        {schedule !== undefined && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * One routine as a filled row. It opens on mount and closes before the server deletes it. The row
 * keeps its gap below, so a closing row takes its gap with it. Edit swaps the row for the form.
 * The section decides which form is open, so only one form shows at a time.
 */
function RoutineRow({
  botId,
  schedule,
  known,
  editing,
  editRound,
  onEdit,
  onEditEnd,
  onRemoved,
}: {
  botId: BotId;
  schedule: Schedule;
  known: KnownNames;
  editing: boolean;
  /** Counts the forms that the section opened. */
  editRound: number;
  onEdit: () => void;
  onEditEnd: () => void;
  onRemoved: () => void;
}) {
  const bots = useStore(client.bots);
  const [shown, setShown] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  // Each edit gets a new form, so it starts from the saved routine and not from a canceled edit. A closing form keeps its key.
  const formKey = useRef(0);
  if (editing) formKey.current = editRound;

  // The row mounts closed and opens on the next frame, so a new routine eases in.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));

    return () => cancelAnimationFrame(frame);
  }, []);

  // A save or cancel brings keyboard users back to the row's "…" button, not to the top of the page.
  // Another form that opens takes the focus itself, so only an end through this form sets the flag.
  const returnFocus = useRef(false);

  const endEdit = () => {
    returnFocus.current = true;
    onEditEnd();
  };

  // The row must be visible again before it can take the focus, so this waits for the render.
  useEffect(() => {
    if (editing || !returnFocus.current) return;

    returnFocus.current = false;
    row.current?.querySelector<HTMLElement>('[aria-label="Routine actions"]')?.focus();
  }, [editing]);

  const remove = () => {
    setShown(false);
    setTimeout(() => {
      void client.deleteSchedule(schedule.id);
      onRemoved();
    }, CLOSE_MS);
  };

  // The next run comes first, so the narrow pane cuts off the rule and not the next run.
  const rule = ruleOf(schedule.cron);
  const when = schedule.paused
    ? `Paused · ${rule.charAt(0).toUpperCase()}${rule.slice(1)}`
    : `${formatNextDay(schedule.nextRunAt)}, ${formatClock(schedule.nextRunAt)} · ${rule}`;
  const Icon = schedule.paused ? CirclePauseIcon : ClockIcon;

  return (
    <Collapse open={shown}>
      <div ref={row} className="pb-1">
        <Collapse open={!editing}>
          <div className="grid grid-cols-[18px_minmax(0,1fr)_28px] items-center gap-x-2.5 gap-y-px rounded-xl bg-muted/60 py-2 pr-1.5 pl-2.5">
            <Icon className={`row-span-2 size-[17px] text-muted-foreground transition-opacity ${schedule.paused ? "opacity-50" : ""}`} />
            <p title={schedule.prompt} className={`col-start-2 truncate transition-opacity ${schedule.paused ? "opacity-50" : ""}`}>
              <ReferenceText text={schedule.prompt} known={known} bots={bots} />
            </p>
            <p className="col-start-2 row-start-2 truncate text-[0.8125rem] text-muted-foreground tabular-nums">{when}</p>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Routine actions"
                    className="col-start-3 row-span-2 row-start-1 text-muted-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
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
                <DropdownMenuItem onClick={() => void client.setSchedulePaused(schedule.id, !schedule.paused)}>
                  {schedule.paused ? <PlayIcon /> : <CirclePauseIcon />}
                  {schedule.paused ? "Resume" : "Pause"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={remove}>
                  <Trash2Icon />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </Collapse>
        <Collapse open={editing}>
          {formKey.current > 0 && <RoutineForm key={formKey.current} botId={botId} schedule={schedule} onDone={endEdit} />}
        </Collapse>
      </div>
    </Collapse>
  );
}

export function Routines({ botId }: { botId: BotId }) {
  const schedules = useStore(client.schedules(botId));
  const skills = useStore(client.skills(botId));
  const bots = useStore(client.bots);
  const known = knownNames(
    skills.map((skill) => skill.name),
    bots.map((bot) => bot.name),
  );
  const newRoutine = useRef<HTMLButtonElement>(null);
  // The one form that is open: NEW_ROUTINE, the id of the routine in edit, or none.
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [formRound, setFormRound] = useState(0);
  const adding = openForm === NEW_ROUTINE;

  const open = (form: string) => {
    setFormRound((round) => round + 1);
    setOpenForm(form);
  };

  const close = () => setOpenForm(null);

  const focusNewRoutine = () => requestAnimationFrame(() => newRoutine.current?.focus());

  return (
    <section className="flex flex-col gap-1">
      <div className="flex h-7 items-center justify-between">
        <h2 className={PANE_LABEL}>Routines</h2>
        <Button
          ref={newRoutine}
          variant="ghost"
          size="icon-sm"
          aria-label={adding ? "Cancel" : "New routine"}
          className="text-muted-foreground"
          onClick={() => (adding ? close() : open(NEW_ROUTINE))}
        >
          {adding ? <XIcon /> : <PlusIcon />}
        </Button>
      </div>

      {schedules.length === 0 && !adding && <p className={PANE_EMPTY}>No routines yet.</p>}

      {schedules.length > 0 && (
        <div className="-mb-1">
          {schedules.map((schedule) => (
            <RoutineRow
              key={schedule.id}
              botId={botId}
              schedule={schedule}
              known={known}
              editing={openForm === schedule.id}
              editRound={formRound}
              onEdit={() => open(schedule.id)}
              onEditEnd={close}
              onRemoved={focusNewRoutine}
            />
          ))}
        </div>
      )}

      <div className="-mt-1">
        <Collapse open={adding}>
          <RoutineForm
            botId={botId}
            onDone={() => {
              close();
              focusNewRoutine();
            }}
            className="pt-1"
          />
        </Collapse>
      </div>
    </section>
  );
}
