import {
  createSdkMcpServer,
  getSessionMessages,
  query,
  tool,
  type CanUseTool,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
  type SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ApprovalDecision,
  Attachment,
  BotId,
  BotModel,
  BotStatus,
  MessageRole,
  ThreadEvent,
  ThreadLiveState,
  TraceStep,
  Upload,
} from "@clots/contracts";
import { Cause, Context, Deferred, Effect, Layer, PubSub, Queue, Scope, Stream } from "effect";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";

import { ClotsConfig } from "../config.ts";
import { HOST_TIME_ZONE, nextRunAt, ScheduleRepository } from "../schedules/ScheduleRepository.ts";
import { BotRepository, type BotChanges, type StoredBot } from "./BotRepository.ts";
import { closeBrowser, makeBrowserEnvironment } from "../browser/BrowserEnvironment.ts";
import { makeClaudeEnvironment, removeClaudeTranscripts, transcriptPath } from "./ClaudeEnvironment.ts";

const HANDOFF_TOOL = "request_handoff";

/** The most characters of one message that `read_bot_thread` returns, so a long reply does not flood the reader. */
const MAX_READ_MESSAGE_LENGTH = 1500;

/** Checks whether a message mentions a bot: `@Name` at the start of a word, not followed by more of a word. */
const mentions = (text: string, name: string) => {
  for (let index = text.indexOf(`@${name}`); index !== -1; index = text.indexOf(`@${name}`, index + 1)) {
    const startsWord = index === 0 || /\s/.test(text[index - 1]!);
    const endsWord = !/\w/.test(text[index + name.length + 1] ?? "");

    if (startsWord && endsWord) return true;
  }

  return false;
};

/** The most clones that one orchestrating bot can have at a time. */
const MAX_CLONES = 10;

/** The wait before a clone that deletes itself goes, so that its tool call can end first. */
const SELF_DELETE_DELAY_MS = 1000;

/** How often the server reads the transcript of a session that a server restart cut off, while it still runs. */
const FOLLOW_INTERVAL = "3 seconds";

/**
 * Checks whether a `claude` process still runs. A finished one can stay behind as a zombie, and
 * after a reboot its id can belong to another program.
 */
const claudeIsRunning = (pid: number) => {
  const status = Bun.spawnSync(["ps", "-o", "stat=,args=", "-p", String(pid)]).stdout.toString().trim();

  return status !== "" && !status.startsWith("Z") && status.includes("stream-json");
};

/** The start of the id of the step that shows a compaction while it runs. */
const COMPACT_STEP = "compact-";

/** Writes a token count the short way, for example 4.5k or 180k. */
const shortTokens = (tokens: number) => (tokens < 10_000 ? `${(tokens / 1000).toFixed(1)}k` : `${Math.round(tokens / 1000)}k`);

/** Describes a finished compaction for the thread, for example "Conversation compacted · 180k → 32k tokens". */
const compactNote = (trigger: "manual" | "auto", before: number, after: number | undefined) => {
  const what = trigger === "auto" ? "Conversation compacted automatically" : "Conversation compacted";
  if (after === undefined) return `${what} · ${shortTokens(before)} tokens before`;

  return `${what} · ${shortTokens(before)} → ${shortTokens(after)} tokens`;
};

/** Gives a clone a name that no other bot has, so that `@Name` finds exactly one bot. */
const uniqueName = (wanted: string, bots: ReadonlyArray<StoredBot>) => {
  const taken = new Set(bots.map((bot) => bot.name.toLowerCase()));

  for (let number = 1; ; number += 1) {
    const candidate = number === 1 ? wanted : `${wanted} ${number}`;

    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
};

/** Builds the text that a tool returns. */
const toolText = (text: string) => ({ content: [{ type: "text" as const, text }] });

/** The image types that Claude takes as an image block. Other files reach the bot as a path only. */
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const IDLE: ThreadLiveState = {
  status: "idle",
  steps: [],
  approvals: [],
  handoff: null,
  tasks: [],
};

/** The in-memory state of one bot. The session exists only while a `claude` process runs. */
interface BotRuntime {
  live: ThreadLiveState;
  readonly events: PubSub.PubSub<ThreadEvent>;
  session: {
    readonly prompts: Queue.Queue<SDKUserMessage, Cause.Done>;
    readonly query: Query;
    /** The system prompt that the session started with. A bot whose settings changed since then needs a new session. */
    readonly systemPrompt: string;
    /** Completes when the session has stopped and wrote its last message. */
    readonly ended: Deferred.Deferred<void>;
  } | null;
  readonly approvals: Map<string, (decision: ApprovalDecision) => void>;
  finishHandoff: (() => void) | null;
  /** Who sent the latest prompt: the operator, a routine or another bot. A clone may delete itself only after the operator's. */
  lastPromptFrom: MessageRole | null;
  /** A session from before a server restart that still runs, and the prompts that wait until it ends. */
  leftover: { readonly pid: number; readonly prompts: Array<SDKUserMessage> } | null;
  /** The prompts that wait while a session with an old system prompt finishes its work. */
  restart: { readonly prompts: Array<SDKUserMessage> } | null;
  /** The open conversation views of the bot, on any device. A turn that ends while nobody views it marks the bot unread. */
  viewers: number;
}

/** Tells a bot in its first prompt after a restart that its system prompt changed. */
const SETTINGS_CHANGED_NOTE = "(The operator changed your clots settings. Your system prompt has the current version.)";

/** Adds the settings note to a prompt. A slash command such as `/compact` stays as it is. */
const withSettingsNote = (prompt: SDKUserMessage): SDKUserMessage => {
  const content = prompt.message.content;

  if (typeof content === "string") return prompt;

  return { ...prompt, message: { role: "user", content: [...content, { type: "text", text: SETTINGS_CHANGED_NOTE }] } };
};

const systemPromptFor = (bot: StoredBot) =>
  [
    `You are ${bot.name}, an always-on bot that the operator talks to through clots.`,
    `You have one ongoing thread. Your notes directory is your durable memory: keep notes in ${bot.workingDirectory}/CLAUDE.md and other files there.`,
    bot.projectDirectory === null
      ? "Your notes directory is also your current directory."
      : `You work on the project "${bot.projectName}". Its directory, ${bot.projectDirectory}, is your current directory.`,
    // Without this, a bot inspects its directories before it answers a plain greeting.
    "Answer a message directly. Read files or run commands only when the task needs them.",
    "You have a browser: use the `agent-browser` CLI through Bash. Run `agent-browser skills get core` before the first use.",
    "Your browser session and profile are already set in the environment. Do not pass `--session` or `--profile`, or the operator cannot see your browser.",
    `When a page needs the operator (a login, a captcha, a payment), call the ${HANDOFF_TOOL} tool and wait.`,
    bot.instructions.trim() === "" ? "" : `# Instructions\n\n${bot.instructions}`,
  ].join("\n\n");

const textOf = (blocks: ReadonlyArray<{ type: string; text?: string }>) =>
  blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();

export class BotSessions extends Context.Service<
  BotSessions,
  {
    /** Stores a prompt and gives it to the bot. Starts or resumes the bot's session when none runs. */
    send(
      bot: StoredBot,
      role: Exclude<MessageRole, "assistant">,
      text: string,
      uploads?: ReadonlyArray<Upload>,
    ): Effect.Effect<void>;
    interrupt(botId: BotId): Effect.Effect<void>;
    /** Stops the session of a bot. The next message starts a new one with the bot's current settings. */
    stop(botId: BotId): Effect.Effect<void>;
    /**
     * Lists the skills of a bot that has none stored yet, such as a new bot. A short `claude`
     * process with the bot's settings answers without a prompt, so it costs no tokens.
     */
    loadSkills(bot: StoredBot): Effect.Effect<void>;
    /** Stops the session of a deleted bot and forgets its live state. */
    remove(botId: BotId): Effect.Effect<void>;
    /**
     * Deletes a bot and everything it owns: its session, its browser, its rows and notes, and its
     * Claude transcripts. The session and the browser stop first, so neither writes to the files while they go.
     */
    deleteBot(bot: StoredBot): Effect.Effect<void>;
    /** Asks the bot's session to compact its conversation, as `/compact` does in Claude Code. */
    compact(bot: StoredBot): Effect.Effect<void>;
    /** Marks in the thread that the operator renamed the bot or changed its instructions. Other changes add nothing. */
    noteSettingsChange(bot: StoredBot, changes: BotChanges): Effect.Effect<void>;
    /** Switches the model of a running session. A bot without a session reads its model at the next start. */
    setModel(botId: BotId, model: BotModel): Effect.Effect<void>;
    resolveApproval(botId: BotId, approvalId: string, decision: ApprovalDecision): Effect.Effect<void>;
    resolveHandoff(botId: BotId, handoffId: string): Effect.Effect<void>;
    live(botId: BotId): ThreadLiveState;
    events(botId: BotId): PubSub.PubSub<ThreadEvent>;
    /** Counts the operator as a viewer of the bot's conversation until the scope closes. */
    view(botId: BotId): Effect.Effect<void, never, Scope.Scope>;
    /** Fires when the status of a bot changes. */
    readonly statusChanges: PubSub.PubSub<void>;
    /** Fires when the skills of a bot change. */
    readonly skillChanges: PubSub.PubSub<void>;
  }
>()("clots/bots/BotSessions") {
  static readonly layer = Layer.effect(
    BotSessions,
    Effect.gen(function* () {
      const config = yield* ClotsConfig;
      const repository = yield* BotRepository;
      const schedules = yield* ScheduleRepository;
      const scope = yield* Effect.scope;
      const statusChanges = yield* PubSub.unbounded<void>();
      const skillChanges = yield* PubSub.unbounded<void>();
      const runtimes = new Map<BotId, BotRuntime>();

      const claudeOptions = {
        env: makeClaudeEnvironment(process.env),
        pathToClaudeCodeExecutable: config.claudePath,
      };

      const runtimeFor = (botId: BotId): BotRuntime => {
        const existing = runtimes.get(botId);
        if (existing !== undefined) return existing;

        const runtime: BotRuntime = {
          live: IDLE,
          events: Effect.runSync(PubSub.unbounded<ThreadEvent>()),
          session: null,
          approvals: new Map(),
          finishHandoff: null,
          lastPromptFrom: null,
          leftover: null,
          restart: null,
          viewers: 0,
        };
        runtimes.set(botId, runtime);

        return runtime;
      };

      const publish = (runtime: BotRuntime, event: ThreadEvent) => {
        PubSub.publishUnsafe(runtime.events, event);
      };

      const setLive = (runtime: BotRuntime, patch: Partial<ThreadLiveState>) => {
        const previousStatus = runtime.live.status;
        runtime.live = { ...runtime.live, ...patch };
        publish(runtime, { _tag: "Live", state: runtime.live });

        if (runtime.live.status !== previousStatus) PubSub.publishUnsafe(statusChanges, undefined);
      };

      /** Derives the status after an approval or a handoff changes. */
      const statusWhileRunning = (runtime: BotRuntime): BotStatus =>
        runtime.live.approvals.length > 0 || runtime.live.handoff !== null ? "waiting" : "working";

      const record = (
        runtime: BotRuntime,
        botId: BotId,
        role: MessageRole,
        text: string,
        attachments: ReadonlyArray<Attachment> = [],
        steps: ReadonlyArray<TraceStep> = [],
      ) =>
        repository.appendMessage(botId, role, text, attachments, steps).pipe(
          Effect.map((message) => {
            publish(runtime, { _tag: "Message", message });
            // The bot list shows the last message.
            PubSub.publishUnsafe(statusChanges, undefined);
          }),
        );

      const canUseToolFor =
        (runtime: BotRuntime): CanUseTool =>
        (toolName, input, { signal, suggestions }) =>
          new Promise<PermissionResult>((resolve) => {
            // The handoff is itself a request to the operator, so it needs no approval.
            if (toolName === `mcp__clots__${HANDOFF_TOOL}`) {
              resolve({ behavior: "allow", updatedInput: input });

              return;
            }


            const id = crypto.randomUUID();

            const settle = (result: PermissionResult) => {
              runtime.approvals.delete(id);
              const approvals = runtime.live.approvals.filter((approval) => approval.id !== id);
              setLive(runtime, { approvals });
              setLive(runtime, { status: statusWhileRunning(runtime) });
              resolve(result);
            };

            runtime.approvals.set(id, (decision) => {
              if (decision === "deny") {
                settle({ behavior: "deny", message: "The operator denied this action." });

                return;
              }

              settle({
                behavior: "allow",
                updatedInput: input,
                ...(decision === "allowAlways" && suggestions !== undefined
                  ? { updatedPermissions: suggestions }
                  : {}),
              });
            });

            // The CLI withdraws the request when the turn is interrupted.
            signal.addEventListener("abort", () =>
              settle({ behavior: "deny", message: "The request was cancelled." }),
            );

            const approval = {
              id,
              toolName,
              input: JSON.stringify(input, null, 2),
              canAllowAlways: suggestions !== undefined && suggestions.length > 0,
            };
            setLive(runtime, { approvals: [...runtime.live.approvals, approval], status: "waiting" });
          });

      /** Finds a bot by its id or by its name, which the operator writes as `@Name`. */
      const findBot = (reference: string) =>
        repository.list.pipe(
          Effect.map((bots) =>
            bots.find((bot) => bot.id === reference || bot.name.toLowerCase() === reference.replace(/^@/, "").toLowerCase()),
          ),
        );

      /** Lists the bots whose routines belong to `self`: itself and its clones, which run routines in their own threads. */
      const ownRoutineBots = (self: StoredBot) =>
        repository.list.pipe(Effect.map((bots) => bots.filter((bot) => bot.id === self.id || bot.clonedFrom === self.id)));

      /**
       * The tools of the clots server that each bot gets: the handoff of the browser, and the tools
       * that let a bot see what other bots do and message them.
       */
      const clotsServerFor = (runtime: BotRuntime, self: StoredBot) =>
        createSdkMcpServer({
          name: "clots",
          tools: [
            tool(
              "clone_bot",
              "Make a clone of a clots bot and give it a task. The clone works in its own thread and reports back to you with send_bot_message. Use it to split work, for example one clone per pull request.",
              {
                task: z
                  .string()
                  .describe("The clone's first message: what to do and what to report. It can contain a skill, such as /review <url>."),
                bot: z.string().optional().describe("The bot to clone, by id or name such as @Engineer. The default is you."),
                name: z.string().optional().describe("A short name for the clone, such as Review #12."),
              },
              async ({ task, bot: reference, name }) => {
                if (self.clonedFrom !== null) return toolText("A clone cannot make clones. Ask your orchestrator instead.");

                const bots = await Effect.runPromise(repository.list);
                if (bots.filter((bot) => bot.clonedFrom === self.id).length >= MAX_CLONES) {
                  return toolText(`You have ${MAX_CLONES} clones already. Delete finished ones with delete_bot first.`);
                }

                const source = reference === undefined ? self : await Effect.runPromise(findBot(reference));
                if (source === undefined) return toolText(`No bot is called ${reference}. list_bots shows the bots.`);

                const clone = await Effect.runPromise(
                  repository.create({
                    name: uniqueName(name ?? `${source.name} clone`, bots),
                    instructions: source.instructions,
                    color: source.color,
                    shape: source.shape,
                    model: source.model,
                    projectId: source.projectId,
                    clonedFrom: self.id,
                  }),
                );
                // The bot list shows the new clone.
                PubSub.publishUnsafe(statusChanges, undefined);

                await Effect.runPromise(
                  send(clone, "bot", `@${self.name}: ${task}\n\nWhen you are done, report the result to @${self.name} with send_bot_message. Then stay: @${self.name} or the operator deletes you when you are no longer needed.`),
                );

                return toolText(
                  `Started @${clone.name} (id ${clone.id}). It reports back with send_bot_message. Delete it with delete_bot when you no longer need it.`,
                );
              },
            ),
            tool(
              "delete_bot",
              "Delete a clone: a clone that you made, or yourself when you are a clone and the operator asked you to in their message. Never do it on your own after a task. It deletes the clone's thread, notes and browser. A bot that the operator made cannot be deleted this way.",
              { bot: z.string().describe("The clone's id or name, or your own.") },
              async ({ bot: reference }) => {
                const target = await Effect.runPromise(findBot(reference));
                if (target === undefined) return toolText(`No bot is called ${reference}. list_bots shows the bots.`);

                // Only clones can go this way: the clone itself, or its orchestrator. The operator's own bots stay.
                const mayDelete = target.clonedFrom !== null && (target.id === self.id || target.clonedFrom === self.id);
                if (!mayDelete) return toolText(`@${target.name} is not a clone of yours, so only the operator can delete it.`);

                // A bot that deletes itself stops its own session, so the delete starts after this call has answered.
                if (target.id === self.id) {
                  // A clone goes on its own only when the operator asks for it. Its orchestrator deletes it directly instead.
                  if (runtime.lastPromptFrom !== "user") {
                    return toolText(
                      "You can delete yourself only when the operator asks you to in their own message. Your orchestrator can delete you with delete_bot.",
                    );
                  }

                  setTimeout(() => void Effect.runPromise(deleteBot(target)), SELF_DELETE_DELAY_MS);

                  return toolText("Deleting this thread now.");
                }

                await Effect.runPromise(deleteBot(target));

                return toolText(`Deleted @${target.name}.`);
              },
            ),
            tool(
              "create_routine",
              `Make a clots routine: a prompt that clots sends on a schedule, such as a morning brief every day at 9:00. Use it for recurring work that must keep running across restarts. For a short check within this session, such as every 5 minutes for the next hour, use CronCreate or Monitor instead. By default the routine gets its own thread: a bot under you that runs it, so its runs do not fill this conversation, and that can read your notes and thread. Use where "here" only for reminders or tasks that belong in this conversation. The operator can pause or delete a routine in the details pane of the bot that runs it.`,
              {
                title: z.string().describe("A short name, such as Morning brief. It names the routine's own thread."),
                cron: z.string().describe(`A 5-field cron expression in the host's time zone (${HOST_TIME_ZONE}), such as "0 9 * * *" for every day at 9:00.`),
                prompt: z.string().describe("The message that each run gets. Say what to do and what to report, so it works without this conversation."),
                where: z.enum(["own thread", "here"]).optional().describe('"own thread" (the default) or "here", this conversation.'),
              },
              async ({ title, cron, prompt, where = "own thread" }) => {
                const next = nextRunAt(cron, Date.now());
                if (next === undefined) return toolText(`"${cron}" is not a valid cron expression.`);

                // A clone cannot make clones, so its routines run in its own thread.
                if (where === "here" || self.clonedFrom !== null) {
                  const routine = await Effect.runPromise(schedules.create(self.id, cron, prompt, next));

                  return toolText(`Made routine ${routine.id} in this thread. The first run is ${new Date(next).toLocaleString()} (${HOST_TIME_ZONE}).`);
                }

                const bots = await Effect.runPromise(repository.list);
                if (bots.filter((bot) => bot.clonedFrom === self.id).length >= MAX_CLONES) {
                  return toolText(`You have ${MAX_CLONES} clones and routine threads already. Delete one first, or use where "here".`);
                }

                const runner = await Effect.runPromise(
                  repository.create({
                    name: uniqueName(title, bots),
                    instructions: [
                      self.instructions,
                      `You run the clots routine "${title}" for @${self.name}. Each run arrives as a message in this thread, and the operator reads your result here.`,
                      `When a run needs to know what @${self.name} did, read its notes directory ${self.workingDirectory} and its thread with read_bot_thread.`,
                    ].filter((part) => part.trim() !== "").join("\n\n"),
                    color: self.color,
                    shape: self.shape,
                    model: self.model,
                    projectId: self.projectId,
                    clonedFrom: self.id,
                  }),
                );
                const routine = await Effect.runPromise(schedules.create(runner.id, cron, prompt, next));
                // The bot list shows the routine's thread.
                PubSub.publishUnsafe(statusChanges, undefined);

                return toolText(
                  `Made routine ${routine.id}. It runs in its own thread, @${runner.name}, under you. The first run is ${new Date(next).toLocaleString()} (${HOST_TIME_ZONE}).`,
                );
              },
            ),
            tool("list_routines", "List your clots routines, also those in their own threads, with id, thread, schedule, next run and prompt.", {}, async () => {
              const runners = await Effect.runPromise(ownRoutineBots(self));
              const lines = await Promise.all(
                runners.map(async (runner) =>
                  (await Effect.runPromise(schedules.list(runner.id))).map((routine) =>
                    [
                      routine.id,
                      runner.id === self.id ? "here" : `@${runner.name}`,
                      routine.cron,
                      routine.paused ? "paused" : `next ${new Date(routine.nextRunAt).toLocaleString()}`,
                      routine.prompt,
                    ].join(" | "),
                  ),
                ),
              );

              return toolText(lines.flat().join("\n") || "You have no routines.");
            }),
            tool(
              "delete_routine",
              "Delete one of your clots routines, for example when the operator no longer wants it. A routine with its own thread also deletes that thread.",
              { id: z.string().describe("The routine's id from list_routines.") },
              async ({ id }) => {
                for (const runner of await Effect.runPromise(ownRoutineBots(self))) {
                  const routines = await Effect.runPromise(schedules.list(runner.id));
                  if (!routines.some((routine) => routine.id === id)) continue;

                  // The routine's own thread exists only for its runs, so it goes with its last routine.
                  if (runner.id !== self.id && routines.length === 1) await Effect.runPromise(deleteBot(runner));
                  else await Effect.runPromise(schedules.remove(id));

                  return toolText(`Deleted routine ${id}.`);
                }

                return toolText(`You have no routine ${id}. list_routines shows yours.`);
              },
            ),
            tool("list_bots", "List the other clots bots with their id, status, project and Claude Code session.", {}, async () => {
              const bots = await Effect.runPromise(repository.list);
              const lines = bots
                .filter((bot) => bot.id !== self.id)
                .map((bot) =>
                  [
                    `@${bot.name}`,
                    `id ${bot.id}`,
                    runtimes.get(bot.id)?.live.status ?? "idle",
                    bot.projectName === null ? "no project" : `project ${bot.projectName}`,
                    bot.sdkSessionId === null ? "no session yet" : `session ${bot.sdkSessionId}`,
                  ].join(" | "),
                );

              return toolText(lines.join("\n") || "There are no other bots.");
            }),
            tool(
              "read_bot_thread",
              "Read the recent messages and the live status of another clots bot, to see what it works on.",
              {
                bot: z.string().describe("The bot's id, or its name such as @Engineer."),
                count: z.number().int().min(1).max(50).optional().describe("How many recent messages. The default is 20."),
              },
              async ({ bot: reference, count = 20 }) => {
                const bot = await Effect.runPromise(findBot(reference));
                if (bot === undefined) return toolText(`No bot is called ${reference}. list_bots shows the bots.`);

                const messages = (await Effect.runPromise(repository.messagesAfter(bot.id, 0))).slice(-count);
                const live = runtimes.get(bot.id)?.live ?? IDLE;
                const lines = messages.map((message) =>
                  message.role === "trace"
                    ? `[worked: ${message.steps.map((step) => step.title).join("; ")}]`
                    : `${message.role}: ${message.text.slice(0, MAX_READ_MESSAGE_LENGTH)}`,
                );
                const now = [
                  `Status: ${live.status}.`,
                  ...live.steps.filter((step) => step.status === "running").map((step) => `Running: ${step.title}`),
                  ...live.tasks.map((task) => `In the background: ${task.description}`),
                ];

                return toolText([`@${bot.name} (id ${bot.id})`, ...now, "", ...lines].join("\n"));
              },
            ),
            tool(
              "send_bot_message",
              "Send a message to another clots bot. It arrives in that bot's thread and starts its turn. Its answer stays in its own thread: read it later with read_bot_thread.",
              {
                bot: z.string().describe("The bot's id, or its name such as @Engineer."),
                text: z.string().describe("The message. Say what you need and why, so the bot can act without asking."),
              },
              async ({ bot: reference, text }) => {
                const bot = await Effect.runPromise(findBot(reference));
                if (bot === undefined) return toolText(`No bot is called ${reference}. list_bots shows the bots.`);
                if (bot.id === self.id) return toolText("That is you. Pick another bot.");

                await Effect.runPromise(send(bot, "bot", `@${self.name}: ${text}`));

                return toolText(`Sent to @${bot.name}. Read its answer later with read_bot_thread.`);
              },
            ),
            tool(
              HANDOFF_TOOL,
              "Ask the operator to take over your browser, for example for a login or a captcha. Returns when the operator is done.",
              { reason: z.string().describe("What the operator must do, in one sentence.") },
              async ({ reason }) => {
                await new Promise<void>((resolve) => {
                  runtime.finishHandoff = resolve;
                  setLive(runtime, { handoff: { id: crypto.randomUUID(), reason }, status: "waiting" });
                });

                return {
                  content: [{ type: "text", text: "The operator is done. Take a snapshot to see the page." }],
                };
              },
            ),
          ],
        });

      const setStepStatus = (runtime: BotRuntime, finished: ReadonlySet<string>) => {
        const steps = runtime.live.steps.map((step) => (finished.has(step.id) ? { ...step, status: "done" as const } : step));
        setLive(runtime, { steps });
      };

      /**
       * Moves the finished steps from the live state into the thread as one trace, so that the
       * thread keeps them. A step that still runs stays live, unless the turn ended.
       */
      const recordTrace = (runtime: BotRuntime, botId: BotId, turnEnded: boolean) =>
        Effect.gen(function* () {
          const finished = runtime.live.steps.filter((step) => turnEnded || step.status === "done");
          if (finished.length === 0) return;

          const steps = finished.map((step) => ({ ...step, status: "done" as const }));
          yield* record(runtime, botId, "trace", "", [], steps);
          setLive(runtime, { steps: runtime.live.steps.filter((step) => !finished.includes(step)) });
        });

      /** Keeps the files of a message in the bot's notes directory, where the bot can also read them. */
      const saveUploads = (bot: StoredBot, uploads: ReadonlyArray<Upload>) => {
        const directory = join(bot.workingDirectory, "attachments");
        if (uploads.length > 0) mkdirSync(directory, { recursive: true });

        return uploads.map((upload) => {
          const id = crypto.randomUUID();
          const bytes = Buffer.from(upload.data, "base64");
          // The name comes from the client, so only its last part without odd characters is used.
          const path = join(directory, `${id}-${basename(upload.name).replaceAll(/[^\w.-]+/g, "_")}`);
          writeFileSync(path, bytes);

          return { upload, path, attachment: { id, name: upload.name, mediaType: upload.mediaType, size: bytes.length } };
        });
      };

      /** Stores what the operator can start with `/name`. Claude Code's own commands stay out. */
      const saveSkills = (botId: BotId, commands: ReadonlyArray<SlashCommand>) =>
        repository
          .setSkills(
            botId,
            commands.filter((command) => command.builtin !== true).map(({ name, description }) => ({ name, description })),
          )
          .pipe(Effect.andThen(PubSub.publish(skillChanges, undefined)));

      /** The bots that a short session listed since the server started, so a bot without skills is not asked again and again. */
      const skillsListed = new Set<BotId>();

      const loadSkills = (bot: StoredBot) =>
        Effect.gen(function* () {
          if (skillsListed.has(bot.id)) return;

          skillsListed.add(bot.id);

          const lister = query({
            // The prompt never comes: the process only answers the request for its skills.
            prompt: Stream.toAsyncIterable(Stream.never),
            options: {
              ...claudeOptions,
              cwd: bot.projectDirectory ?? bot.workingDirectory,
              ...(bot.projectDirectory === null ? {} : { additionalDirectories: [bot.workingDirectory] }),
              env: { ...claudeOptions.env, CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1" },
              settingSources: ["user", "project", "local"],
              persistSession: false,
            },
          });

          yield* Effect.tryPromise(() => lister.supportedCommands()).pipe(
            Effect.flatMap((commands) => saveSkills(bot.id, commands)),
            Effect.timeout("30 seconds"),
            Effect.ignore,
            Effect.ensuring(Effect.sync(() => lister.close())),
          );
        });

      const handle = (runtime: BotRuntime, botId: BotId, message: SDKMessage) =>
        Effect.gen(function* () {
          if (message.type === "system" && message.subtype === "init") {
            yield* repository.setSdkSessionId(botId, message.session_id);

            // The list of skills is not part of the init message, so the session is asked for it.
            const session = runtime.session;
            if (session !== null) {
              yield* Effect.tryPromise(() => session.query.supportedCommands()).pipe(
                Effect.flatMap((commands) => saveSkills(botId, commands)),
                Effect.ignore,
              );
            }

            return;
          }

          // Compaction summarizes the older context. While it runs, the thread shows it as a step.
          if (message.type === "system" && message.subtype === "status") {
            if (message.status === "compacting") {
              const step = { id: `${COMPACT_STEP}${Date.now()}`, title: "Compacting the conversation", status: "running" as const };
              setLive(runtime, { status: statusWhileRunning(runtime), steps: [...runtime.live.steps, step] });
            }

            return;
          }

          // A finished compaction leaves a note in the thread, so the operator sees where the bot's memory was summarized.
          if (message.type === "system" && message.subtype === "compact_boundary") {
            const running = runtime.live.steps.filter((step) => step.id.startsWith(COMPACT_STEP) && step.status === "running");
            setStepStatus(runtime, new Set(running.map((step) => step.id)));

            const { trigger, pre_tokens, post_tokens } = message.compact_metadata;
            yield* record(runtime, botId, "compact", compactNote(trigger, pre_tokens, post_tokens));

            return;
          }

          // The session found more skills, for example in a project directory.
          if (message.type === "system" && message.subtype === "commands_changed") {
            yield* saveSkills(botId, message.commands);

            return;
          }

          // Work in the background, such as a subagent, can outlive the turn that started it. Housekeeping tasks stay out.
          if (message.type === "system" && message.subtype === "background_tasks_changed") {
            const tasks = message.tasks.flatMap((task) =>
              task.ambient === true ? [] : [{ id: task.task_id, description: task.description }],
            );
            setLive(runtime, { tasks });
            // The bot list shows the running tasks.
            PubSub.publishUnsafe(statusChanges, undefined);

            return;
          }

          if (message.type === "result") {
            yield* recordTrace(runtime, botId, true);

            if (message.subtype !== "success") {
              yield* record(runtime, botId, "assistant", `The turn failed: ${message.subtype}.`);
            }

            // The operator did not see the turn end, so the sidebar marks the bot.
            if (runtime.viewers === 0) {
              yield* repository.setUnread(botId, true);
              PubSub.publishUnsafe(statusChanges, undefined);
            }

            setLive(runtime, { status: "idle", steps: [] });

            return;
          }

          // Subagent output stays out of the thread. Only the bot's own messages show.
          if (message.type !== "stream_event" && message.type !== "assistant" && message.type !== "user") return;
          if (message.parent_tool_use_id !== null) return;

          // A user message from the SDK carries the results of tool calls. Each result ends its step.
          if (message.type === "user") {
            const content = message.message.content;
            const finished = new Set(
              typeof content === "string"
                ? []
                : content.flatMap((block) => (block.type === "tool_result" ? [block.tool_use_id] : [])),
            );
            if (finished.size > 0) setStepStatus(runtime, finished);

            return;
          }

          // A queued prompt can start a new turn after the previous result.
          if (runtime.live.status === "idle") setLive(runtime, { status: "working" });

          if (message.type === "stream_event") {
            const event = message.event;

            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              const step = { id: event.content_block.id, title: `Using ${event.content_block.name}`, status: "running" as const };
              setLive(runtime, { steps: [...runtime.live.steps, step] });
            }

            return;
          }

          // The finished tool call carries a short description of what the bot does.
          for (const block of message.message.content) {
            if (block.type !== "tool_use") continue;

            const description = (block.input as { description?: unknown }).description;

            // A transcript has no stream events, so after a restart the step starts here.
            if (!runtime.live.steps.some((step) => step.id === block.id)) {
              const title = typeof description === "string" ? description : `Using ${block.name}`;
              setLive(runtime, { steps: [...runtime.live.steps, { id: block.id, title, status: "running" }] });

              continue;
            }

            if (typeof description !== "string") continue;

            const steps = runtime.live.steps.map((step) => (step.id === block.id ? { ...step, title: description } : step));
            setLive(runtime, { steps });
          }

          const text = textOf(message.message.content);
          if (text !== "") {
            // The steps before this message stay above it in the thread.
            yield* recordTrace(runtime, botId, false);
            yield* record(runtime, botId, "assistant", text);
          }

          yield* repository.setSyncedUuid(botId, message.uuid);
        });

      /**
       * Adds what the session wrote to its transcript after `after` to the thread, through the same
       * handling as a live session. Returns the last entry. A transcript without `after` adds nothing.
       */
      const catchUp = (runtime: BotRuntime, bot: StoredBot, sessionId: string, after: string) =>
        Effect.gen(function* () {
          const entries = yield* Effect.promise(() =>
            getSessionMessages(sessionId, { dir: bot.projectDirectory ?? bot.workingDirectory }),
          );
          const start = entries.findIndex((entry) => entry.uuid === after);
          if (start === -1) return after;

          for (const entry of entries.slice(start + 1)) {
            yield* handle(runtime, bot.id, entry as SDKMessage);
          }

          return entries.at(-1)?.uuid ?? after;
        });

      /**
       * Follows a session that a server restart cut off. Its `claude` process can still run its
       * turn, so the thread gets the rest from the transcript until the process ends. Then the
       * prompts that waited start a new session.
       */
      const followLeftover = (bot: StoredBot, pid: number) =>
        Effect.gen(function* () {
          const runtime = runtimeFor(bot.id);
          runtime.leftover = { pid, prompts: [] };
          setLive(runtime, { status: "working" });

          let after = bot.syncedUuid;
          for (;;) {
            // The check comes first, so the last read sees everything that the process wrote.
            const running = claudeIsRunning(pid);
            if (bot.sdkSessionId !== null && after !== null) after = yield* catchUp(runtime, bot, bot.sdkSessionId, after);
            if (!running) break;

            yield* Effect.sleep(FOLLOW_INTERVAL);
          }

          yield* recordTrace(runtime, bot.id, true);
          yield* repository.setClaudePid(bot.id, null);
          const waiting = runtime.leftover.prompts;
          runtime.leftover = null;
          setLive(runtime, { status: "idle", steps: [] });

          const current = yield* repository.find(bot.id);
          if (current === undefined) return;

          for (const prompt of waiting) yield* deliver(current, runtime, prompt);
        });

      const startSession = (bot: StoredBot, runtime: BotRuntime) =>
        Effect.gen(function* () {
          const prompts = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();
          const ended = yield* Deferred.make<void>();
          const systemPrompt = systemPromptFor(bot);
          const session = query({
            prompt: Stream.toAsyncIterable(Stream.fromQueue(prompts)),
            options: {
              ...claudeOptions,
              cwd: bot.projectDirectory ?? bot.workingDirectory,
              // In a project, the bot still reads and writes its notes directory.
              ...(bot.projectDirectory === null ? {} : { additionalDirectories: [bot.workingDirectory] }),
              env: {
                ...claudeOptions.env,
                ...makeBrowserEnvironment(bot),
                // Claude Code loads CLAUDE.md from an additional directory only with this variable.
                CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1",
              },
              model: bot.model,
              settingSources: ["user", "project", "local"],
              // A recorded prompt survives a resume, so a restart for new settings would keep the old name and instructions.
              systemPrompt: { type: "preset", preset: "claude_code", append: systemPrompt, snapshot: false },
              // The thread shows whole replies, but a partial message tells it at once that a tool call starts.
              includePartialMessages: true,
              // A classifier allows or denies each tool call. It asks the operator through canUseTool
              // only when it cannot decide.
              permissionMode: "auto",
              canUseTool: canUseToolFor(runtime),
              mcpServers: { clots: clotsServerFor(runtime, bot) },
              // The thread has no question dialog. The bot asks in plain text.
              disallowedTools: ["AskUserQuestion"],
              ...(bot.sdkSessionId === null ? {} : { resume: bot.sdkSessionId }),
              // The process id tells the next server whether this session outlived a restart.
              spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
                const child = spawn(command, args, { cwd, env, signal, stdio: ["pipe", "pipe", "ignore"] });
                if (child.pid !== undefined) Effect.runFork(repository.setClaudePid(bot.id, child.pid));

                // The SDK starts the same Node child process itself. Bun's types lack its event methods.
                return child as unknown as SpawnedProcess;
              },
            },
          });
          runtime.session = { prompts, query: session, systemPrompt, ended };

          // Iterate the Query itself: `return()` on the raw generator waits behind a pending read.
          const messages: AsyncIterable<SDKMessage> = { [Symbol.asyncIterator]: () => session };

          yield* Stream.fromAsyncIterable(messages, (error) => error).pipe(
            Stream.runForEach((message) => handle(runtime, bot.id, message)),
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : record(runtime, bot.id, "assistant", `The session stopped: ${Cause.pretty(cause)}`),
            ),
            Effect.ensuring(repository.setClaudePid(bot.id, null)),
            Effect.ensuring(
              Effect.sync(() => {
                session.close();
                runtime.session = null;
                runtime.approvals.clear();
                runtime.finishHandoff = null;
                setLive(runtime, IDLE);
              }),
            ),
            Effect.ensuring(Deferred.succeed(ended, undefined)),
            Effect.forkIn(scope),
          );

          return runtime.session;
        });

      const stop = (botId: BotId) =>
        Effect.gen(function* () {
          const leftover = runtimes.get(botId)?.leftover;
          if (leftover !== undefined && leftover !== null) process.kill(leftover.pid, "SIGTERM");

          const session = runtimes.get(botId)?.session;
          if (session === undefined || session === null) return;

          session.query.close();
          // A new session or a delete must not overlap with the last writes of this one.
          yield* Deferred.await(session.ended).pipe(Effect.timeout("10 seconds"), Effect.ignore);
        });

      /**
       * Describes each other bot that a message mentions, so the bot can look at its work or message
       * it. Only the prompt gets this. The thread keeps the message as the operator wrote it.
       */
      const mentionNote = (text: string, sender: StoredBot) =>
        repository.list.pipe(
          Effect.map((bots) => {
            const mentioned = bots.filter((bot) => bot.id !== sender.id && mentions(text, bot.name));
            if (mentioned.length === 0) return "";

            const lines = mentioned.map((bot) =>
              bot.sdkSessionId === null
                ? `- @${bot.name}: bot id ${bot.id}, no Claude Code session yet.`
                : `- @${bot.name}: bot id ${bot.id}, Claude Code session ${bot.sdkSessionId}, transcript ${transcriptPath(bot, bot.sdkSessionId)}`,
            );

            return `\n\nMentioned clots bots. Use the clots tools read_bot_thread and send_bot_message to see what a bot does or to message it.\n${lines.join("\n")}`;
          }),
        );

      const send = (bot: StoredBot, role: Exclude<MessageRole, "assistant">, text: string, uploads: ReadonlyArray<Upload> = []) =>
          Effect.gen(function* () {
            const runtime = runtimeFor(bot.id);
            runtime.lastPromptFrom = role;
            const saved = saveUploads(bot, uploads);
            yield* record(runtime, bot.id, role, text, saved.map((file) => file.attachment));
            setLive(runtime, { status: statusWhileRunning(runtime) });

            // The bot sees an image at once. For each file it also gets the path, so it can read or use the file.
            const images = saved
              .filter((file) => INLINE_IMAGE_TYPES.has(file.upload.mediaType))
              .map((file) => ({
                type: "image",
                source: { type: "base64", media_type: file.upload.mediaType, data: file.upload.data },
              }));
            const paths = saved.length === 0 ? "" : `\n\nAttached files:\n${saved.map((file) => file.path).join("\n")}`;
            const note = yield* mentionNote(text, bot);
            const origins: Partial<Record<MessageRole, string>> = {
              bot: "\n\n(This came from another clots bot. Answer with send_bot_message only when it needs an answer.)",
              // Without this, a bot that gets its routine's prompt can set the routine up again instead of doing it.
              routine: "\n\n(This is one of your clots routines firing on its schedule. Do the task now. Do not create, list or change routines unless the task asks.)",
            };
            const origin = origins[role] ?? "";

            yield* deliver(bot, runtime, {
              type: "user",
              message: { role: "user", content: [...images, { type: "text", text: `${text}${paths}${note}${origin}`.trim() }] },
              parent_tool_use_id: null,
            } as SDKUserMessage);
          });

      /** Gives a prompt to the bot's session, and starts or resumes the session when none runs. */
      const deliver = (bot: StoredBot, runtime: BotRuntime, prompt: SDKUserMessage) =>
        Effect.gen(function* () {
          // Two processes must not write one conversation, so the session from before a restart ends first.
          if (runtime.leftover !== null) {
            runtime.leftover.prompts.push(prompt);

            return;
          }

          if (runtime.restart !== null) {
            runtime.restart.prompts.push(prompt);

            return;
          }

          // Changed settings need a new session, but the running turn must finish first.
          if (runtime.session !== null && runtime.session.systemPrompt !== systemPromptFor(bot)) {
            runtime.restart = { prompts: [withSettingsNote(prompt)] };
            yield* restartAfterTurn(bot.id, runtime, runtime.session).pipe(Effect.forkIn(scope));

            return;
          }

          const session = runtime.session ?? (yield* startSession(bot, runtime));
          Queue.offerUnsafe(session.prompts, prompt);
        });

      /**
       * Ends the input of a session that has an old system prompt. The SDK closes the session only
       * after its running turn and its queued prompts finish. Then the waiting prompts resume the
       * conversation in a new session with the current settings.
       */
      const restartAfterTurn = (botId: BotId, runtime: BotRuntime, session: NonNullable<BotRuntime["session"]>): Effect.Effect<void> =>
        Effect.gen(function* () {
          Queue.endUnsafe(session.prompts);
          yield* Deferred.await(session.ended);

          const waiting = runtime.restart?.prompts ?? [];
          runtime.restart = null;

          const current = yield* repository.find(botId);

          if (current === undefined) return;

          // The old session went idle when it ended, but the waiting prompts still run.
          setLive(runtime, { status: "working" });
          for (const prompt of waiting) yield* deliver(current, runtime, prompt);
        });

      const removeRuntime = (botId: BotId) => stop(botId).pipe(Effect.andThen(Effect.sync(() => runtimes.delete(botId))));

      const compact = (bot: StoredBot) =>
        Effect.gen(function* () {
          const runtime = runtimeFor(bot.id);
          setLive(runtime, { status: statusWhileRunning(runtime) });

          // Claude Code runs its own command. The thread gets a note when it is done, not a message from the operator.
          yield* deliver(bot, runtime, {
            type: "user",
            message: { role: "user", content: "/compact" },
            parent_tool_use_id: null,
          } as SDKUserMessage);
        });

      const noteSettingsChange = (bot: StoredBot, changes: BotChanges) => {
        const notes = [
          changes.name !== undefined && changes.name !== bot.name ? `Renamed to ${changes.name}` : "",
          changes.instructions !== undefined && changes.instructions !== bot.instructions ? "Instructions updated" : "",
        ].filter((note) => note !== "");

        if (notes.length === 0) return Effect.void;

        return record(runtimeFor(bot.id), bot.id, "settings", notes.join(" · "));
      };

      const deleteBot = (bot: StoredBot) =>
        removeRuntime(bot.id).pipe(
          Effect.andThen(closeBrowser(bot)),
          Effect.andThen(repository.remove(bot)),
          Effect.andThen(Effect.sync(() => removeClaudeTranscripts(bot))),
          Effect.andThen(PubSub.publish(statusChanges, undefined)),
          Effect.asVoid,
        );

      // A session that was running when the server stopped may still run its turn.
      for (const bot of yield* repository.list) {
        if (bot.claudePid !== null) yield* Effect.forkIn(followLeftover(bot, bot.claudePid), scope);
      }

      return BotSessions.of({
        statusChanges,
        skillChanges,
        live: (botId) => runtimeFor(botId).live,
        events: (botId) => runtimeFor(botId).events,
        view: (botId) =>
          Effect.acquireRelease(
            Effect.sync(() => void (runtimeFor(botId).viewers += 1)),
            () => Effect.sync(() => void (runtimeFor(botId).viewers -= 1)),
          ),

        send,

        interrupt: (botId) =>
          Effect.promise(async () => {
            const runtime = runtimeFor(botId);
            // The session from before a restart takes no commands, so Stop ends its process.
            if (runtime.leftover !== null) process.kill(runtime.leftover.pid, "SIGTERM");

            await runtime.session?.query.interrupt();
          }),

        setModel: (botId, model) =>
          Effect.promise(async () => {
            await runtimeFor(botId).session?.query.setModel(model);
          }),

        stop,

        loadSkills,

        remove: removeRuntime,

        deleteBot,

        compact,

        noteSettingsChange,

        resolveApproval: (botId, approvalId, decision) =>
          Effect.sync(() => runtimeFor(botId).approvals.get(approvalId)?.(decision)),

        resolveHandoff: (botId, handoffId) =>
          Effect.sync(() => {
            const runtime = runtimeFor(botId);
            if (runtime.live.handoff?.id !== handoffId) return;

            runtime.finishHandoff?.();
            runtime.finishHandoff = null;
            setLive(runtime, { handoff: null });
            setLive(runtime, { status: statusWhileRunning(runtime) });
          }),
      });
    }),
  );
}
