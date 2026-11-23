import type { BotId, Schedule } from "@clots/contracts";
import { Context, Cron, Effect, Layer, PubSub, Result } from "effect";
import { SqlClient } from "effect/sql";

/** Routines use the time zone of the host, so "every day at 8:00" means 8:00 for the operator. */
const HOST_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Computes the next run of a cron expression. Returns `undefined` when the expression is not valid. */
export const nextRunAt = (cron: string, now: number): number | undefined => {
  const parsed = Cron.parse(cron, HOST_TIME_ZONE);
  if (Result.isFailure(parsed)) return undefined;

  return Cron.next(parsed.success, now).getTime();
};

interface ScheduleRow extends Omit<Schedule, "paused"> {
  readonly paused: number;
}

const toSchedule = (row: ScheduleRow): Schedule => ({ ...row, paused: row.paused === 1 });

export class ScheduleRepository extends Context.Service<
  ScheduleRepository,
  {
    list(botId: BotId): Effect.Effect<ReadonlyArray<Schedule>>;
    /** Lists the schedules whose run time passed, including the paused ones. */
    due(now: number): Effect.Effect<ReadonlyArray<Schedule>>;
    create(botId: BotId, cron: string, prompt: string, nextRunAt: number): Effect.Effect<Schedule>;
    setPaused(id: string, paused: boolean): Effect.Effect<void>;
    setNextRunAt(id: string, nextRunAt: number): Effect.Effect<void>;
    remove(id: string): Effect.Effect<void>;
    /** Fires after each write, so that clients can read the list again. */
    readonly changes: PubSub.PubSub<void>;
  }
>()("clots/schedules/ScheduleRepository") {
  static readonly layer = Layer.effect(
    ScheduleRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const changes = yield* PubSub.unbounded<void>();

      const columns = sql`id, bot_id AS botId, cron, prompt, paused, next_run_at AS nextRunAt`;

      const write = (statement: Effect.Effect<unknown, unknown>) =>
        statement.pipe(
          Effect.orDie,
          Effect.andThen(PubSub.publish(changes, undefined)),
          Effect.asVoid,
        );

      return ScheduleRepository.of({
        changes,

        list: (botId) =>
          sql<ScheduleRow>`
            SELECT ${columns} FROM schedules WHERE bot_id = ${botId} ORDER BY next_run_at
          `.pipe(Effect.map((rows) => rows.map(toSchedule)), Effect.orDie),

        due: (now) =>
          sql<ScheduleRow>`
            SELECT ${columns} FROM schedules WHERE next_run_at <= ${now}
          `.pipe(Effect.map((rows) => rows.map(toSchedule)), Effect.orDie),

        create: (botId, cron, prompt, nextRunAt) => {
          const schedule: Schedule = { id: crypto.randomUUID(), botId, cron, prompt, paused: false, nextRunAt };

          return write(sql`
            INSERT INTO schedules (id, bot_id, cron, prompt, next_run_at)
            VALUES (${schedule.id}, ${botId}, ${cron}, ${prompt}, ${nextRunAt})
          `).pipe(Effect.as(schedule));
        },

        setPaused: (id, paused) =>
          write(sql`UPDATE schedules SET paused = ${paused ? 1 : 0} WHERE id = ${id}`),

        setNextRunAt: (id, nextRunAt) =>
          write(sql`UPDATE schedules SET next_run_at = ${nextRunAt} WHERE id = ${id}`),

        remove: (id) => write(sql`DELETE FROM schedules WHERE id = ${id}`),
      });
    }),
  );
}
