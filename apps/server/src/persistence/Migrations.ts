import { SqliteMigrator } from "@effect/sql-sqlite-bun";
import { Effect } from "effect";
import { SqlClient } from "effect/sql";

const initial = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE bots (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      instructions TEXT NOT NULL,
      color TEXT NOT NULL,
      shape TEXT NOT NULL,
      model TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      browser_stream_port INTEGER NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL UNIQUE REFERENCES bots (id),
      sdk_session_id TEXT,
      created_at INTEGER NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES threads (id),
      sequence INTEGER NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (thread_id, sequence)
    )
  `;

  yield* sql`
    CREATE TABLE schedules (
      id TEXT PRIMARY KEY,
      bot_id TEXT NOT NULL REFERENCES bots (id),
      cron TEXT NOT NULL,
      prompt TEXT NOT NULL,
      paused INTEGER NOT NULL DEFAULT 0,
      next_run_at INTEGER NOT NULL
    )
  `;
});

/** Runs the pending migrations when the server starts. */
export const MigrationsLayer = SqliteMigrator.layer({
  loader: SqliteMigrator.fromRecord({
    "0001_initial": initial,
  }),
});
