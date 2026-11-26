import { SqliteClient } from "@effect/sql-sqlite-bun";
import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";

import type { BotId } from "@clots/contracts";

import { MigrationsLayer } from "../persistence/Migrations.ts";
import { nextRunAt, ScheduleRepository } from "./ScheduleRepository.ts";

test("the next run of a daily routine is within one day", () => {
  const now = Date.now();
  const next = nextRunAt("0 8 * * *", now);

  expect(next).toBeGreaterThan(now);
  expect(next! - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  expect(new Date(next!).getHours()).toBe(8);
});

test("a cron expression that does not parse has no next run", () => {
  expect(nextRunAt("every morning", Date.now())).toBeUndefined();
});

test("an edited routine gets its new schedule and prompt, and stays paused", async () => {
  const sql = MigrationsLayer.pipe(
    Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
  );
  const [edited] = await Effect.runPromise(
    Effect.gen(function* () {
      const schedules = yield* ScheduleRepository;
      const botId = "bot" as BotId;
      const created = yield* schedules.create(botId, "0 9 * * *", "Morning briefing", 1, "here");
      yield* schedules.setPaused(created.id, true);
      yield* schedules.update(created.id, "0 18 * * 1-5", "/commit the day", 2);

      return yield* schedules.list(botId);
    }).pipe(Effect.provide(ScheduleRepository.layer.pipe(Layer.provideMerge(sql)))),
  );

  expect(edited).toMatchObject({
    cron: "0 18 * * 1-5",
    prompt: "/commit the day",
    paused: true,
    nextRunAt: 2,
  });
});
