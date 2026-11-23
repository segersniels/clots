import type { BotId } from "@clots/contracts";
import { CirclePauseIcon, ClockIcon, PlusIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { client, useStore } from "../client.ts";

const CUSTOM = "custom";

const PRESETS = [
  { label: "Every day at 8:00 AM", value: "0 8 * * *" },
  { label: "Weekdays at 9:00 AM", value: "0 9 * * 1-5" },
  { label: "Weekdays at 6:00 PM", value: "0 18 * * 1-5" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Mondays at 9:00 AM", value: "0 9 * * 1" },
];

const OPTIONS = [...PRESETS, { label: "Custom cron", value: CUSTOM }];

/** Describes when a routine runs. A cron expression without a preset shows as it is. */
const describe = (cron: string) => PRESETS.find((preset) => preset.value === cron)?.label ?? cron;

export function Routines({ botId }: { botId: BotId }) {
  const schedules = useStore(client.schedules(botId));
  const [adding, setAdding] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [preset, setPreset] = useState(PRESETS[0]!.value);
  const [customCron, setCustomCron] = useState("");
  const [error, setError] = useState(false);

  const create = async (event: FormEvent) => {
    event.preventDefault();

    try {
      await client.createSchedule(botId, preset === CUSTOM ? customCron.trim() : preset, prompt.trim());
      setPrompt("");
      setError(false);
      setAdding(false);
    } catch {
      // The server rejects a cron expression that it cannot parse.
      setError(true);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm text-muted-foreground">Routines</h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={adding ? "Cancel" : "New routine"}
          className="text-muted-foreground"
          onClick={() => setAdding(!adding)}
        >
          {adding ? <XIcon /> : <PlusIcon />}
        </Button>
      </div>

      {schedules.length === 0 && !adding && <p className="text-sm text-muted-foreground">No routines yet.</p>}

      {schedules.map((schedule) => (
        <div key={schedule.id} className="group flex items-center gap-2 py-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={schedule.paused ? "Resume routine" : "Pause routine"}
            className={schedule.paused ? "text-muted-foreground" : "text-emerald-500 hover:text-emerald-500"}
            onClick={() => client.setSchedulePaused(schedule.id, !schedule.paused)}
          >
            {schedule.paused ? <CirclePauseIcon className="size-5" /> : <ClockIcon className="size-5" />}
          </Button>

          <div className="min-w-0 flex-1">
            <p className="truncate">{schedule.prompt}</p>
            <p className="truncate text-sm text-muted-foreground">
              {schedule.paused ? "Paused" : describe(schedule.cron)}
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Delete routine"
            className="text-muted-foreground opacity-0 group-hover:opacity-100"
            onClick={() => client.deleteSchedule(schedule.id)}
          >
            <XIcon />
          </Button>
        </div>
      ))}

      {adding && (
        <form onSubmit={create} className="flex flex-col gap-2">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={2}
            required
            autoFocus
            placeholder="Morning briefing"
            className="resize-none"
          />
          <Select items={OPTIONS} value={preset} onValueChange={(value) => setPreset(value as string)}>
            <SelectTrigger className="w-full" aria-label="Schedule">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {preset === CUSTOM && (
            <Input
              value={customCron}
              onChange={(event) => setCustomCron(event.target.value)}
              required
              placeholder="0 8 * * *"
              aria-label="Cron expression"
              aria-invalid={error}
              className="font-mono"
            />
          )}
          {error && <p className="text-xs text-destructive">This cron expression is not valid.</p>}
          <Button type="submit" className="self-start">
            Add routine
          </Button>
        </form>
      )}
    </section>
  );
}
