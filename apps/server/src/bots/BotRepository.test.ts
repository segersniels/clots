import { SqliteClient } from "@effect/sql-sqlite-bun";
import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ClotsConfig } from "../config.ts";
import { MigrationsLayer } from "../persistence/Migrations.ts";
import { BotRepository } from "./BotRepository.ts";

const newScout = { name: "Scout", instructions: "", color: "blue", shape: "drop" } as const;
const newAtlas = { ...newScout, name: "Atlas" };

/** Runs a repository program against a new in-memory database. */
const run = <A>(program: Effect.Effect<A, never, BotRepository | SqlClient.SqlClient>) => {
  const config = Layer.succeed(ClotsConfig, {
    home: mkdtempSync(join(tmpdir(), "clots-test-")),
    port: 0,
    claudePath: "claude",
    webRoot: undefined,
    webDevPort: undefined,
    tailnet: false,
  });
  const sql = MigrationsLayer.pipe(Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })));

  return Effect.runPromise(
    program.pipe(Effect.provide(BotRepository.layer.pipe(Layer.provideMerge(sql), Layer.provide(config)))),
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

test("a trace keeps its steps, and the bot list shows the last message before it", async () => {
  const [messages, bot] = await run(
    Effect.gen(function* () {
      const bots = yield* BotRepository;
      const scout = yield* bots.create(newScout);

      yield* bots.appendMessage(scout.id, "assistant", "On it.");
      yield* bots.appendMessage(scout.id, "trace", "", [], [{ id: "tool-1", title: "Read the log", status: "done" }]);

      return [yield* bots.messagesAfter(scout.id, 0), yield* bots.find(scout.id)] as const;
    }),
  );

  expect(messages.at(-1)?.steps).toEqual([{ id: "tool-1", title: "Read the log", status: "done" }]);
  expect(bot?.lastMessageText).toBe("On it.");
});

test("an update changes only the given fields", async () => {
  const bot = await run(
    Effect.gen(function* () {
      const bots = yield* BotRepository;
      const created = yield* bots.create(newScout);
      yield* bots.update(created.id, { color: "purple" });
      yield* bots.update(created.id, { shape: "puddle" });

      return yield* bots.find(created.id);
    }),
  );

  expect([bot?.name, bot?.color, bot?.shape]).toEqual(["Scout", "purple", "puddle"]);
});

test("a move to a project with another directory forgets the session, and a move without a directory change keeps it", async () => {
  const sessions = await run(
    Effect.gen(function* () {
      const bots = yield* BotRepository;
      const sql = yield* SqlClient.SqlClient;
      const bot = yield* bots.create(newScout);
      yield* sql`INSERT INTO projects (id, name, directory, created_at) VALUES ('plain', 'Plain', NULL, 0), ('repo', 'Repo', '/srv/repo', 0)`;

      yield* bots.setSdkSessionId(bot.id, "session-1");
      yield* bots.setProject(bot.id, "plain");
      const afterPlainMove = (yield* bots.find(bot.id))?.sdkSessionId;

      yield* bots.setProject(bot.id, "repo");
      const afterDirectoryMove = (yield* bots.find(bot.id))?.sdkSessionId;

      return [afterPlainMove, afterDirectoryMove];
    }).pipe(Effect.orDie),
  );

  expect(sessions).toEqual(["session-1", null]);
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

test("the unread mark comes back until the operator clears it", async () => {
  const marks = await run(
    Effect.gen(function* () {
      const bots = yield* BotRepository;
      const bot = yield* bots.create(newScout);
      const initial = (yield* bots.find(bot.id))?.unread;

      yield* bots.setUnread(bot.id, true);
      const marked = (yield* bots.find(bot.id))?.unread;

      yield* bots.setUnread(bot.id, false);
      const cleared = (yield* bots.find(bot.id))?.unread;

      return [initial, marked, cleared];
    }),
  );

  expect(marks).toEqual([false, true, false]);
});

test("the clones of a bot move with it, and a bot without that link stays", async () => {
  const projects = await run(
    Effect.gen(function* () {
      const bots = yield* BotRepository;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO projects (id, name, directory, created_at) VALUES ('site', 'Site', NULL, 0)`;
      const scout = yield* bots.create(newScout);
      yield* bots.create({ ...newScout, name: "Scout clone", clonedFrom: scout.id });
      yield* bots.create(newAtlas);

      yield* bots.setProject(scout.id, "site");

      return Object.fromEntries((yield* bots.list).map((bot) => [bot.name, bot.projectId]));
    }).pipe(Effect.orDie),
  );

  expect(projects).toEqual({ Scout: "site", "Scout clone": "site", Atlas: null });
});

test("a removed bot leaves no rows and no notes directory, and the other bots stay", async () => {
  const [scout, remaining, orphanRows] = await run(
    Effect.gen(function* () {
      const bots = yield* BotRepository;
      const sql = yield* SqlClient.SqlClient;
      const scout = yield* bots.create(newScout);
      yield* bots.create(newAtlas);
      yield* bots.appendMessage(scout.id, "user", "one");
      yield* sql`INSERT INTO schedules (id, bot_id, cron, prompt, next_run_at) VALUES ('daily', ${scout.id}, '0 8 * * *', 'Report', 0)`;

      yield* bots.remove(scout);

      const counts = yield* sql<{ count: number }>`
        SELECT (SELECT COUNT(*) FROM messages) + (SELECT COUNT(*) FROM schedules) AS count
      `;

      return [scout, (yield* bots.list).map((bot) => bot.name), counts[0]?.count] as const;
    }).pipe(Effect.orDie),
  );

  expect(existsSync(scout.workingDirectory)).toBe(false);
  expect(remaining).toEqual(["Atlas"]);
  expect(orphanRows).toBe(0);
});

test("the operator's order holds, a new bot comes last, and a bot that joins a group goes to its end", async () => {
  const [reordered, afterJoin] = await run(
    Effect.gen(function* () {
      const bots = yield* BotRepository;
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO projects (id, name, directory, created_at) VALUES ('site', 'Site', NULL, 0)`;
      const scout = yield* bots.create(newScout);
      const atlas = yield* bots.create(newAtlas);
      const nova = yield* bots.create({ ...newScout, name: "Nova" });
      const names = Effect.map(bots.list, (list) => list.filter((bot) => bot.projectId === null).map((bot) => bot.name));

      yield* bots.reorder([nova.id, scout.id, atlas.id]);
      yield* bots.create({ ...newScout, name: "Late" });
      const reordered = yield* names;

      yield* bots.setProject(nova.id, "site");
      yield* bots.setProject(nova.id, null);

      return [reordered, yield* names] as const;
    }).pipe(Effect.orDie),
  );

  expect(reordered).toEqual(["Nova", "Scout", "Atlas", "Late"]);
  expect(afterJoin).toEqual(["Scout", "Atlas", "Late", "Nova"]);
});
