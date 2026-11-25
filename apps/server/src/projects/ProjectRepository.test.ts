import { SqliteClient } from "@effect/sql-sqlite-bun";
import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BotRepository } from "../bots/BotRepository.ts";
import { ClotsConfig } from "../config.ts";
import { MigrationsLayer } from "../persistence/Migrations.ts";
import { ProjectRepository } from "./ProjectRepository.ts";

const newScout = { name: "Scout", instructions: "", color: "blue", shape: "drop" } as const;

/** Runs a repository program against a new in-memory database. */
const run = <A>(program: Effect.Effect<A, never, BotRepository | ProjectRepository>) => {
  const config = Layer.succeed(ClotsConfig, {
    home: mkdtempSync(join(tmpdir(), "clots-test-")),
    port: 0,
    claudePath: "claude",
    webRoot: undefined,
    webDevPort: undefined,
    tailnet: false,
  });
  const sql = MigrationsLayer.pipe(
    Layer.provideMerge(SqliteClient.layer({ filename: ":memory:" })),
  );
  const repositories = Layer.mergeAll(BotRepository.layer, ProjectRepository.layer);

  return Effect.runPromise(
    program.pipe(Effect.provide(repositories.pipe(Layer.provide(sql), Layer.provide(config)))),
  );
};

test("a removed project moves its bots to no project, and a bot that left its directory forgets the session", async () => {
  const [projects, bots] = await run(
    Effect.gen(function* () {
      const projects = yield* ProjectRepository;
      const bots = yield* BotRepository;
      const repo = yield* projects.create("Repo", "/srv/repo");
      const kept = yield* projects.create("Kept", null);
      const inRepo = yield* bots.create({ ...newScout, projectId: repo.id });
      const inKept = yield* bots.create({ ...newScout, name: "Atlas", projectId: kept.id });
      yield* bots.setSdkSessionId(inRepo.id, "session-1");
      yield* bots.setSdkSessionId(inKept.id, "session-2");

      yield* projects.remove(repo.id);

      return [yield* projects.list, yield* bots.list] as const;
    }),
  );

  expect(projects.map((project) => project.name)).toEqual(["Kept"]);
  expect(bots.map((bot) => [bot.name, bot.projectName, bot.sdkSessionId])).toEqual([
    ["Scout", null, null],
    ["Atlas", "Kept", "session-2"],
  ]);
});

test("a rename changes only the name", async () => {
  const [project] = await run(
    Effect.gen(function* () {
      const projects = yield* ProjectRepository;
      const created = yield* projects.create("Old", "/srv/repo");
      yield* projects.rename(created.id, "New");

      return yield* projects.list;
    }),
  );

  expect([project?.name, project?.directory]).toEqual(["New", "/srv/repo"]);
});
