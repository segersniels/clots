import type { Bot, BotId, BotModel, Message, MessageRole } from "@clots/contracts";

/** The fields that the operator chooses for a new bot. */
export type NewBot = Pick<Bot, "name" | "instructions" | "color" | "shape">;
import { Context, Effect, Layer } from "effect";
import { SqlClient, type Statement } from "effect/sql";
import { mkdirSync } from "node:fs";
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
  readonly lastMessageText: string | null;
  readonly lastMessageAt: number | null;
}

export class BotRepository extends Context.Service<
  BotRepository,
  {
    readonly list: Effect.Effect<ReadonlyArray<StoredBot>>;
    find(botId: BotId): Effect.Effect<StoredBot | undefined>;
    create(bot: NewBot): Effect.Effect<StoredBot>;
    setSdkSessionId(botId: BotId, sdkSessionId: string): Effect.Effect<void>;
    setModel(botId: BotId, model: BotModel): Effect.Effect<void>;
    appendMessage(botId: BotId, role: MessageRole, text: string): Effect.Effect<Message>;
    messagesAfter(botId: BotId, afterSequence: number): Effect.Effect<ReadonlyArray<Message>>;
  }
>()("clots/bots/BotRepository") {
  static readonly layer = Layer.effect(
    BotRepository,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const config = yield* ClotsConfig;

      const select = (where: Statement.Fragment) => sql<StoredBot>`
        SELECT
          bots.id,
          bots.name,
          bots.instructions,
          bots.color,
          bots.shape,
          bots.model,
          bots.created_at AS createdAt,
          bots.working_directory AS workingDirectory,
          bots.browser_stream_port AS browserStreamPort,
          threads.sdk_session_id AS sdkSessionId,
          (
            SELECT text FROM messages
            WHERE thread_id = threads.id
            ORDER BY sequence DESC LIMIT 1
          ) AS lastMessageText,
          (SELECT MAX(created_at) FROM messages WHERE thread_id = threads.id) AS lastMessageAt
        FROM bots
        JOIN threads ON threads.bot_id = bots.id
        ${where}
        ORDER BY bots.created_at
      `;

      const list = select(sql``).pipe(Effect.orDie);

      const find = (botId: BotId) =>
        select(sql`WHERE bots.id = ${botId}`).pipe(
          Effect.map((rows) => rows[0]),
          Effect.orDie,
        );

      const create = ({ name, instructions, color, shape }: NewBot) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID() as BotId;
          const workingDirectory = join(config.home, "bots", id);
          const createdAt = Date.now();
          mkdirSync(workingDirectory, { recursive: true });

          yield* sql`
            INSERT INTO bots (id, name, instructions, color, shape, model, working_directory, browser_stream_port, created_at)
            SELECT
              ${id}, ${name}, ${instructions}, ${color}, ${shape}, ${DEFAULT_MODEL}, ${workingDirectory},
              COALESCE(MAX(browser_stream_port) + 1, ${FIRST_BROWSER_STREAM_PORT}),
              ${createdAt}
            FROM bots
          `;
          yield* sql`
            INSERT INTO threads (id, bot_id, created_at)
            VALUES (${crypto.randomUUID()}, ${id}, ${createdAt})
          `;

          return (yield* find(id))!;
        }).pipe(sql.withTransaction, Effect.orDie);

      const setSdkSessionId = (botId: BotId, sdkSessionId: string) =>
        sql`UPDATE threads SET sdk_session_id = ${sdkSessionId} WHERE bot_id = ${botId}`.pipe(
          Effect.asVoid,
          Effect.orDie,
        );

      const setModel = (botId: BotId, model: BotModel) =>
        sql`UPDATE bots SET model = ${model} WHERE id = ${botId}`.pipe(Effect.asVoid, Effect.orDie);

      const appendMessage = (botId: BotId, role: MessageRole, text: string) =>
        sql<Message>`
          INSERT INTO messages (id, thread_id, sequence, role, text, created_at)
          SELECT
            ${crypto.randomUUID()}, threads.id,
            COALESCE((SELECT MAX(sequence) FROM messages WHERE thread_id = threads.id), 0) + 1,
            ${role}, ${text}, ${Date.now()}
          FROM threads
          WHERE threads.bot_id = ${botId}
          RETURNING id, ${botId} AS botId, sequence, role, text, created_at AS createdAt
        `.pipe(
          Effect.map((rows) => rows[0]!),
          Effect.orDie,
        );

      const messagesAfter = (botId: BotId, afterSequence: number) =>
        sql<Message>`
          SELECT
            messages.id, ${botId} AS botId, messages.sequence, messages.role, messages.text,
            messages.created_at AS createdAt
          FROM messages
          JOIN threads ON threads.id = messages.thread_id
          WHERE threads.bot_id = ${botId} AND messages.sequence > ${afterSequence}
          ORDER BY messages.sequence
        `.pipe(Effect.orDie);

      return BotRepository.of({ list, find, create, setSdkSessionId, setModel, appendMessage, messagesAfter });
    }),
  );
}
