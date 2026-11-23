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

const projects = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      directory TEXT,
      created_at INTEGER NOT NULL
    )
  `;

  yield* sql`ALTER TABLE bots ADD COLUMN project_id TEXT REFERENCES projects (id)`;
});

const attachments = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A JSON list of the files that came with the message. The bytes are in the bot's notes directory.
  yield* sql`ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'`;
});

const traces = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A JSON list of the tool calls of a trace message.
  yield* sql`ALTER TABLE messages ADD COLUMN steps TEXT NOT NULL DEFAULT '[]'`;
});

const characters = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The flat outlines became clot shapes. Each bot gets the clot that is closest to its old outline.
  yield* sql`
    UPDATE bots SET shape = CASE shape
      WHEN 'circle' THEN 'drop'
      WHEN 'oval' THEN 'bean'
      WHEN 'square' THEN 'tumble'
      WHEN 'pill' THEN 'twin'
      WHEN 'triangle' THEN 'trio'
      WHEN 'hexagon' THEN 'bud'
      WHEN 'cloud' THEN 'puddle'
      WHEN 'drop' THEN 'lump'
      ELSE shape
    END
  `;
});

const unread = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The operator can mark a thread as unread to come back to it later.
  yield* sql`ALTER TABLE threads ADD COLUMN unread INTEGER NOT NULL DEFAULT 0`;
});

const skills = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A JSON list of the skills that the bot's last session reported, so the composer can offer them while no session runs.
  yield* sql`ALTER TABLE threads ADD COLUMN skills TEXT NOT NULL DEFAULT '[]'`;
});

/** Runs the pending migrations when the server starts. */
export const MigrationsLayer = SqliteMigrator.layer({
  loader: SqliteMigrator.fromRecord({
    "0001_initial": initial,
    "0002_projects": projects,
    "0003_attachments": attachments,
    "0004_traces": traces,
    "0005_characters": characters,
    "0006_unread": unread,
    "0007_skills": skills,
  }),
});
