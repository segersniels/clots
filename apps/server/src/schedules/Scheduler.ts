import { Effect, Layer, Schedule } from "effect";

import { BotRepository } from "../bots/BotRepository.ts";
import { BotSessions } from "../bots/BotSessions.ts";
import { nextRunAt, ScheduleRepository } from "./ScheduleRepository.ts";

/** Sends the prompt of each due schedule to the bot that runs it, then moves the schedule to its next run. */
const runDueSchedules = Effect.gen(function* () {
  const schedules = yield* ScheduleRepository;
  const bots = yield* BotRepository;
  const sessions = yield* BotSessions;
  const now = Date.now();

  for (const schedule of yield* schedules.due(now)) {
    const next = nextRunAt(schedule.cron, now);
    const bot = yield* bots.find(schedule.botId);

    // The create call validates the cron, so this guard only protects against edited rows.
    if (next === undefined || bot === undefined) {
      yield* schedules.setPaused(schedule.id, true);

      continue;
    }

    // A run that was missed while the server was down fires once, not once per missed slot.
    yield* schedules.setNextRunAt(schedule.id, next);

    // A paused schedule still moves forward, so that it does not fire at once when it resumes.
    if (schedule.paused) {
      continue;
    }

    yield* sessions.runRoutine(bot, schedule);
  }
});

/** Checks for due routines for as long as the server runs. */
export const SchedulerLayer = Layer.effectDiscard(
  runDueSchedules.pipe(Effect.repeat(Schedule.spaced("15 seconds")), Effect.forkScoped),
);
