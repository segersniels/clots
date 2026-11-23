import { SqliteClient } from "@effect/sql-sqlite-bun";
import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClotsConfig } from "../config.ts";
import { MigrationsLayer } from "../persistence/Migrations.ts";
import { BotRepository } from "./BotRepository.ts";

const newScout = { name: "Scout", instructions: "", color: "blue", shape: "circle" } as const;
const newAtlas = { ...newScout, name: "Atlas" };

/** Runs a repository program against a new in-memory database. */
const run = <A>(program: Effect.Effect<A, never, BotRepository>) => {
  const config = Layer.succeed(ClotsConfig, {
    home: mkdtempSync(join(tmpdir(), "clots-test-")),
    port: 0,
    claudePath: "claude",
    webRoot: undefined,
  });
  const sql = MigrationsLayer.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })));

  return Effect.runPromise(
    program.pipe(Effect.provide(BotRepository.layer.pipe(Layer.provide([config, sql])))),
  );
};

test("a new bot gets a working directory, a thread and its own browser port", async () => {
  const [first, second] = await run(
    Effect.gen(function* () {
      const bots = yield* BotRepository;

      return [yield* bots.create({ ...newScout, instructions: "Be brief." }), yield* bots.create(newAtlas)] as const;
    }),
  );

  expect(first.workingDirectory).toEndWith(first.id);
  expect(first.sdkSessionId).toBeNull();
  expect(second.browserStreamPort).toBe(first.browserStreamPort + 1);
});

test("messages get rising sequences per bot, and the cursor skips what a client has", async () => {
  const afterFirst = await run(
    Effect.gen(function* () {
      const bots = yield* BotRepository;
      const scout = yield* bots.create(newScout);
      const atlas = yield* bots.create(newAtlas);

      yield* bots.appendMessage(scout.id, "user", "one");
      yield* bots.appendMessage(atlas.id, "user", "other bot");
      yield* bots.appendMessage(scout.id, "assistant", "two");

      return yield* bots.messagesAfter(scout.id, 1);
    }),
  );

  expect(afterFirst.map((message) => [message.sequence, message.text])).toEqual([[2, "two"]]);
});

test("the stored session id comes back, so a restart resumes the same session", async () => {
  const bot = await run(
    Effect.gen(function* () {
      const bots = yield* BotRepository;
      const created = yield* bots.create(newScout);
      yield* bots.setSdkSessionId(created.id, "session-1");

      return yield* bots.find(created.id);
    }),
  );

  expect(bot?.sdkSessionId).toBe("session-1");
});
