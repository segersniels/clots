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

const clones = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The bot that cloned this bot. No foreign key: deleting an orchestrator must not fail because of its clones.
  yield* sql`ALTER TABLE bots ADD COLUMN cloned_from TEXT`;
});

const sortOrder = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // The operator orders the bots of a group by hand. Existing bots keep the order of their creation.
  yield* sql`ALTER TABLE bots ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`;
  yield* sql`UPDATE bots SET sort_order = (SELECT COUNT(*) FROM bots AS earlier WHERE earlier.created_at <= bots.created_at)`;
});

const resume = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // A session that outlives a server restart keeps working. The server follows it from its transcript after the last message it handled.
  yield* sql`ALTER TABLE threads ADD COLUMN claude_pid INTEGER`;
  yield* sql`ALTER TABLE threads ADD COLUMN synced_uuid TEXT`;
});

const search = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  /*
   * The search finds the words of a conversation: the operator's, the bots' and the routines'. Tool
   * steps and dividers stay out. A row shares its rowid with its message, which keeps a delete fast.
   * A VACUUM could number the messages again, so clots must not run one.
   */
  yield* sql`CREATE VIRTUAL TABLE message_search USING fts5(text)`;
  yield* sql`
    CREATE TRIGGER message_search_insert AFTER INSERT ON messages
    WHEN new.role IN ('user', 'assistant', 'bot', 'routine')
    BEGIN
      INSERT INTO message_search (rowid, text) VALUES (new.rowid, new.text);
    END
  `;
  yield* sql`
    CREATE TRIGGER message_search_delete AFTER DELETE ON messages
    BEGIN
      DELETE FROM message_search WHERE rowid = old.rowid;
    END
  `;
  yield* sql`
    INSERT INTO message_search (rowid, text)
    SELECT rowid, text FROM messages WHERE role IN ('user', 'assistant', 'bot', 'routine')
  `;
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
    "0008_clones": clones,
    "0009_sort_order": sortOrder,
    "0010_resume": resume,
    "0011_search": search,
  }),
});
