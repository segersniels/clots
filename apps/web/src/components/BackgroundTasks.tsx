import type { BackgroundTask, BotId } from "@clots/contracts";
import { BotIcon, LoaderCircleIcon, SquareIcon, TerminalIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMountEffect } from "@/hooks/use-mount-effect";

import { client, useStore } from "../client.ts";

/** How long a row or the pill takes to fade out. */
const FADE_MS = 150;

interface Row {
  readonly task: BackgroundTask;
  readonly leaving: boolean;
}

/** Keeps the rows in place and marks the ones whose task ended, so they can fade out where they were. New tasks come last. */
const mergeRows = (rows: ReadonlyArray<Row>, tasks: ReadonlyArray<BackgroundTask>): Row[] => [
  ...rows.map((row) => {
    const task = tasks.find((candidate) => candidate.id === row.task.id);

    return { task: task ?? row.task, leaving: task === undefined };
  }),
  ...tasks
    .filter((task) => !rows.some((row) => row.task.id === task.id))
    .map((task) => ({ task, leaving: false })),
];

/** Removes the rows whose task ended once their fade is over. It mounts again for each new set of ending rows, so each gets its full fade. */
function RemoveEndedRows({ onFaded }: { onFaded: () => void }) {
  useMountEffect(() => {
    const timer = setTimeout(onFaded, FADE_MS);

    return () => clearTimeout(timer);
  });

  return null;
}

/**
 * Shows the bot's work in the background as a pill in the thread header. Its popover lists each task,
 * and the stop button of a row stops that task. Without tasks, the pill fades out. A narrow header keeps only
 * the number, so the name stays centered.
 */
export function BackgroundTasks({ botId }: { botId: BotId }) {
  const { tasks } = useStore(client.thread(botId)).live;
  const [rows, setRows] = useState<Row[]>(() => mergeRows([], tasks));
  const [syncedTasks, setSyncedTasks] = useState(tasks);
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [lastCount, setLastCount] = useState(tasks.length);

  if (syncedTasks !== tasks) {
    setSyncedTasks(tasks);
    setRows(mergeRows(rows, tasks));

    if (tasks.length > 0) {
      setLastCount(tasks.length);
    }
  }

  // The popover has nothing left to show once the last task ends.
  if (open && tasks.length === 0) {
    setOpen(false);
  }

  if (rows.length === 0) {
    return null;
  }

  const count = tasks.length > 0 ? tasks.length : lastCount;
  const leavingIds = rows
    .filter((row) => row.leaving)
    .map((row) => row.task.id)
    .join(" ");

  return (
    <>
      {/* A row whose task ended goes once its fade is over. */}
      {leavingIds !== "" && (
        <RemoveEndedRows
          key={leavingIds}
          onFaded={() => setRows((current) => current.filter((row) => !row.leaving))}
        />
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="secondary"
              className={`gap-2 rounded-full px-2.5 font-medium transition-[opacity,background-color] duration-150 starting:opacity-0 data-popup-open:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] motion-reduce:transition-none ${tasks.length === 0 ? "pointer-events-none opacity-0" : ""}`}
            />
          }
        >
          {/* The turn runs on a box around the icon, so the browser does not draw the page again on every frame. */}
          <span className="inline-flex size-4 shrink-0 animate-spin motion-reduce:animate-none">
            <LoaderCircleIcon className="size-full" />
          </span>
          <span>
            {count}
            <span className="hidden @min-[7.5rem]:inline"> running</span>
          </span>
        </PopoverTrigger>
        {/* Only a keyboard open moves focus to the first stop button, so a click shows no focus ring. */}
        <PopoverContent
          align="end"
          collisionPadding={8}
          initialFocus={(openType) => openType === "keyboard"}
          className="max-h-53.5 w-80 gap-0 overflow-y-auto p-1"
        >
          {rows.map(({ task, leaving }) => (
            <div
              key={task.id}
              className={`flex items-center gap-1.5 rounded-md py-1 pr-1 pl-1.5 text-sm transition-opacity duration-150 starting:opacity-0 motion-reduce:transition-none ${leaving ? "opacity-0" : ""}`}
            >
              {task.kind === "agent" ? (
                <BotIcon className="size-4 text-muted-foreground" />
              ) : (
                <TerminalIcon className="size-4 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{task.description}</span>
              <Button
                variant="secondary"
                size="icon-xs"
                aria-label={`Stop ${task.description}`}
                disabled={leaving || stopping.has(task.id)}
                className="rounded-full"
                onClick={() => {
                  setStopping((current) => new Set(current).add(task.id));
                  void client.stopTask(botId, task.id);
                }}
              >
                <SquareIcon className="size-2.5 fill-current" />
              </Button>
            </div>
          ))}
        </PopoverContent>
      </Popover>
    </>
  );
}
