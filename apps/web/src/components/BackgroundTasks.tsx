import type { BackgroundTask, BotId } from "@clots/contracts";
import { BotIcon, LoaderCircleIcon, SquareIcon, TerminalIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

/**
 * Shows the bot's work in the background as a pill in the thread header. Its menu lists each task,
 * and picking a row stops that task. Without tasks, the pill fades out. A narrow header keeps only
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

  // The menu has nothing left to show once the last task ends.
  if (open && tasks.length === 0) {
    setOpen(false);
  }

  // A row whose task ended goes once its fade is over.
  useEffect(() => {
    if (!rows.some((row) => row.leaving)) {
      return;
    }

    const timer = setTimeout(
      () => setRows((current) => current.filter((row) => !row.leaving)),
      FADE_MS,
    );

    return () => clearTimeout(timer);
  }, [rows]);

  if (rows.length === 0) {
    return null;
  }

  const count = tasks.length > 0 ? tasks.length : lastCount;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="secondary"
            className={`gap-2 rounded-full px-2.5 font-medium transition-[opacity,background-color] duration-150 starting:opacity-0 data-popup-open:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] motion-reduce:transition-none ${tasks.length === 0 ? "pointer-events-none opacity-0" : ""}`}
          />
        }
      >
        <LoaderCircleIcon className="size-4 animate-spin motion-reduce:animate-none" />
        <span>
          {count}
          <span className="hidden @min-[7.5rem]:inline"> running</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} className="max-h-53.5 w-80">
        {rows.map(({ task, leaving }) => (
          <DropdownMenuItem
            key={task.id}
            aria-label={`Stop ${task.description}`}
            closeOnClick={false}
            disabled={leaving || stopping.has(task.id)}
            className={`py-1 pr-1 transition-opacity duration-150 starting:opacity-0 motion-reduce:transition-none ${leaving ? "opacity-0" : ""}`}
            onClick={() => {
              setStopping((current) => new Set(current).add(task.id));
              void client.stopTask(botId, task.id);
            }}
          >
            {task.kind === "agent" ? (
              <BotIcon className="text-muted-foreground" />
            ) : (
              <TerminalIcon className="text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">{task.description}</span>
            <span className="flex size-5 items-center justify-center rounded-sm text-muted-foreground group-focus/dropdown-menu-item:bg-[color-mix(in_oklch,var(--accent),var(--foreground)_8%)] group-focus/dropdown-menu-item:text-foreground">
              <SquareIcon className="size-2.5 fill-current" />
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
