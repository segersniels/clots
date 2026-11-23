import { BotNotFound, ClotsRpcs, InvalidCron, type BotId, type BotSummary } from "@clots/contracts";
import { Effect, PubSub, Stream } from "effect";

import { BotRepository, type StoredBot } from "../bots/BotRepository.ts";
import { BotSessions } from "../bots/BotSessions.ts";
import { nextRunAt, ScheduleRepository } from "../schedules/ScheduleRepository.ts";

const STATUS_LINE_LENGTH = 80;

export const HandlersLayer = ClotsRpcs.toLayer(
  Effect.gen(function* () {
    const bots = yield* BotRepository;
    const sessions = yield* BotSessions;
    const schedules = yield* ScheduleRepository;

    const requireBot = (botId: BotId) =>
      bots
        .find(botId)
        .pipe(Effect.flatMap((bot) => (bot === undefined ? Effect.fail(new BotNotFound({ botId })) : Effect.succeed(bot))));

    const summarize = (bot: StoredBot): BotSummary => {
      const live = sessions.live(bot.id);
      const idleLine = bot.lastMessageText ?? "No messages yet";
      const statusLine = {
        idle: idleLine.replaceAll(/\s+/g, " ").slice(0, STATUS_LINE_LENGTH),
        working: live.activity ?? "Working…",
        waiting: "Needs you",
      }[live.status];

      return {
        id: bot.id,
        name: bot.name,
        instructions: bot.instructions,
        color: bot.color,
        shape: bot.shape,
        model: bot.model,
        lastMessageAt: bot.lastMessageAt,
        createdAt: bot.createdAt,
        status: live.status,
        statusLine,
      };
    };

    /** Emits the current value, then a new value after each change signal. */
    const watch = <A>(read: Effect.Effect<A>, changes: Stream.Stream<void>) =>
      Stream.concat(Stream.make(undefined), changes).pipe(Stream.mapEffect(() => read));

    return {
      WatchBots: () =>
        watch(
          bots.list.pipe(Effect.map((list) => list.map(summarize))),
          Stream.fromPubSub(sessions.statusChanges),
        ),

      CreateBot: (newBot) =>
        bots.create(newBot).pipe(Effect.tap(() => PubSub.publish(sessions.statusChanges, undefined))),

      SetBotModel: ({ botId, model }) =>
        requireBot(botId).pipe(
          Effect.andThen(bots.setModel(botId, model)),
          Effect.andThen(sessions.setModel(botId, model)),
          Effect.andThen(PubSub.publish(sessions.statusChanges, undefined)),
          Effect.asVoid,
        ),

      SubscribeThread: ({ botId, afterSequence }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* requireBot(botId);

            // Subscribe before the replay, so that no event falls between the replay and the live part.
            const subscription = yield* PubSub.subscribe(sessions.events(botId));
            const stored = yield* bots.messagesAfter(botId, afterSequence);
            const replayedThrough = stored.at(-1)?.sequence ?? afterSequence;

            return Stream.fromIterable(stored.map((message) => ({ _tag: "Message" as const, message }))).pipe(
              Stream.concat(Stream.make({ _tag: "Live" as const, state: sessions.live(botId) })),
              Stream.concat(
                Stream.fromSubscription(subscription).pipe(
                  Stream.filter((event) => event._tag !== "Message" || event.message.sequence > replayedThrough),
                ),
              ),
            );
          }),
        ),

      SendMessage: ({ botId, text }) =>
        requireBot(botId).pipe(Effect.flatMap((bot) => sessions.send(bot, "user", text))),

      InterruptBot: ({ botId }) => requireBot(botId).pipe(Effect.andThen(sessions.interrupt(botId))),

      ResolveApproval: ({ botId, approvalId, decision }) =>
        requireBot(botId).pipe(Effect.andThen(sessions.resolveApproval(botId, approvalId, decision))),

      ResolveHandoff: ({ botId, handoffId }) =>
        requireBot(botId).pipe(Effect.andThen(sessions.resolveHandoff(botId, handoffId))),

      WatchSchedules: ({ botId }) => watch(schedules.list(botId), Stream.fromPubSub(schedules.changes)),

      CreateSchedule: ({ botId, cron, prompt }) =>
        Effect.gen(function* () {
          yield* requireBot(botId);
          const next = nextRunAt(cron, Date.now());
          if (next === undefined) return yield* new InvalidCron({ cron });

          return yield* schedules.create(botId, cron, prompt, next);
        }),

      SetSchedulePaused: ({ id, paused }) => schedules.setPaused(id, paused),

      DeleteSchedule: ({ id }) => schedules.remove(id),
    };
  }),
);
