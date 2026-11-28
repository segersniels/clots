import {
  BotNotFound,
  CloneIsReadOnly,
  ClotsRpcs,
  InvalidSkill,
  ProjectDirectoryNotFound,
  UpdateFailed,
  type BotId,
  type BotSummary,
} from "@clots/contracts";
import { Effect, PubSub, Stream } from "effect";
import { cpSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { readAccount } from "../account/Account.ts";
import { deleteBotSkill, readBotSkills, saveBotSkill, writeBotSkills } from "../bots/BotPlugin.ts";
import { BotRepository, type StoredBot } from "../bots/BotRepository.ts";
import { BotSessions } from "../bots/BotSessions.ts";
import { ClotsConfig } from "../config.ts";
import { closeBrowser, navigateBrowser } from "../browser/BrowserEnvironment.ts";
import { ProjectRepository } from "../projects/ProjectRepository.ts";
import { ScheduleRepository } from "../schedules/ScheduleRepository.ts";
import { appendDiagnostics } from "../service/DiagnosticsLog.ts";
import { availableServerUpdate, installRelease, updateInfo } from "../service/Update.ts";
import { Sidecar } from "../sidecar/Sidecar.ts";

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
    const config = yield* ClotsConfig;
    const sidecar = yield* Sidecar;

    const requireBot = (botId: BotId) =>
      bots
        .find(botId)
        .pipe(
          Effect.flatMap((bot) =>
            bot === undefined ? Effect.fail(new BotNotFound({ botId })) : Effect.succeed(bot),
          ),
        );

    /** Refuses a change of a clone's settings or skills, which mirror the bot that it was cloned from. */
    const requireNoClone = (bot: StoredBot) =>
      bot.clonedFrom === null ? Effect.void : Effect.fail(new CloneIsReadOnly({ botId: bot.id }));

    const summarize = (bot: StoredBot): BotSummary => {
      const live = sessions.live(bot.id);
      const statusLine = {
        // The list shows plain text, so the markdown marks of a reply go away.
        idle: shorten(
          (bot.lastMessageText ?? "No messages yet")
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
        // Work in the background, such as a subagent, keeps the bot working after its turn ends.
        status: live.status === "idle" && live.tasks.length > 0 ? "working" : live.status,
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

      CreateBot: ({ projectId, skills = [], ...newBot }) =>
        bots.create({ ...newBot, projectId: projectId ?? null }).pipe(
          Effect.tap((bot) => Effect.sync(() => writeBotSkills(bot, skills))),
          Effect.tap(() => PubSub.publish(sessions.statusChanges, undefined)),
        ),

      WatchProjects: () => watch(projects.list, Stream.fromPubSub(projects.changes)),

      CreateProject: ({ name, directory }) =>
        Effect.gen(function* () {
          if (directory === null || directory.trim() === "") {
            return yield* projects.create(name, null);
          }

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
          yield* Effect.forEach([botId, ...clones.map((clone) => clone.id)], (id) =>
            sessions.stop(id),
          );
          yield* PubSub.publish(sessions.statusChanges, undefined);
        }),

      UpdateBot: ({ botId, ...changes }) =>
        requireBot(botId).pipe(
          // A clone keeps the settings of its bot, but the operator can rename it.
          Effect.tap((bot) =>
            changes.instructions === undefined &&
            changes.color === undefined &&
            changes.shape === undefined
              ? Effect.void
              : requireNoClone(bot),
          ),
          Effect.tap(() => bots.update(botId, changes)),
          Effect.flatMap((bot) => sessions.noteSettingsChange(bot, changes)),
          Effect.andThen(PubSub.publish(sessions.statusChanges, undefined)),
          Effect.asVoid,
        ),

      StopBrowser: ({ botId }) => requireBot(botId).pipe(Effect.flatMap(closeBrowser)),

      NavigateBrowser: ({ botId, action, target }) =>
        requireBot(botId).pipe(Effect.flatMap((bot) => navigateBrowser(bot, action, target))),

      ReorderBots: ({ botIds }) =>
        bots
          .reorder(botIds)
          .pipe(Effect.andThen(PubSub.publish(sessions.statusChanges, undefined)), Effect.asVoid),

      SetBotUnread: ({ botId, unread }) =>
        requireBot(botId).pipe(
          Effect.andThen(bots.setUnread(botId, unread)),
          Effect.andThen(PubSub.publish(sessions.statusChanges, undefined)),
          Effect.asVoid,
        ),

      DuplicateBot: ({ botId }) =>
        Effect.gen(function* () {
          const source = yield* requireBot(botId);
          const { name, instructions, color, shape, model, projectId } = source;
          const copy = yield* bots.create({
            name: `${name} copy`,
            instructions,
            color,
            shape,
            model,
            projectId,
          });

          // The copy starts with the memory and the skills of the bot, and after that it keeps its own.
          const sourceDirectory = source.parentDirectory ?? source.workingDirectory;
          for (const folder of ["memory", "plugin"]) {
            if (existsSync(join(sourceDirectory, folder))) {
              cpSync(join(sourceDirectory, folder), join(copy.workingDirectory, folder), {
                recursive: true,
              });
            }
          }

          yield* PubSub.publish(sessions.statusChanges, undefined);

          return copy;
        }),

      DeleteBot: ({ botId }) =>
        requireBot(botId).pipe(Effect.flatMap((bot) => sessions.deleteBot(bot))),

      SetBotModel: ({ botId, model }) =>
        Effect.gen(function* () {
          yield* requireBot(botId).pipe(Effect.tap(requireNoClone));
          yield* bots.setModel(botId, model);

          // The clones mirror the bot's model, so their running sessions switch with it.
          const clones = (yield* bots.list).filter((bot) => bot.clonedFrom === botId);
          yield* Effect.forEach([botId, ...clones.map((clone) => clone.id)], (id) =>
            sessions.setModel(id, model),
          );
          yield* PubSub.publish(sessions.statusChanges, undefined);
        }),

      SubscribeThread: ({ botId, afterSequence }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* requireBot(botId);

            // Subscribe before the replay, so that no event falls between the replay and the live part.
            const subscription = yield* PubSub.subscribe(sessions.events(botId));
            const stored = yield* bots.messagesAfter(botId, afterSequence);
            const replayedThrough = stored.at(-1)?.sequence ?? afterSequence;

            return Stream.fromIterable(
              stored.map((message) => ({ _tag: "Message" as const, message })),
            ).pipe(
              Stream.concat(Stream.make({ _tag: "Live" as const, state: sessions.live(botId) })),
              Stream.concat(
                Stream.fromSubscription(subscription).pipe(
                  Stream.filter(
                    (event) => event._tag !== "Message" || event.message.sequence > replayedThrough,
                  ),
                ),
              ),
            );
          }),
        ),

      // The stream sends nothing. It lives as long as the conversation is on screen, so the operator views the bot until it ends.
      ViewBot: ({ botId }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            yield* requireBot(botId);
            yield* sessions.view(botId);

            return Stream.never;
          }),
        ),

      SendMessage: ({ botId, messageId, text, attachments }) =>
        requireBot(botId).pipe(
          Effect.flatMap((bot) => sessions.send(bot, "user", text, attachments, messageId)),
        ),

      InterruptBot: ({ botId }) =>
        requireBot(botId).pipe(Effect.andThen(sessions.interrupt(botId))),

      StopTask: ({ botId, taskId }) =>
        requireBot(botId).pipe(Effect.andThen(sessions.stopTask(botId, taskId))),

      ResolveApproval: ({ botId, approvalId, decision }) =>
        requireBot(botId).pipe(
          Effect.andThen(sessions.resolveApproval(botId, approvalId, decision)),
        ),

      ResolveHandoff: ({ botId, handoffId }) =>
        requireBot(botId).pipe(Effect.andThen(sessions.resolveHandoff(botId, handoffId))),

      ResolveLoginRequest: ({ botId, requestId, decision }) =>
        requireBot(botId).pipe(
          Effect.andThen(sessions.resolveLoginRequest(botId, requestId, decision)),
        ),

      FindLogins: ({ botId, url }) =>
        requireBot(botId).pipe(Effect.flatMap((bot) => sessions.findLogins(bot, url))),

      CopyLogin: ({ botId, fromBotId, url }) =>
        Effect.all([requireBot(botId), requireBot(fromBotId)]).pipe(
          Effect.flatMap(([bot, source]) => sessions.copyLogin(bot, source, url)),
        ),

      WatchSkills: ({ botId }) =>
        watch(bots.skills(botId), Stream.fromPubSub(sessions.skillChanges)).pipe(
          // A bot that never ran has no list yet. A short session lists its skills in the background.
          Stream.tap((list) =>
            list.length > 0
              ? Effect.void
              : bots.find(botId).pipe(
                  Effect.flatMap((bot) =>
                    bot === undefined ? Effect.void : sessions.loadSkills(bot),
                  ),
                  Effect.forkDetach,
                  Effect.asVoid,
                ),
          ),
        ),

      WatchBotSkills: ({ botId }) =>
        Stream.unwrap(
          requireBot(botId).pipe(
            Effect.map((bot) =>
              watch(
                Effect.sync(() => readBotSkills(bot)),
                Stream.fromPubSub(sessions.ownSkillChanges).pipe(
                  Stream.filter((changed) => changed === botId),
                  Stream.as(undefined),
                ),
              ),
            ),
          ),
        ),

      SaveBotSkill: ({ botId, skill, previousName }) =>
        Effect.gen(function* () {
          const bot = yield* requireBot(botId).pipe(Effect.tap(requireNoClone));
          const reason = saveBotSkill(bot, skill, previousName);

          if (reason !== undefined) {
            return yield* new InvalidSkill({ name: skill.name, reason });
          }

          yield* sessions.checkOwnSkills(bot);
        }),

      DeleteBotSkill: ({ botId, name }) =>
        Effect.gen(function* () {
          const bot = yield* requireBot(botId).pipe(Effect.tap(requireNoClone));
          const reason = deleteBotSkill(bot, name);

          if (reason !== undefined) {
            return yield* new InvalidSkill({ name, reason });
          }

          yield* sessions.checkOwnSkills(bot);
        }),

      WatchSchedules: ({ botId }) =>
        watch(schedules.list(botId), Stream.fromPubSub(schedules.changes)),

      CreateSchedule: ({ botId, cron, prompt, place }) =>
        requireBot(botId).pipe(
          Effect.flatMap((bot) => sessions.createRoutine(bot, { cron, prompt, place })),
        ),

      UpdateSchedule: ({ id, cron, prompt, place }) =>
        Effect.gen(function* () {
          const routine = yield* schedules.find(id);
          const owner = routine === undefined ? undefined : yield* bots.find(routine.botId);
          if (routine === undefined || owner === undefined) {
            return;
          }

          yield* sessions.updateRoutine(owner, routine, { cron, prompt, place });
        }),

      SetSchedulePaused: ({ id, paused }) => schedules.setPaused(id, paused),

      DeleteSchedule: ({ id }) =>
        schedules
          .find(id)
          .pipe(
            Effect.flatMap((routine) =>
              routine === undefined ? Effect.void : sessions.deleteRoutine(routine),
            ),
          ),

      GetUpdateInfo: () => Effect.promise(() => updateInfo()),

      GetAccount: () => Effect.promise(() => readAccount(config.claudePath, config.home)),

      ReportDiagnostics: ({ report }) =>
        Effect.sync(() =>
          appendDiagnostics(config.home, { at: new Date().toISOString(), ...report }),
        ),

      // The sidecar reports its state in a file, so the server reads it again each second.
      WatchRemoteAccess: () =>
        Stream.tick("1 second").pipe(
          Stream.mapEffect(() => sidecar.status),
          Stream.changes,
        ),

      SetRemoteAccess: ({ enabled }) => sidecar.setEnabled(enabled),

      SearchMessages: ({ query, limit }) => bots.searchMessages(query, limit),

      UpdateServer: () =>
        Effect.tryPromise({
          try: async () => {
            await installRelease(await availableServerUpdate());

            // The service starts the new binary when this process ends. The pause lets the answer reach the client first.
            setTimeout(() => process.exit(0), 500);
          },
          catch: (error) =>
            new UpdateFailed({ message: error instanceof Error ? error.message : String(error) }),
        }),
    };
  }),
);
