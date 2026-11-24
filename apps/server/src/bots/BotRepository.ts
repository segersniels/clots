import type { Attachment, Bot, BotId, BotModel, Message, MessageRole, Skill, TraceStep } from "@clots/contracts";

/** The fields that the operator chooses for a new bot. */
export type NewBot = Pick<Bot, "name" | "instructions" | "color" | "shape">;

/** The fields of a bot that an update can change. A field that is absent keeps its value. */
export type BotChanges = { readonly [Field in keyof NewBot]?: NewBot[Field] | undefined };
import { Context, Effect, Layer } from "effect";
import { SqlClient, type Statement } from "effect/sql";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { ClotsConfig } from "../config.ts";

/** The model of a new bot. The operator changes it per bot. */
const DEFAULT_MODEL: BotModel = "opus";

/** The first port that clots gives to a bot's browser stream. */
const FIRST_BROWSER_STREAM_PORT = 48100;

/** A bot with the host fields that clients do not see. */
export interface StoredBot extends Bot {
  readonly workingDirectory: string;
  readonly browserStreamPort: number;
  readonly sdkSessionId: string | null;
  /** The `claude` process of the bot's session. It stays set when a server restart cuts the session off. */
  readonly claudePid: number | null;
  /** The last transcript entry of the session that the thread has. */
  readonly syncedUuid: string | null;
  readonly projectName: string | null;
  /** The directory of the bot's project. The bot works there when it is set. */
  readonly projectDirectory: string | null;
  readonly lastMessageText: string | null;
  readonly lastMessageAt: number | null;
  readonly unread: boolean;
}

/** A bot as SQLite returns it: the unread flag is an integer. */
interface BotRow extends Omit<StoredBot, "unread"> {
  readonly unread: number;
}

const toStoredBot = (row: BotRow): StoredBot => ({ ...row, unread: row.unread === 1 });

/** A message as SQLite returns it: the attachment list is JSON text. */
interface MessageRow extends Omit<Message, "attachments" | "steps"> {
  readonly attachments: string;
  readonly steps: string;
}

const toMessage = (row: MessageRow): Message => ({
  ...row,
  attachments: JSON.parse(row.attachments),
  steps: JSON.parse(row.steps),
});

export class BotRepository extends Context.Service<
  BotRepository,
  {
    readonly list: Effect.Effect<ReadonlyArray<StoredBot>>;
    find(botId: BotId): Effect.Effect<StoredBot | undefined>;
    /** Creates a bot with the default model and no project, unless a copy brings its own. */
    create(bot: NewBot & Partial<Pick<Bot, "model" | "projectId" | "clonedFrom">>): Effect.Effect<StoredBot>;
    /** Deletes the bot, its thread, its routines and its notes directory. */
    remove(bot: StoredBot): Effect.Effect<void>;
    setUnread(botId: BotId, unread: boolean): Effect.Effect<void>;
    setSdkSessionId(botId: BotId, sdkSessionId: string): Effect.Effect<void>;
    setClaudePid(botId: BotId, pid: number | null): Effect.Effect<void>;
    setSyncedUuid(botId: BotId, uuid: string): Effect.Effect<void>;
    /** Changes only the given fields, so that two quick edits do not undo each other. */
    update(botId: BotId, changes: BotChanges): Effect.Effect<void>;
    setModel(botId: BotId, model: BotModel): Effect.Effect<void>;
    /**
     * Moves the bot and its clones to a project. A move to another directory also forgets their sessions,
     * which belong to the old one.
     */
    setProject(botId: BotId, projectId: string | null): Effect.Effect<void>;
    /** Puts the given bots in this order. Bots that the list leaves out keep their place. */
    reorder(botIds: ReadonlyArray<BotId>): Effect.Effect<void>;
    appendMessage(
      botId: BotId,
      role: MessageRole,
      text: string,
      attachments?: ReadonlyArray<Attachment>,
      steps?: ReadonlyArray<TraceStep>,
    ): Effect.Effect<Message>;
    messagesAfter(botId: BotId, afterSequence: number): Effect.Effect<ReadonlyArray<Message>>;
    skills(botId: BotId): Effect.Effect<ReadonlyArray<Skill>>;
    /** Keeps the skills that the bot's session reported, so the composer can offer them while no session runs. */
    setSkills(botId: BotId, skills: ReadonlyArray<Skill>): Effect.Effect<void>;
  }
>()("clots/bots/BotRepository") {
  static readonly layer = Layer.effect(
    BotRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const config = yield* ClotsConfig;

      const select = (where: Statement.Fragment) => sql<BotRow>`
        SELECT
          bots.id,
          bots.name,
          bots.instructions,
          bots.color,
          bots.shape,
          bots.model,
          bots.project_id AS projectId,
          bots.cloned_from AS clonedFrom,
          projects.name AS projectName,
          projects.directory AS projectDirectory,
          bots.created_at AS createdAt,
          bots.working_directory AS workingDirectory,
          bots.browser_stream_port AS browserStreamPort,
          threads.sdk_session_id AS sdkSessionId,
          threads.claude_pid AS claudePid,
          threads.synced_uuid AS syncedUuid,
          threads.unread,
          (
            SELECT text FROM messages
            -- A trace has no text, so the bot list skips it.
            WHERE thread_id = threads.id AND role NOT IN ('trace', 'compact')
            ORDER BY sequence DESC LIMIT 1
          ) AS lastMessageText,
          (SELECT MAX(created_at) FROM messages WHERE thread_id = threads.id) AS lastMessageAt
        FROM bots
        JOIN threads ON threads.bot_id = bots.id
        LEFT JOIN projects ON projects.id = bots.project_id
        ${where}
        ORDER BY bots.sort_order, bots.created_at
      `.pipe(Effect.map((rows) => rows.map(toStoredBot)));

      const list = select(sql``).pipe(Effect.orDie);

      const find = (botId: BotId) =>
        select(sql`WHERE bots.id = ${botId}`).pipe(
          Effect.map((rows) => rows[0]),
          Effect.orDie,
        );

      const create = ({
        name,
        instructions,
        color,
        shape,
        model = DEFAULT_MODEL,
        projectId = null,
        clonedFrom = null,
      }: NewBot & Partial<Pick<Bot, "model" | "projectId" | "clonedFrom">>) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID() as BotId;
          const workingDirectory = join(config.home, "bots", id);
          const createdAt = Date.now();
          mkdirSync(workingDirectory, { recursive: true });

          yield* sql`
            INSERT INTO bots (id, name, instructions, color, shape, model, project_id, cloned_from, working_directory, browser_stream_port, sort_order, created_at)
            SELECT
              ${id}, ${name}, ${instructions}, ${color}, ${shape}, ${model}, ${projectId}, ${clonedFrom}, ${workingDirectory},
              COALESCE(MAX(browser_stream_port) + 1, ${FIRST_BROWSER_STREAM_PORT}),
              COALESCE(MAX(sort_order), 0) + 1,
              ${createdAt}
            FROM bots
          `;
          yield* sql`
            INSERT INTO threads (id, bot_id, created_at)
            VALUES (${crypto.randomUUID()}, ${id}, ${createdAt})
          `;

          return (yield* find(id))!;
        }).pipe(sql.withTransaction, Effect.orDie);

      const remove = (bot: StoredBot) =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE bot_id = ${bot.id})`;
          yield* sql`DELETE FROM threads WHERE bot_id = ${bot.id}`;
          yield* sql`DELETE FROM schedules WHERE bot_id = ${bot.id}`;
          yield* sql`DELETE FROM bots WHERE id = ${bot.id}`;
        }).pipe(
          sql.withTransaction,
          // The rows go first, so a failed delete never leaves a bot without its notes.
          Effect.andThen(Effect.sync(() => rmSync(bot.workingDirectory, { recursive: true, force: true }))),
          Effect.orDie,
        );

      const setUnread = (botId: BotId, unread: boolean) =>
        sql`UPDATE threads SET unread = ${unread ? 1 : 0} WHERE bot_id = ${botId}`.pipe(Effect.asVoid, Effect.orDie);

      const setSdkSessionId = (botId: BotId, sdkSessionId: string) =>
        sql`UPDATE threads SET sdk_session_id = ${sdkSessionId} WHERE bot_id = ${botId}`.pipe(
          Effect.asVoid,
          Effect.orDie,
        );

      const setClaudePid = (botId: BotId, pid: number | null) =>
        sql`UPDATE threads SET claude_pid = ${pid} WHERE bot_id = ${botId}`.pipe(Effect.asVoid, Effect.orDie);

      const setSyncedUuid = (botId: BotId, uuid: string) =>
        sql`UPDATE threads SET synced_uuid = ${uuid} WHERE bot_id = ${botId}`.pipe(Effect.asVoid, Effect.orDie);

      const update = (botId: BotId, { name, instructions, color, shape }: BotChanges) =>
        sql`
          UPDATE bots
          SET
            name = COALESCE(${name ?? null}, name),
            instructions = COALESCE(${instructions ?? null}, instructions),
            color = COALESCE(${color ?? null}, color),
            shape = COALESCE(${shape ?? null}, shape)
          WHERE id = ${botId}
        `.pipe(Effect.asVoid, Effect.orDie);

      const setModel = (botId: BotId, model: BotModel) =>
        sql`UPDATE bots SET model = ${model} WHERE id = ${botId}`.pipe(Effect.asVoid, Effect.orDie);

      const setProject = (botId: BotId, projectId: string | null) =>
        Effect.gen(function* () {
          // Claude Code stores a session under its directory, so the old session cannot resume in a new one.
          // A move between projects with the same directory, or with none, keeps the session.
          yield* sql`
            UPDATE threads SET sdk_session_id = NULL
            WHERE bot_id IN (SELECT id FROM bots WHERE id = ${botId} OR cloned_from = ${botId})
              AND COALESCE((SELECT directory FROM projects WHERE id = ${projectId}), '') != COALESCE(
                (SELECT projects.directory FROM bots JOIN projects ON projects.id = bots.project_id WHERE bots.id = threads.bot_id),
                ''
              )
          `;
          // A bot that joins another group goes to its end. Its clones show under it, so they go with it.
          yield* sql`
            UPDATE bots
            SET
              sort_order = CASE WHEN project_id IS ${projectId} THEN sort_order ELSE (SELECT MAX(sort_order) + 1 FROM bots) END,
              project_id = ${projectId}
            WHERE id = ${botId} OR cloned_from = ${botId}
          `;
        }).pipe(sql.withTransaction, Effect.orDie);

      const reorder = (botIds: ReadonlyArray<BotId>) =>
        Effect.gen(function* () {
          // The bots swap their places among themselves, so their order against other bots stays.
          const rows = yield* sql<{ sortOrder: number }>`
            SELECT sort_order AS sortOrder FROM bots WHERE id IN ${sql.in(botIds)} ORDER BY sort_order
          `;
          const places = rows.map((row) => row.sortOrder);

          for (const [index, botId] of botIds.entries()) {
            yield* sql`UPDATE bots SET sort_order = ${places[index] ?? index} WHERE id = ${botId}`;
          }
        }).pipe(sql.withTransaction, Effect.orDie);

      const appendMessage = (
        botId: BotId,
        role: MessageRole,
        text: string,
        attachments: ReadonlyArray<Attachment> = [],
        steps: ReadonlyArray<TraceStep> = [],
      ) =>
        sql<MessageRow>`
          INSERT INTO messages (id, thread_id, sequence, role, text, attachments, steps, created_at)
          SELECT
            ${crypto.randomUUID()}, threads.id,
            COALESCE((SELECT MAX(sequence) FROM messages WHERE thread_id = threads.id), 0) + 1,
            ${role}, ${text}, ${JSON.stringify(attachments)}, ${JSON.stringify(steps)}, ${Date.now()}
          FROM threads
          WHERE threads.bot_id = ${botId}
          RETURNING id, ${botId} AS botId, sequence, role, text, attachments, steps, created_at AS createdAt
        `.pipe(
          Effect.map((rows) => toMessage(rows[0]!)),
          Effect.orDie,
        );

      const messagesAfter = (botId: BotId, afterSequence: number) =>
        sql<MessageRow>`
          SELECT
            messages.id, ${botId} AS botId, messages.sequence, messages.role, messages.text,
            messages.attachments, messages.steps, messages.created_at AS createdAt
          FROM messages
          JOIN threads ON threads.id = messages.thread_id
          WHERE threads.bot_id = ${botId} AND messages.sequence > ${afterSequence}
          ORDER BY messages.sequence
        `.pipe(
          Effect.map((rows) => rows.map(toMessage)),
          Effect.orDie,
        );

      const skills = (botId: BotId) =>
        sql<{ readonly skills: string }>`SELECT skills FROM threads WHERE bot_id = ${botId}`.pipe(
          Effect.map((rows): ReadonlyArray<Skill> => (rows[0] === undefined ? [] : JSON.parse(rows[0].skills))),
          Effect.orDie,
        );

      const setSkills = (botId: BotId, list: ReadonlyArray<Skill>) =>
        sql`UPDATE threads SET skills = ${JSON.stringify(list)} WHERE bot_id = ${botId}`.pipe(Effect.asVoid, Effect.orDie);

      return BotRepository.of({
        list,
        find,
        create,
        remove,
        setUnread,
        update,
        setSdkSessionId,
        setClaudePid,
        setSyncedUuid,
        setModel,
        setProject,
        reorder,
        appendMessage,
        messagesAfter,
        skills,
        setSkills,
      });
    }),
  );
}
