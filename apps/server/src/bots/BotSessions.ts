import {
  createSdkMcpServer,
  query,
  tool,
  type CanUseTool,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SlashCommand,
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
import { Cause, Context, Deferred, Effect, Layer, PubSub, Queue, Stream } from "effect";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";

import { ClotsConfig } from "../config.ts";
import { BotRepository, type StoredBot } from "./BotRepository.ts";
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
    readonly prompts: Queue.Queue<SDKUserMessage>;
    readonly query: Query;
    /** Completes when the session has stopped and wrote its last message. */
    readonly ended: Deferred.Deferred<void>;
  } | null;
  readonly approvals: Map<string, (decision: ApprovalDecision) => void>;
  finishHandoff: (() => void) | null;
  /** Who sent the latest prompt: the operator, a routine or another bot. A clone may delete itself only after the operator's. */
  lastPromptFrom: MessageRole | null;
}

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
    /** Switches the model of a running session. A bot without a session reads its model at the next start. */
    setModel(botId: BotId, model: BotModel): Effect.Effect<void>;
    resolveApproval(botId: BotId, approvalId: string, decision: ApprovalDecision): Effect.Effect<void>;
    resolveHandoff(botId: BotId, handoffId: string): Effect.Effect<void>;
    live(botId: BotId): ThreadLiveState;
    events(botId: BotId): PubSub.PubSub<ThreadEvent>;
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
        });

      const startSession = (bot: StoredBot, runtime: BotRuntime) =>
        Effect.gen(function* () {
          const prompts = yield* Queue.unbounded<SDKUserMessage>();
          const ended = yield* Deferred.make<void>();
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
              systemPrompt: { type: "preset", preset: "claude_code", append: systemPromptFor(bot) },
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
            },
          });
          runtime.session = { prompts, query: session, ended };

          // Iterate the Query itself: `return()` on the raw generator waits behind a pending read.
          const messages: AsyncIterable<SDKMessage> = { [Symbol.asyncIterator]: () => session };

          yield* Stream.fromAsyncIterable(messages, (error) => error).pipe(
            Stream.runForEach((message) => handle(runtime, bot.id, message)),
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : record(runtime, bot.id, "assistant", `The session stopped: ${Cause.pretty(cause)}`),
            ),
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
            const origin =
              role === "bot" ? "\n\n(This came from another clots bot. Answer with send_bot_message only when it needs an answer.)" : "";

            const session = runtime.session ?? (yield* startSession(bot, runtime));
            Queue.offerUnsafe(session.prompts, {
              type: "user",
              message: { role: "user", content: [...images, { type: "text", text: `${text}${paths}${note}${origin}`.trim() }] },
              parent_tool_use_id: null,
            } as SDKUserMessage);
          });

      const removeRuntime = (botId: BotId) => stop(botId).pipe(Effect.andThen(Effect.sync(() => runtimes.delete(botId))));

      const deleteBot = (bot: StoredBot) =>
        removeRuntime(bot.id).pipe(
          Effect.andThen(closeBrowser(bot)),
          Effect.andThen(repository.remove(bot)),
          Effect.andThen(Effect.sync(() => removeClaudeTranscripts(bot))),
          Effect.andThen(PubSub.publish(statusChanges, undefined)),
          Effect.asVoid,
        );

      return BotSessions.of({
        statusChanges,
        skillChanges,
        live: (botId) => runtimeFor(botId).live,
        events: (botId) => runtimeFor(botId).events,

        send,

        interrupt: (botId) =>
          Effect.promise(async () => {
            await runtimeFor(botId).session?.query.interrupt();
          }),

        setModel: (botId, model) =>
          Effect.promise(async () => {
            await runtimeFor(botId).session?.query.setModel(model);
          }),

        stop,

        loadSkills,

        remove: removeRuntime,

        deleteBot,

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
