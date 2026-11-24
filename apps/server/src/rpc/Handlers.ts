import {
  BotNotFound,
  ClotsRpcs,
  InvalidCron,
  ProjectDirectoryNotFound,
  type BotId,
  type BotSummary,
} from "@clots/contracts";
import { Effect, PubSub, Stream } from "effect";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { BotRepository, type StoredBot } from "../bots/BotRepository.ts";
import { BotSessions } from "../bots/BotSessions.ts";
import { closeBrowser } from "../browser/BrowserEnvironment.ts";
import { ProjectRepository } from "../projects/ProjectRepository.ts";
import { nextRunAt, ScheduleRepository } from "../schedules/ScheduleRepository.ts";

/** The longest status line. The sidebar and the bot picker truncate it to their width, so this only caps what goes over the wire. */
const STATUS_LINE_LENGTH = 300;

/** Cuts a status line to its length. A cut line ends in an ellipsis, so it never stops mid-word without a sign. */
const shorten = (line: string) =>
  line.length <= STATUS_LINE_LENGTH ? line : `${line.slice(0, STATUS_LINE_LENGTH - 1).trimEnd()}…`;

export const HandlersLayer = ClotsRpcs.toLayer(
  Effect.gen(function* () {
    const bots = yield* BotRepository;
    const sessions = yield* BotSessions;
    const schedules = yield* ScheduleRepository;
    const projects = yield* ProjectRepository;

    const requireBot = (botId: BotId) =>
      bots
        .find(botId)
        .pipe(Effect.flatMap((bot) => (bot === undefined ? Effect.fail(new BotNotFound({ botId })) : Effect.succeed(bot))));

    const summarize = (bot: StoredBot): BotSummary => {
      const live = sessions.live(bot.id);
      const idleLine = bot.lastMessageText ?? "No messages yet";
      const backgroundLine =
        live.tasks.length === 1 ? `In the background: ${live.tasks[0]!.description}` : `${live.tasks.length} tasks in the background`;
      const statusLine = {
        // The list shows plain text, so the markdown marks of a reply go away. Work in the background comes first.
        idle: shorten(
          (live.tasks.length > 0 ? backgroundLine : idleLine)
            .replaceAll(/[#*_`>]+/g, "")
            .replaceAll(/\s+/g, " ")
            .trim(),
        ),
        working: live.steps.at(-1)?.title ?? "Working…",
        waiting: "Needs you",
      }[live.status];

      return {
        id: bot.id,
        name: bot.name,
        instructions: bot.instructions,
        color: bot.color,
        shape: bot.shape,
        model: bot.model,
        projectId: bot.projectId,
        clonedFrom: bot.clonedFrom,
        lastMessageAt: bot.lastMessageAt,
        unread: bot.unread,
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

      WatchProjects: () => watch(projects.list, Stream.fromPubSub(projects.changes)),

      CreateProject: ({ name, directory }) =>
        Effect.gen(function* () {
          if (directory === null || directory.trim() === "") return yield* projects.create(name, null);

          // The operator types the path, often with `~` for the home directory.
          const absolute = resolve(directory.trim().replace(/^~(?=$|\/)/, homedir()));

          if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
            return yield* new ProjectDirectoryNotFound({ directory: absolute });
          }

          return yield* projects.create(name, absolute);
        }),

      RenameProject: ({ projectId, name }) => projects.rename(projectId, name),

      DeleteProject: ({ projectId }) =>
        Effect.gen(function* () {
          const moved = (yield* bots.list).filter((bot) => bot.projectId === projectId);
          yield* projects.remove(projectId);

          // A running session belongs to the old directory.
          yield* Effect.forEach(moved, (bot) => sessions.stop(bot.id));
          yield* PubSub.publish(sessions.statusChanges, undefined);
        }),

      SetBotProject: ({ botId, projectId }) =>
        Effect.gen(function* () {
          yield* requireBot(botId);
          const clones = (yield* bots.list).filter((bot) => bot.clonedFrom === botId);
          yield* bots.setProject(botId, projectId);

          // The running sessions belong to the old directory.
          yield* Effect.forEach([botId, ...clones.map((clone) => clone.id)], (id) => sessions.stop(id));
          yield* PubSub.publish(sessions.statusChanges, undefined);
        }),

      UpdateBot: ({ botId, ...changes }) =>
        requireBot(botId).pipe(
          Effect.andThen(bots.update(botId, changes)),
          Effect.andThen(PubSub.publish(sessions.statusChanges, undefined)),
          Effect.asVoid,
        ),

      StopBrowser: ({ botId }) => requireBot(botId).pipe(Effect.flatMap(closeBrowser)),

      ReorderBots: ({ botIds }) =>
        bots.reorder(botIds).pipe(Effect.andThen(PubSub.publish(sessions.statusChanges, undefined)), Effect.asVoid),

      SetBotUnread: ({ botId, unread }) =>
        requireBot(botId).pipe(
          Effect.andThen(bots.setUnread(botId, unread)),
          Effect.andThen(PubSub.publish(sessions.statusChanges, undefined)),
          Effect.asVoid,
        ),

      DuplicateBot: ({ botId }) =>
        requireBot(botId).pipe(
          Effect.flatMap(({ name, instructions, color, shape, model, projectId }) =>
            bots.create({ name: `${name} copy`, instructions, color, shape, model, projectId }),
          ),
          Effect.tap(() => PubSub.publish(sessions.statusChanges, undefined)),
        ),

      DeleteBot: ({ botId }) => requireBot(botId).pipe(Effect.flatMap((bot) => sessions.deleteBot(bot))),

      CompactBot: ({ botId }) => requireBot(botId).pipe(Effect.flatMap((bot) => sessions.compact(bot))),

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

      SendMessage: ({ botId, text, attachments }) =>
        requireBot(botId).pipe(Effect.flatMap((bot) => sessions.send(bot, "user", text, attachments))),

      InterruptBot: ({ botId }) => requireBot(botId).pipe(Effect.andThen(sessions.interrupt(botId))),

      ResolveApproval: ({ botId, approvalId, decision }) =>
        requireBot(botId).pipe(Effect.andThen(sessions.resolveApproval(botId, approvalId, decision))),

      ResolveHandoff: ({ botId, handoffId }) =>
        requireBot(botId).pipe(Effect.andThen(sessions.resolveHandoff(botId, handoffId))),

      WatchSkills: ({ botId }) =>
        watch(bots.skills(botId), Stream.fromPubSub(sessions.skillChanges)).pipe(
          // A bot that never ran has no list yet. A short session lists its skills in the background.
          Stream.tap((list) =>
            list.length > 0
              ? Effect.void
              : bots.find(botId).pipe(
                  Effect.flatMap((bot) => (bot === undefined ? Effect.void : sessions.loadSkills(bot))),
                  Effect.forkDetach,
                  Effect.asVoid,
                ),
          ),
        ),

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
