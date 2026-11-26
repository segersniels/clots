import {
  createSdkMcpServer,
  getSessionMessages,
  query,
  tool,
  type CanUseTool,
  type HookCallback,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKResultError,
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
  LoginDecision,
  LoginRequest,
  LoginSource,
  MessageRole,
  RoutinePlace,
  Schedule,
  ThreadEvent,
  ThreadLiveState,
  TraceStep,
  TraceStepKind,
  Upload,
} from "@clots/contracts";
import {
  CloneIsReadOnly,
  InvalidCron,
  LoginCopyFailed,
  MAX_UPLOAD_BYTES,
  TooManyClones,
} from "@clots/contracts";
import { Cause, Context, Deferred, Effect, Layer, PubSub, Queue, Scope, Stream } from "effect";
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "zod";

import { ClotsConfig } from "../config.ts";
import { HOST_TIME_ZONE, nextRunAt, ScheduleRepository } from "../schedules/ScheduleRepository.ts";
import { BotRepository, type BotChanges, type StoredBot } from "./BotRepository.ts";
import { readPages } from "../browser/BotChrome.ts";
import { botChrome, closeBrowser, makeBrowserEnvironment } from "../browser/BrowserEnvironment.ts";
import { copyLogin, findLoginSources, siteOf } from "../browser/Logins.ts";
import {
  botPlugins,
  botSkillsSignature,
  ensurePluginManifest,
  OWN_SKILLS_NOTE,
  saveBotSkill,
  showOwnSkills,
  toOwnSkills,
} from "./BotPlugin.ts";
import {
  makeClaudeEnvironment,
  removeClaudeTranscripts,
  transcriptPath,
} from "./ClaudeEnvironment.ts";

const HANDOFF_TOOL = "request_handoff";

const LOGIN_TOOL = "request_login";

/** How long the login card says that the copy worked before it leaves. */
const LOGIN_DONE_MS = 1200;

/** The longest wait for a login copy, which can start the other bot's Chrome first. */
const LOGIN_COPY_TIMEOUT = "30 seconds";

/** Joins bot names for a sentence: "Scout", "Scout and Writer", "Scout, Writer and Analyst". */
const joinNames = (names: ReadonlyArray<string>) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** The most characters of one message that `read_bot_thread` returns, so a long reply does not flood the reader. */
const MAX_READ_MESSAGE_LENGTH = 1500;

/** Checks whether a message mentions a bot: `@Name` at the start of a word, not followed by more of a word. */
const mentions = (text: string, name: string) => {
  for (
    let index = text.indexOf(`@${name}`);
    index !== -1;
    index = text.indexOf(`@${name}`, index + 1)
  ) {
    const startsWord = index === 0 || /\s/.test(text[index - 1]!);
    const endsWord = !/\w/.test(text[index + name.length + 1] ?? "");

    if (startsWord && endsWord) {
      return true;
    }
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
  const status = Bun.spawnSync(["ps", "-o", "stat=,args=", "-p", String(pid)])
    .stdout.toString()
    .trim();

  return status !== "" && !status.startsWith("Z") && status.includes("stream-json");
};

/** The thread size, in tokens, at which a bot compacts its conversation. */
const AUTO_COMPACT_WINDOW = 258_000;

/** The start of the id of the step that shows a compaction while it runs. */
const COMPACT_STEP = "compact-";

/** Writes a token count the short way, for example 4.5k or 180k. */
const shortTokens = (tokens: number) =>
  tokens < 10_000 ? `${(tokens / 1000).toFixed(1)}k` : `${Math.round(tokens / 1000)}k`;

/** Describes a finished compaction for the thread, for example "Conversation compacted · 180k → 32k tokens". */
const compactNote = (trigger: "manual" | "auto", before: number, after: number | undefined) => {
  const what =
    trigger === "auto" ? "Conversation compacted automatically" : "Conversation compacted";

  if (after === undefined) {
    return `${what} · ${shortTokens(before)} tokens before`;
  }

  return `${what} · ${shortTokens(before)} → ${shortTokens(after)} tokens`;
};

/** Gives a clone a name that no other bot has, so that `@Name` finds exactly one bot. */
const uniqueName = (wanted: string, bots: ReadonlyArray<StoredBot>) => {
  const taken = new Set(bots.map((bot) => bot.name.toLowerCase()));

  for (let number = 1; ; number += 1) {
    const candidate = number === 1 ? wanted : `${wanted} ${number}`;

    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
};

/** Builds the text that a tool returns. */
const toolText = (text: string) => ({ content: [{ type: "text" as const, text }] });

/** Names a tool for the operator. An MCP tool such as "mcp__clots__send_bot_message" shows as "send_bot_message". */
const shownToolName = (name: string) => name.replace(/^mcp__.+?__/, "");

/** The verbs that a step shows for the tools that work on one file. */
const FILE_VERBS: Readonly<Record<string, string>> = {
  Read: "Reading",
  Write: "Writing",
  Edit: "Editing",
};

/**
 * Titles a tool call for the operator. The bot's own description wins. Without one, the title shows
 * what the tool works on, such as the command, the file or the bot it messages.
 */
const stepTitle = (
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  messagedBot: string | undefined,
) => {
  const { description, command, file_path: filePath } = input;

  if (typeof description === "string") {
    return description;
  }

  if (typeof command === "string") {
    return command.trim().split("\n")[0] ?? "";
  }

  const fileVerb = FILE_VERBS[toolName];
  if (fileVerb !== undefined && typeof filePath === "string") {
    return `${fileVerb} ${basename(filePath)}`;
  }

  if (messagedBot !== undefined) {
    return `Messaging @${messagedBot}`;
  }

  return `Using ${shownToolName(toolName)}`;
};

/** The kinds of the tools whose kind follows from their name alone. */
const TOOL_KINDS: Readonly<Record<string, TraceStepKind>> = {
  Bash: "command",
  BashOutput: "command",
  Read: "read",
  Write: "edit",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Grep: "search",
  Glob: "search",
  WebSearch: "web",
  WebFetch: "web",
  send_bot_message: "message",
};

/** Finds the kind of a tool call. A command that drives the bot's browser counts as a browser step. */
const stepKind = (toolName: string, input: Readonly<Record<string, unknown>> = {}) => {
  if (typeof input.command === "string" && /^\s*agent-browser\b/.test(input.command)) {
    return "browser";
  }

  return TOOL_KINDS[shownToolName(toolName)] ?? "tool";
};

/** The image files that the thread shows when a bot opens one with Read, by extension. */
const SHOWN_IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** The image types that Claude takes as an image block. Other files reach the bot as a path only. */
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const IDLE: ThreadLiveState = {
  status: "idle",
  steps: [],
  approvals: [],
  handoff: null,
  loginRequest: null,
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
    /** The bot's settings that the session started with, so the next session can tell the bot what changed. */
    readonly startedAs: StoredBot;
    /** The bot's own skills that the session loaded. Claude Code does not load a skill file that changes later, so a change needs a new session. */
    readonly skills: string;
    /** Completes when the session has stopped and wrote its last message. */
    readonly ended: Deferred.Deferred<void>;
  } | null;
  readonly approvals: Map<string, (decision: ApprovalDecision) => void>;
  finishHandoff: (() => void) | null;
  finishLoginRequest: ((decision: LoginDecision) => void) | null;
  /** The sites whose logins in other bots the bot heard about. It hears about each site once. */
  readonly loginHints: Set<string>;
  /** The images that the running steps opened, by step id. The trace of those steps shows them. */
  readonly stepImages: Map<string, Attachment>;
  /** Who sent the latest prompt: the operator, a routine or another bot. A clone may delete itself only after the operator's. */
  lastPromptFrom: MessageRole | null;
  /** A session from before a server restart that still runs, and the prompts that wait until it ends. */
  leftover: { readonly pid: number; readonly prompts: Array<SDKUserMessage> } | null;
  /** The prompts that wait while a session with an old system prompt finishes its work. */
  restart: { readonly prompts: Array<SDKUserMessage> } | null;
  /** The open conversation views of the bot, on any device. A turn that ends while nobody views it marks the bot unread. */
  viewers: number;
  /** Whether the operator pressed Stop during the running turn. The SDK ends that turn as a failure. */
  stopping: boolean;
}

/** The sentences that tell the operator why a turn ended early, by the subtype of the SDK result. */
const TURN_FAILURES: Record<SDKResultError["subtype"], string> = {
  error_during_execution: "Something went wrong, so I stopped. Send your message again to retry.",
  error_max_turns: "I stopped because this turn took too many steps.",
  error_max_budget_usd: "I stopped because this turn reached its spending limit.",
  error_max_structured_output_retries:
    "I stopped because I could not write the reply in the required format.",
};

/**
 * Tells a bot in its first prompt after a restart what the operator changed. Without the old name,
 * a renamed bot finds its earlier messages under a name that its system prompt does not have.
 */
const settingsNote = (before: StoredBot, after: StoredBot) => {
  const changes = [
    before.name === after.name ? "" : `you were renamed from ${before.name} to ${after.name}`,
    before.instructions === after.instructions ? "" : "your instructions changed",
  ].filter((change) => change !== "");
  const details = changes.length === 0 ? "" : `: ${changes.join(", and ")}`;

  return `(The operator changed your clots settings${details}. Your system prompt has the current version.)`;
};

/** Adds the settings note to a prompt. A slash command such as `/compact` stays as it is. */
const withSettingsNote = (prompt: SDKUserMessage, note: string): SDKUserMessage => {
  const content = prompt.message.content;

  if (typeof content === "string") {
    return prompt;
  }

  return {
    ...prompt,
    message: { role: "user", content: [...content, { type: "text", text: note }] },
  };
};

const systemPromptFor = (bot: StoredBot) =>
  [
    `You are ${bot.name}, an always-on bot that the operator talks to through clots.`,
    `You have one ongoing thread. Your notes directory, ${bot.workingDirectory}, holds your memory and the files you make.`,
    bot.projectDirectory === null
      ? "Your notes directory is also your current directory."
      : `You work on the project "${bot.projectName}". Its directory, ${bot.projectDirectory}, is your current directory.`,
    // Without this, a bot inspects its directories before it answers a plain greeting.
    "Answer a message directly. Read files or run commands only when the task needs them.",
    "You have a browser: use the `agent-browser` CLI through Bash. Run `agent-browser skills get core` before the first use.",
    "Your browser session and profile are already set in the environment. Do not pass `--session` or `--profile`, or the operator cannot see your browser.",
    `When a page needs the operator (a login, a captcha, a payment), call the ${HANDOFF_TOOL} tool and wait.`,
    bot.parentName === null
      ? ""
      : `You are a clone of @${bot.parentName}: you have its instructions, its skills and its memory, and they stay the same as its own. You cannot change them or make routines. When a task needs to know what @${bot.parentName} did, read its notes directory ${bot.parentDirectory} and its thread with read_bot_thread.`,
    // Only a bot with its own skills gets the line, so the prompt of every other bot stays the same.
    ...(botPlugins(bot).length === 0 ? [] : [OWN_SKILLS_NOTE]),
    bot.instructions.trim() === "" ? "" : `# Instructions\n\n${bot.instructions}`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");

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
    /** Stops one background task. The session then reports the shorter task list. */
    stopTask(botId: BotId, taskId: string): Effect.Effect<void>;
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
    /**
     * Makes a routine of a bot. With "clone", a clone of the bot runs it in its own thread, under the
     * bot, from the first run on. A clone has no routines of its own.
     */
    createRoutine(
      bot: StoredBot,
      routine: { cron: string; prompt: string; place: RoutinePlace },
    ): Effect.Effect<Schedule, InvalidCron | TooManyClones | CloneIsReadOnly>;
    /** Sends a routine's prompt to the bot that runs it. A routine without its clone gets a new clone. */
    runRoutine(owner: StoredBot, routine: Schedule): Effect.Effect<void>;
    /**
     * Moves a routine to the bot's own conversation or to a clone, which the next run makes. A clone
     * that ran the routine stays, with its thread.
     */
    moveRoutine(
      owner: StoredBot,
      routine: Schedule,
      place: RoutinePlace,
    ): Effect.Effect<void, TooManyClones>;
    /** Deletes a routine, and the clone that runs it. */
    deleteRoutine(routine: Schedule): Effect.Effect<void>;
    /** Marks in the thread that the operator renamed the bot or changed its instructions. Other changes add nothing. */
    noteSettingsChange(bot: StoredBot, changes: BotChanges): Effect.Effect<void>;
    /** Switches the model of a running session. A bot without a session reads its model at the next start. */
    setModel(botId: BotId, model: BotModel): Effect.Effect<void>;
    resolveApproval(
      botId: BotId,
      approvalId: string,
      decision: ApprovalDecision,
    ): Effect.Effect<void>;
    resolveHandoff(botId: BotId, handoffId: string): Effect.Effect<void>;
    /** Lists the other bots of the bot's project that are logged in on the site of a page, latest first. */
    findLogins(bot: StoredBot, url: string): Effect.Effect<ReadonlyArray<LoginSource>>;
    /** Copies another bot's login on the site of a page into the bot's browser, for the take-over window. */
    copyLogin(bot: StoredBot, source: StoredBot, url: string): Effect.Effect<void, LoginCopyFailed>;
    resolveLoginRequest(
      botId: BotId,
      requestId: string,
      decision: LoginDecision,
    ): Effect.Effect<void>;
    live(botId: BotId): ThreadLiveState;
    events(botId: BotId): PubSub.PubSub<ThreadEvent>;
    /** Counts the operator as a viewer of the bot's conversation until the scope closes. */
    view(botId: BotId): Effect.Effect<void, never, Scope.Scope>;
    /** Fires when the status of a bot changes. */
    readonly statusChanges: PubSub.PubSub<void>;
    /** Fires when the skills of a bot change. */
    readonly skillChanges: PubSub.PubSub<void>;
    /**
     * Checks whether the files of the bot's own skills changed, such as after an edit in the details
     * pane. A change fires `ownSkillChanges` and lists the bot's skills again.
     */
    checkOwnSkills(bot: StoredBot): Effect.Effect<void>;
    /** Fires with the bot whose own skill files changed, by the operator or by the bot itself. */
    readonly ownSkillChanges: PubSub.PubSub<BotId>;
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
      const ownSkillChanges = yield* PubSub.unbounded<BotId>();
      const runtimes = new Map<BotId, BotRuntime>();

      const claudeOptions = {
        env: makeClaudeEnvironment(process.env),
        pathToClaudeCodeExecutable: config.claudePath,
        // One effort for every model, so the operator's own Claude Code settings do not decide how much a bot thinks.
        effort: "medium" as const,
      };

      const runtimeFor = (botId: BotId): BotRuntime => {
        const existing = runtimes.get(botId);
        if (existing !== undefined) {
          return existing;
        }

        const runtime: BotRuntime = {
          live: IDLE,
          events: Effect.runSync(PubSub.unbounded<ThreadEvent>()),
          session: null,
          approvals: new Map(),
          finishHandoff: null,
          finishLoginRequest: null,
          loginHints: new Set(),
          stepImages: new Map(),
          lastPromptFrom: null,
          leftover: null,
          restart: null,
          viewers: 0,
          stopping: false,
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

        if (runtime.live.status !== previousStatus) {
          PubSub.publishUnsafe(statusChanges, undefined);
        }
      };

      /** Derives the status after an approval, a handoff or a login request changes. */
      const statusWhileRunning = (runtime: BotRuntime): BotStatus => {
        const loginState = runtime.live.loginRequest?.state;
        const asksForLogin = loginState === "asking" || loginState === "failed";

        return runtime.live.approvals.length > 0 || runtime.live.handoff !== null || asksForLogin
          ? "waiting"
          : "working";
      };

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
            // The handoff and the login request are themselves requests to the operator, so they need no approval.
            if (
              toolName === `mcp__clots__${HANDOFF_TOOL}` ||
              toolName === `mcp__clots__${LOGIN_TOOL}`
            ) {
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
              toolName: shownToolName(toolName),
              input: JSON.stringify(input, null, 2),
              canAllowAlways: suggestions !== undefined && suggestions.length > 0,
            };
            setLive(runtime, {
              approvals: [...runtime.live.approvals, approval],
              status: "waiting",
            });
          });

      /** Finds a bot by its id or by its name, which the operator writes as `@Name`. */
      const findBot = (reference: string) =>
        repository.list.pipe(
          Effect.map((bots) =>
            bots.find(
              (bot) =>
                bot.id === reference ||
                bot.name.toLowerCase() === reference.replace(/^@/, "").toLowerCase(),
            ),
          ),
        );

      /** Counts the clones that a bot made, which it reports to and deletes. */
      const clonesMadeBy = (bots: ReadonlyArray<StoredBot>, self: StoredBot) =>
        bots.filter((bot) => bot.orchestratedBy === self.id).length;

      /** Makes a clone of a bot that runs one of its routines. It mirrors the bot and shows under it. */
      const makeRunner = (owner: StoredBot, title: string) =>
        Effect.gen(function* () {
          const runner = yield* repository.create({
            name: uniqueName(title, yield* repository.list),
            instructions: "",
            color: owner.color,
            shape: owner.shape,
            model: owner.model,
            projectId: owner.projectId,
            clonedFrom: owner.id,
            orchestratedBy: owner.id,
          });
          // The bot list shows the routine's thread.
          yield* PubSub.publish(statusChanges, undefined);

          return runner;
        });

      const createRoutine = (
        self: StoredBot,
        { cron, prompt, place }: { cron: string; prompt: string; place: RoutinePlace },
      ) =>
        Effect.gen(function* () {
          const next = nextRunAt(cron, Date.now());
          if (next === undefined) {
            return yield* new InvalidCron({ cron });
          }

          // The bot that a clone mirrors owns all routines.
          if (self.clonedFrom !== null) {
            return yield* new CloneIsReadOnly({ botId: self.id });
          }

          if (place === "clone" && clonesMadeBy(yield* repository.list, self) >= MAX_CLONES) {
            return yield* new TooManyClones({ max: MAX_CLONES });
          }

          return yield* schedules.create(self.id, cron, prompt, next, place);
        });

      const runRoutine = (owner: StoredBot, routine: Schedule) =>
        Effect.gen(function* () {
          if (routine.place === "here") {
            return yield* send(owner, "routine", routine.prompt);
          }

          const current =
            routine.runnerId === null ? undefined : yield* repository.find(routine.runnerId);

          // The clone comes with the first run. The operator may also have deleted it, and then a new clone runs the routine.
          let runner = current;
          if (runner?.clonedFrom !== owner.id) {
            runner = yield* makeRunner(owner, `${owner.name} routine`);
            yield* schedules.setPlace(routine.id, "clone", runner.id);
          }

          yield* send(runner, "routine", routine.prompt);
        });

      const moveRoutine = (owner: StoredBot, routine: Schedule, place: RoutinePlace) =>
        Effect.gen(function* () {
          if (place === routine.place) {
            return;
          }

          if (place === "clone" && clonesMadeBy(yield* repository.list, owner) >= MAX_CLONES) {
            return yield* new TooManyClones({ max: MAX_CLONES });
          }

          yield* schedules.setPlace(routine.id, place, null);
        });

      const deleteRoutine = (routine: Schedule) =>
        Effect.gen(function* () {
          yield* schedules.remove(routine.id);

          // The clone exists only for the routine's runs, so it goes with the routine.
          const runner =
            routine.runnerId === null ? undefined : yield* repository.find(routine.runnerId);

          if (runner !== undefined) {
            yield* deleteBot(runner);
          }
        });

      /** Lists the bots of the target's project that are logged in on the site of a page. Without its own Chrome, a bot cannot copy logins. */
      const loginSourcesFor = (target: StoredBot, url: string) =>
        repository.list.pipe(
          Effect.flatMap((bots) =>
            botChrome(target) === undefined
              ? Effect.succeed([])
              : Effect.promise(() => findLoginSources(target, bots, url)),
          ),
        );

      const toLoginSource = ({
        bot,
        updatedAt,
      }: {
        readonly bot: StoredBot;
        readonly updatedAt: number;
      }): LoginSource => ({
        botId: bot.id,
        name: bot.name,
        color: bot.color,
        shape: bot.shape,
        updatedAt,
      });

      /** Copies a login between two bot browsers. A failure becomes a sentence for the operator. */
      const copyLoginBetween = (source: StoredBot, target: StoredBot, url: string) => {
        const from = botChrome(source);
        const to = botChrome(target);
        if (from === undefined || to === undefined) {
          return Effect.fail(
            new LoginCopyFailed({
              message:
                "clots runs no Chrome of its own for the bots here, so it cannot copy logins.",
            }),
          );
        }

        return Effect.tryPromise({
          try: () => copyLogin(from, to, url),
          catch: (error) =>
            new LoginCopyFailed({
              message: error instanceof Error ? error.message : String(error),
            }),
        }).pipe(
          Effect.timeoutOrElse({
            duration: LOGIN_COPY_TIMEOUT,
            orElse: () =>
              Effect.fail(
                new LoginCopyFailed({
                  message: `${source.name}'s browser did not answer. Try again in a moment.`,
                }),
              ),
          }),
        );
      };

      const updateLoginRequest = (runtime: BotRuntime, patch: Partial<LoginRequest>) => {
        if (runtime.live.loginRequest === null) {
          return;
        }

        setLive(runtime, { loginRequest: { ...runtime.live.loginRequest, ...patch } });
        setLive(runtime, { status: statusWhileRunning(runtime) });
      };

      /** Names the running login request step by its outcome, so the trace says what happened. */
      const titleLoginStep = (runtime: BotRuntime, title: string) => {
        const step = runtime.live.steps.findLast(
          (step) => step.status === "running" && step.title === `Using ${LOGIN_TOOL}`,
        );

        if (step === undefined) {
          return;
        }

        setLive(runtime, {
          steps: runtime.live.steps.map((each) => (each === step ? { ...each, title } : each)),
        });
      };

      /**
       * Tells the bot after a browser command when other bots of its project are logged in on the
       * site of one of its pages, so it can ask for that login instead of the operator.
       */
      const loginHintFor =
        (runtime: BotRuntime, bot: StoredBot): HookCallback =>
        async (input) => {
          if (input.hook_event_name !== "PostToolUse") {
            return {};
          }

          const command = (input.tool_input as { command?: unknown }).command;
          const chrome = botChrome(bot);
          if (
            typeof command !== "string" ||
            !command.includes("agent-browser") ||
            chrome === undefined
          ) {
            return {};
          }

          const bots = await Effect.runPromise(repository.list);
          const self = bots.find((each) => each.id === bot.id) ?? bot;
          const hints: Array<string> = [];

          for (const page of await readPages(chrome.port)) {
            const site = siteOf(page.url);
            if (site === undefined || runtime.loginHints.has(site)) {
              continue;
            }

            const sources = await findLoginSources(self, bots, page.url);
            if (sources.length === 0) {
              continue;
            }

            runtime.loginHints.add(site);
            const names = sources.map((source) => source.bot.name);
            const verb = names.length === 1 ? "is" : "are";
            const host = new URL(page.url).hostname;
            hints.push(
              `${joinNames(names)} ${verb} logged in on ${host}. When this site asks you to log in, call mcp__clots__${LOGIN_TOOL} with site "${host}" before you ask the operator.`,
            );
          }

          if (hints.length === 0) {
            return {};
          }

          return {
            hookSpecificOutput: {
              hookEventName: "PostToolUse",
              additionalContext: hints.join("\n"),
            },
          };
        };

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
                  .describe(
                    "The clone's first message: what to do and what to report. It can contain a skill, such as /review <url>.",
                  ),
                bot: z
                  .string()
                  .optional()
                  .describe(
                    "The bot to clone, by id or name such as @Engineer. The default is you.",
                  ),
                name: z
                  .string()
                  .optional()
                  .describe("A short name for the clone, such as Review #12."),
              },
              async ({ task, bot: reference, name }) => {
                if (self.clonedFrom !== null) {
                  return toolText("A clone cannot make clones. Ask your orchestrator instead.");
                }

                const bots = await Effect.runPromise(repository.list);
                if (clonesMadeBy(bots, self) >= MAX_CLONES) {
                  return toolText(
                    `You have ${MAX_CLONES} clones already. Delete finished ones with delete_bot first.`,
                  );
                }

                const source =
                  reference === undefined ? self : await Effect.runPromise(findBot(reference));

                if (source === undefined) {
                  return toolText(`No bot is called ${reference}. list_bots shows the bots.`);
                }

                if (source.clonedFrom !== null) {
                  return toolText(
                    `@${source.name} is a clone. Clone the bot that it mirrors instead.`,
                  );
                }

                // The clone mirrors the source and shows under it, but reports to the bot that made it.
                const clone = await Effect.runPromise(
                  repository.create({
                    name: uniqueName(name ?? `${source.name} clone`, bots),
                    instructions: "",
                    color: source.color,
                    shape: source.shape,
                    model: source.model,
                    projectId: source.projectId,
                    clonedFrom: source.id,
                    orchestratedBy: self.id,
                  }),
                );
                // The bot list shows the new clone.
                PubSub.publishUnsafe(statusChanges, undefined);

                await Effect.runPromise(
                  send(
                    clone,
                    "bot",
                    `@${self.name}: ${task}\n\nWhen you are done, report the result to @${self.name} with send_bot_message. Then stay: @${self.name} or the operator deletes you when you are no longer needed.`,
                  ),
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
                if (target === undefined) {
                  return toolText(`No bot is called ${reference}. list_bots shows the bots.`);
                }

                // Only clones can go this way: the clone itself, or its orchestrator. The operator's own bots stay.
                const mayDelete =
                  target.clonedFrom !== null &&
                  (target.id === self.id || target.orchestratedBy === self.id);

                if (!mayDelete) {
                  return toolText(
                    `@${target.name} is not a clone of yours, so only the operator can delete it.`,
                  );
                }

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
              `Make a clots routine: a prompt that clots sends on a schedule, such as a morning brief every day at 9:00. Use it for recurring work that must keep running across restarts. For a short check within this session, such as every 5 minutes for the next hour, use CronCreate or Monitor instead. A routine runs "here", in this conversation (the default), or in a "clone": a bot under you with your instructions, which the first run makes, so its runs do not fill this conversation, and that can read your notes and thread. Unless the operator already said where, ask them before you make it. The operator can pause or delete a routine in the details pane of the bot that runs it.`,
              {
                cron: z
                  .string()
                  .describe(
                    `A 5-field cron expression in the host's time zone (${HOST_TIME_ZONE}), such as "0 9 * * *" for every day at 9:00.`,
                  ),
                prompt: z
                  .string()
                  .describe(
                    "The message that each run gets. Say what to do and what to report, so it works without this conversation.",
                  ),
                where: z
                  .enum(["here", "clone"])
                  .optional()
                  .describe('"here", this conversation (the default), or "clone".'),
              },
              async ({ cron, prompt, where = "here" }) => {
                const result = await Effect.runPromise(
                  createRoutine(self, { cron, prompt, place: where }).pipe(
                    Effect.map((routine) => {
                      const firstRun = `The first run is ${new Date(routine.nextRunAt).toLocaleString()} (${HOST_TIME_ZONE}).`;

                      return routine.place === "here"
                        ? `Made routine ${routine.id} in this thread. ${firstRun}`
                        : `Made routine ${routine.id}. Its first run makes a clone under you, which runs it in its own thread. ${firstRun}`;
                    }),
                    Effect.catchTags({
                      InvalidCron: () =>
                        Effect.succeed(`"${cron}" is not a valid cron expression.`),
                      TooManyClones: ({ max }) =>
                        Effect.succeed(
                          `You have ${max} clones and routine threads already. Delete one first, or use where "here".`,
                        ),
                      CloneIsReadOnly: () =>
                        Effect.succeed(
                          `A clone has no routines of its own. Ask @${self.parentName} to make the routine.`,
                        ),
                    }),
                  ),
                );

                return toolText(result);
              },
            ),
            tool(
              "list_routines",
              "List your clots routines, also those in their own threads, with id, thread, schedule, next run and prompt.",
              {},
              async () => {
                const routines = await Effect.runPromise(schedules.list(self.id));
                const bots = await Effect.runPromise(repository.list);
                const lines = routines.map((routine) => {
                  const runner = bots.find((bot) => bot.id === routine.runnerId);
                  const thread =
                    routine.place === "here" || runner?.id === self.id
                      ? "here"
                      : `clone ${runner === undefined ? "(made at the next run)" : `@${runner.name}`}`;

                  return [
                    routine.id,
                    thread,
                    routine.cron,
                    routine.paused
                      ? "paused"
                      : `next ${new Date(routine.nextRunAt).toLocaleString()}`,
                    routine.prompt,
                  ].join(" | ");
                });

                return toolText(lines.join("\n") || "You have no routines.");
              },
            ),
            tool(
              "delete_routine",
              "Delete one of your clots routines, for example when the operator no longer wants it. A routine with its own thread also deletes that thread.",
              { id: z.string().describe("The routine's id from list_routines.") },
              async ({ id }) => {
                const routine = (await Effect.runPromise(schedules.list(self.id))).find(
                  (each) => each.id === id && each.botId === self.id,
                );

                if (routine === undefined) {
                  return toolText(`You have no routine ${id}. list_routines shows yours.`);
                }

                await Effect.runPromise(deleteRoutine(routine));

                return toolText(`Deleted routine ${id}.`);
              },
            ),
            tool(
              "list_bots",
              "List the other clots bots with their id, status, project and Claude Code session.",
              {},
              async () => {
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
              },
            ),
            tool(
              "read_bot_thread",
              "Read the recent messages and the live status of another clots bot, to see what it works on.",
              {
                bot: z.string().describe("The bot's id, or its name such as @Engineer."),
                count: z
                  .number()
                  .int()
                  .min(1)
                  .max(50)
                  .optional()
                  .describe("How many recent messages. The default is 20."),
              },
              async ({ bot: reference, count = 20 }) => {
                const bot = await Effect.runPromise(findBot(reference));
                if (bot === undefined) {
                  return toolText(`No bot is called ${reference}. list_bots shows the bots.`);
                }

                const messages = (
                  await Effect.runPromise(repository.messagesAfter(bot.id, 0))
                ).slice(-count);
                const live = runtimes.get(bot.id)?.live ?? IDLE;
                const lines = messages.map((message) =>
                  message.role === "trace"
                    ? `[worked: ${message.steps.map((step) => step.title).join("; ")}]`
                    : `${message.role}: ${message.text.slice(0, MAX_READ_MESSAGE_LENGTH)}`,
                );
                const now = [
                  `Status: ${live.status}.`,
                  ...live.steps
                    .filter((step) => step.status === "running")
                    .map((step) => `Running: ${step.title}`),
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
                text: z
                  .string()
                  .describe(
                    "The message. Say what you need and why, so the bot can act without asking.",
                  ),
              },
              async ({ bot: reference, text }) => {
                const bot = await Effect.runPromise(findBot(reference));
                if (bot === undefined) {
                  return toolText(`No bot is called ${reference}. list_bots shows the bots.`);
                }

                if (bot.id === self.id) {
                  return toolText("That is you. Pick another bot.");
                }

                await Effect.runPromise(send(bot, "bot", `@${self.name}: ${text}`));

                return toolText(
                  `Sent to @${bot.name}. Read its answer later with read_bot_thread.`,
                );
              },
            ),
            tool(
              "update_bot",
              "Change the name or the instructions of a clots bot: yourself, or another bot in your project. Do it only when the operator asks for it. The bot gets the change with its next message, after its current work.",
              {
                bot: z
                  .string()
                  .optional()
                  .describe("The bot's id, or its name such as @Engineer. The default is you."),
                name: z.string().trim().min(1).optional().describe("The new name."),
                instructions: z
                  .string()
                  .optional()
                  .describe(
                    "The new instructions, in full: they replace the old ones. They are the bot's part of its system prompt.",
                  ),
              },
              async ({ bot: reference, name, instructions }) => {
                const target =
                  reference === undefined ? self : await Effect.runPromise(findBot(reference));

                if (target === undefined) {
                  return toolText(`No bot is called ${reference}. list_bots shows the bots.`);
                }

                if (target.projectId !== self.projectId) {
                  return toolText(
                    `@${target.name} is not in your project, so only the operator can change it.`,
                  );
                }

                if (instructions !== undefined && target.clonedFrom !== null) {
                  return toolText(
                    `@${target.name} is a clone with the instructions of @${target.parentName}. Change those instead.`,
                  );
                }

                // Bots find each other by name, so two bots must not share one.
                const bots = await Effect.runPromise(repository.list);
                const nameTaken =
                  name !== undefined &&
                  bots.some(
                    (bot) => bot.id !== target.id && bot.name.toLowerCase() === name.toLowerCase(),
                  );

                if (nameTaken) {
                  return toolText(`Another bot is called ${name} already. Pick another name.`);
                }

                const changes = { name, instructions };
                await Effect.runPromise(
                  repository
                    .update(target.id, changes)
                    .pipe(
                      Effect.andThen(noteSettingsChange(target, changes)),
                      Effect.andThen(PubSub.publish(statusChanges, undefined)),
                    ),
                );

                return toolText(`Updated @${name ?? target.name}.`);
              },
            ),
            tool(
              "save_bot_skill",
              "Add a skill to a clots bot, or change one: yourself, or another bot in your project. Only that bot loads it, as /bot:<name>. For a skill from the web, read it first and fill in its parts here. The bot gets the skill with its next message, after its current work.",
              {
                bot: z
                  .string()
                  .optional()
                  .describe("The bot's id, or its name such as @Engineer. The default is you."),
                name: z
                  .string()
                  .describe(
                    "The skill's name: lowercase letters, digits and hyphens, up to 64 characters, such as launch-posts.",
                  ),
                description: z
                  .string()
                  .describe(
                    'When the skill applies, such as "Use when something ships." Claude Code loads the skill by it.',
                  ),
                body: z
                  .string()
                  .describe("The skill's steps in Markdown, without the frontmatter."),
                previous_name: z
                  .string()
                  .optional()
                  .describe(
                    "The current name of a skill to change. Leave it out to add a new skill.",
                  ),
              },
              async ({ bot: reference, name, description, body, previous_name }) => {
                const target =
                  reference === undefined ? self : await Effect.runPromise(findBot(reference));

                if (target === undefined) {
                  return toolText(`No bot is called ${reference}. list_bots shows the bots.`);
                }

                if (target.projectId !== self.projectId) {
                  return toolText(
                    `@${target.name} is not in your project, so only the operator can change it.`,
                  );
                }

                if (target.clonedFrom !== null) {
                  return toolText(
                    `@${target.name} is a clone with the skills of @${target.parentName}. Save the skill there instead.`,
                  );
                }

                const reason = saveBotSkill(target, { name, description, body }, previous_name);

                switch (reason) {
                  case "name":
                    return toolText(
                      "A skill name has only lowercase letters, digits and hyphens, up to 64 characters.",
                    );

                  case "taken":
                    return toolText(
                      `@${target.name} has a skill called ${name} already. Set previous_name to change it.`,
                    );

                  case "missing":
                    return toolText(`@${target.name} has no skill called ${previous_name}.`);
                }

                await Effect.runPromise(checkOwnSkills(target));

                return toolText(`Saved /bot:${name} for @${target.name}.`);
              },
            ),
            tool(
              HANDOFF_TOOL,
              "Ask the operator to take over your browser, for example for a login or a captcha. Returns when the operator is done.",
              { reason: z.string().describe("What the operator must do, in one sentence.") },
              async ({ reason }) => {
                await new Promise<void>((resolve) => {
                  runtime.finishHandoff = resolve;
                  setLive(runtime, {
                    handoff: { id: crypto.randomUUID(), reason },
                    status: "waiting",
                  });
                });

                return {
                  content: [
                    {
                      type: "text",
                      text: "The operator is done. Take a snapshot to see the page.",
                    },
                  ],
                };
              },
            ),
            tool(
              LOGIN_TOOL,
              "Use another clots bot's login on a site, so the operator does not have to log you in. Call it when a hint says that another bot is logged in, or when a site asks you to log in. The operator allows or skips the copy. It copies only that site's cookies and saved data, and you never see them. Returns copied, skipped, or why the copy failed.",
              {
                site: z
                  .string()
                  .describe("The site's host, such as app.example.com, or the page's address."),
                bot: z
                  .string()
                  .optional()
                  .describe(
                    "The bot whose login to use, by id or name such as @Scout. The default is the bot that logged in last.",
                  ),
              },
              async ({ site, bot: reference }) => {
                const url = site.includes("://") ? site : `https://${site}`;
                const host = URL.parse(url)?.hostname;
                if (host === undefined) {
                  return toolText(`${site} is not a site. Give a host such as app.example.com.`);
                }

                const sources = await Effect.runPromise(loginSourcesFor(self, url));
                const named =
                  reference === undefined ? undefined : await Effect.runPromise(findBot(reference));
                const source =
                  reference === undefined
                    ? sources[0]
                    : sources.find((each) => each.bot.id === named?.id);

                if (source === undefined) {
                  return toolText(
                    reference === undefined
                      ? `No other bot in your project is logged in on ${host}. Use ${HANDOFF_TOOL} to ask the operator to log in.`
                      : `${reference} is not a bot of your project that is logged in on ${host}.`,
                  );
                }

                const request: LoginRequest = {
                  id: crypto.randomUUID(),
                  host,
                  from: toLoginSource(source),
                  state: "asking",
                  error: null,
                };
                const name = source.bot.name;
                setLive(runtime, { loginRequest: request, status: "waiting" });

                // A failed copy stays on the card with Try again, so the loop waits for the operator again.
                while (true) {
                  const decision = await new Promise<LoginDecision>((resolve) => {
                    runtime.finishLoginRequest = resolve;
                  });
                  runtime.finishLoginRequest = null;

                  if (decision === "skip") {
                    const failure = runtime.live.loginRequest?.error ?? null;
                    titleLoginStep(runtime, `Skipped ${name}'s login`);
                    setLive(runtime, { loginRequest: null });
                    setLive(runtime, { status: statusWhileRunning(runtime) });

                    return toolText(
                      failure === null ? "skipped" : `skipped after a failed copy: ${failure}`,
                    );
                  }

                  updateLoginRequest(runtime, { state: "copying", error: null });
                  const error = await Effect.runPromise(
                    copyLoginBetween(source.bot, self, url).pipe(
                      Effect.match({
                        onSuccess: () => null,
                        onFailure: (failure) => failure.message,
                      }),
                    ),
                  );

                  if (error !== null) {
                    updateLoginRequest(runtime, { state: "failed", error });

                    continue;
                  }

                  updateLoginRequest(runtime, { state: "done" });
                  titleLoginStep(runtime, `Used ${name}'s login on ${host}`);
                  setTimeout(() => {
                    if (runtime.live.loginRequest?.id === request.id) {
                      setLive(runtime, { loginRequest: null });
                    }
                  }, LOGIN_DONE_MS);

                  return toolText(
                    "copied. The page reloaded with the login. Take a snapshot to see it.",
                  );
                }
              },
            ),
          ],
        });

      const setStepStatus = (runtime: BotRuntime, finished: ReadonlySet<string>) => {
        const steps = runtime.live.steps.map((step) =>
          finished.has(step.id) ? { ...step, status: "done" as const } : step,
        );
        setLive(runtime, { steps });
      };

      /**
       * Moves the finished steps from the live state into the thread as one trace, so that the
       * thread keeps them. A step that still runs stays live, unless the turn ended.
       */
      const recordTrace = (runtime: BotRuntime, botId: BotId, turnEnded: boolean) =>
        Effect.gen(function* () {
          const finished = runtime.live.steps.filter((step) => turnEnded || step.status === "done");
          if (finished.length === 0) {
            return;
          }

          const steps = finished.map((step) => ({ ...step, status: "done" as const }));
          const images = finished.flatMap((step) => runtime.stepImages.get(step.id) ?? []);
          for (const step of finished) {
            runtime.stepImages.delete(step.id);
          }

          yield* record(runtime, botId, "trace", "", images, steps);
          setLive(runtime, {
            steps: runtime.live.steps.filter((step) => !finished.includes(step)),
          });
        });

      /**
       * Keeps a copy of an image that the bot opened with Read, so that the thread shows the
       * operator what the bot looked at. A bot that says "here is the design" means this image.
       */
      const keepOpenedImage = (runtime: BotRuntime, botId: BotId, stepId: string, path: unknown) =>
        Effect.gen(function* () {
          const mediaType =
            typeof path === "string" ? SHOWN_IMAGE_TYPES[extname(path).toLowerCase()] : undefined;

          if (typeof path !== "string" || mediaType === undefined) {
            return;
          }

          const bot = yield* repository.find(botId);
          if (bot === undefined) {
            return;
          }

          // The file can be gone, or too large to keep. Then the step shows no image.
          yield* Effect.try(() => {
            const size = statSync(path).size;
            if (size > MAX_UPLOAD_BYTES) {
              return;
            }

            const id = crypto.randomUUID();
            const directory = join(bot.workingDirectory, "attachments");
            mkdirSync(directory, { recursive: true });
            copyFileSync(
              path,
              join(directory, `${id}-${basename(path).replaceAll(/[^\w.-]+/g, "_")}`),
            );
            runtime.stepImages.set(stepId, { id, name: basename(path), mediaType, size });
          }).pipe(Effect.ignore);
        });

      /** Keeps the files of a message in the bot's notes directory, where the bot can also read them. */
      const saveUploads = (bot: StoredBot, uploads: ReadonlyArray<Upload>) => {
        const directory = join(bot.workingDirectory, "attachments");
        if (uploads.length > 0) {
          mkdirSync(directory, { recursive: true });
        }

        return uploads.map((upload) => {
          const id = crypto.randomUUID();
          const bytes = Buffer.from(upload.data, "base64");
          // The name comes from the client, so only its last part without odd characters is used.
          const path = join(
            directory,
            `${id}-${basename(upload.name).replaceAll(/[^\w.-]+/g, "_")}`,
          );
          writeFileSync(path, bytes);

          return {
            upload,
            path,
            attachment: { id, name: upload.name, mediaType: upload.mediaType, size: bytes.length },
          };
        });
      };

      /** Stores what the operator can start with `/name`. Claude Code's own commands stay out, and the bot's own skills show by their bare names. */
      const saveSkills = (botId: BotId, commands: ReadonlyArray<SlashCommand>) =>
        repository
          .setSkills(
            botId,
            showOwnSkills(
              commands
                .filter((command) => command.builtin !== true)
                .map(({ name, description }) => ({ name, description })),
            ),
          )
          .pipe(Effect.andThen(PubSub.publish(skillChanges, undefined)));

      /** The bots that a short session listed since the server started, so a bot without skills is not asked again and again. */
      const skillsListed = new Set<BotId>();

      const loadSkills = (bot: StoredBot) =>
        Effect.gen(function* () {
          if (skillsListed.has(bot.id)) {
            return;
          }

          skillsListed.add(bot.id);
          const skills = botSkillsSignature(bot);

          const lister = query({
            // The prompt never comes: the process only answers the request for its skills.
            prompt: Stream.toAsyncIterable(Stream.never),
            options: {
              ...claudeOptions,
              cwd: bot.projectDirectory ?? bot.workingDirectory,
              ...(bot.projectDirectory === null
                ? {}
                : { additionalDirectories: [bot.workingDirectory] }),
              env: { ...claudeOptions.env, CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1" },
              settingSources: ["user", "project", "local"],
              plugins: botPlugins(bot),
              persistSession: false,
            },
          });

          yield* Effect.tryPromise(() => lister.supportedCommands()).pipe(
            // A skill file that changed while the process started gets its own, newer list.
            Effect.flatMap((commands) =>
              botSkillsSignature(bot) === skills ? saveSkills(bot.id, commands) : Effect.void,
            ),
            Effect.timeout("30 seconds"),
            Effect.ignore,
            Effect.ensuring(Effect.sync(() => lister.close())),
          );
        });

      /** The last seen state of each bot's own skill files. */
      const ownSkills = new Map<BotId, string>();

      const checkOwnSkills = (bot: StoredBot) =>
        Effect.gen(function* () {
          const signature = botSkillsSignature(bot);
          const previous = ownSkills.get(bot.id);

          if (previous === signature) {
            return;
          }

          ownSkills.set(bot.id, signature);

          // The first look at a bot only learns its files.
          if (previous === undefined) {
            return;
          }

          if (signature !== "") {
            ensurePluginManifest(bot);
          }

          yield* PubSub.publish(ownSkillChanges, bot.id);
          skillsListed.delete(bot.id);
          yield* loadSkills(bot).pipe(Effect.forkIn(scope));
        });

      // A bot can write its own skills, so the files are checked each second. The / list then follows without a restart.
      yield* repository.list.pipe(
        Effect.flatMap((bots) => Effect.forEach(bots, checkOwnSkills, { discard: true })),
        Effect.andThen(Effect.sleep("1 second")),
        Effect.forever,
        Effect.forkIn(scope),
      );

      const hasOldSkills = (session: NonNullable<BotRuntime["session"]>) =>
        botSkillsSignature(session.startedAs) !== session.skills;

      const handle = (runtime: BotRuntime, botId: BotId, message: SDKMessage) =>
        Effect.gen(function* () {
          if (message.type === "system" && message.subtype === "init") {
            yield* repository.setSdkSessionId(botId, message.session_id);

            // The list of skills is not part of the init message, so the session is asked for it.
            const session = runtime.session;
            if (session !== null && !hasOldSkills(session)) {
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
              const step = {
                id: `${COMPACT_STEP}${Date.now()}`,
                title: "Compacting the conversation",
                status: "running" as const,
              };
              setLive(runtime, {
                status: statusWhileRunning(runtime),
                steps: [...runtime.live.steps, step],
              });
            }

            return;
          }

          // A finished compaction leaves a note in the thread, so the operator sees where the bot's memory was summarized.
          if (message.type === "system" && message.subtype === "compact_boundary") {
            const running = runtime.live.steps.filter(
              (step) => step.id.startsWith(COMPACT_STEP) && step.status === "running",
            );
            setStepStatus(runtime, new Set(running.map((step) => step.id)));

            const { trigger, pre_tokens, post_tokens } = message.compact_metadata;
            yield* record(runtime, botId, "compact", compactNote(trigger, pre_tokens, post_tokens));

            return;
          }

          /**
           * The session found more skills, for example in a project directory.
           * A session with old skill files lists old skills, so the newer list from `loadSkills` stays.
           */
          if (message.type === "system" && message.subtype === "commands_changed") {
            if (runtime.session === null || !hasOldSkills(runtime.session)) {
              yield* saveSkills(botId, message.commands);
            }

            return;
          }

          // Work in the background, such as a subagent, can outlive the turn that started it. Housekeeping tasks stay out.
          if (message.type === "system" && message.subtype === "background_tasks_changed") {
            const tasks = message.tasks.flatMap((task) =>
              task.ambient === true
                ? []
                : [
                    {
                      id: task.task_id,
                      kind:
                        task.task_type === "local_agent" ? ("agent" as const) : ("shell" as const),
                      description: task.description,
                    },
                  ],
            );
            setLive(runtime, { tasks });
            // The bot list shows the running tasks.
            PubSub.publishUnsafe(statusChanges, undefined);

            return;
          }

          if (message.type === "result") {
            yield* recordTrace(runtime, botId, true);

            if (message.subtype !== "success") {
              yield* record(
                runtime,
                botId,
                "assistant",
                runtime.stopping ? "Stopped." : TURN_FAILURES[message.subtype],
              );
            }

            runtime.stopping = false;

            // The operator did not see the turn end, so the sidebar marks the bot.
            if (runtime.viewers === 0) {
              yield* repository.setUnread(botId, true);
              PubSub.publishUnsafe(statusChanges, undefined);
            }

            // A later turn can need the login that the bot did not use in this one, so the hints come again.
            runtime.loginHints.clear();
            setLive(runtime, { status: "idle", steps: [] });

            return;
          }

          // Subagent output stays out of the thread. Only the bot's own messages show.
          if (
            message.type !== "stream_event" &&
            message.type !== "assistant" &&
            message.type !== "user"
          ) {
            return;
          }

          if (message.parent_tool_use_id !== null) {
            return;
          }

          // A user message from the SDK carries the results of tool calls. Each result ends its step.
          if (message.type === "user") {
            const content = message.message.content;
            const finished = new Set(
              typeof content === "string"
                ? []
                : content.flatMap((block) =>
                    block.type === "tool_result" ? [block.tool_use_id] : [],
                  ),
            );

            if (finished.size > 0) {
              setStepStatus(runtime, finished);
            }

            return;
          }

          // A queued prompt can start a new turn after the previous result.
          if (runtime.live.status === "idle") {
            setLive(runtime, { status: "working" });
          }

          if (message.type === "stream_event") {
            const event = message.event;

            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              const step = {
                id: event.content_block.id,
                title: `Using ${shownToolName(event.content_block.name)}`,
                status: "running" as const,
                kind: stepKind(event.content_block.name),
              };
              setLive(runtime, { steps: [...runtime.live.steps, step] });
            }

            return;
          }

          // The finished tool call carries its input, which says what the bot does.
          for (const block of message.message.content) {
            if (block.type !== "tool_use") {
              continue;
            }

            if (block.name === "Read") {
              yield* keepOpenedImage(
                runtime,
                botId,
                block.id,
                (block.input as { file_path?: unknown }).file_path,
              );
            }

            const input = block.input as Readonly<Record<string, unknown>>;
            const messagedBot =
              shownToolName(block.name) === "send_bot_message" && typeof input.bot === "string"
                ? yield* findBot(input.bot)
                : undefined;
            const title = stepTitle(block.name, input, messagedBot?.name);
            const kind = stepKind(block.name, input);

            // A transcript has no stream events, so after a restart the step starts here.
            if (!runtime.live.steps.some((step) => step.id === block.id)) {
              setLive(runtime, {
                steps: [...runtime.live.steps, { id: block.id, title, kind, status: "running" }],
              });

              continue;
            }

            const steps = runtime.live.steps.map((step) =>
              step.id === block.id ? { ...step, title, kind } : step,
            );
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
          if (start === -1) {
            return after;
          }

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
            if (bot.sdkSessionId !== null && after !== null) {
              after = yield* catchUp(runtime, bot, bot.sdkSessionId, after);
            }

            if (!running) {
              break;
            }

            yield* Effect.sleep(FOLLOW_INTERVAL);
          }

          yield* recordTrace(runtime, bot.id, true);
          yield* repository.setClaudePid(bot.id, null);
          const waiting = runtime.leftover.prompts;
          runtime.leftover = null;
          setLive(runtime, { status: "idle", steps: [] });

          const current = yield* repository.find(bot.id);
          if (current === undefined) {
            return;
          }

          for (const prompt of waiting) {
            yield* deliver(current, runtime, prompt);
          }
        });

      const startSession = (bot: StoredBot, runtime: BotRuntime) =>
        Effect.gen(function* () {
          const prompts = yield* Queue.unbounded<SDKUserMessage, Cause.Done>();
          const ended = yield* Deferred.make<void>();
          const systemPrompt = systemPromptFor(bot);
          const skills = botSkillsSignature(bot);
          const session = query({
            prompt: Stream.toAsyncIterable(Stream.fromQueue(prompts)),
            options: {
              ...claudeOptions,
              cwd: bot.projectDirectory ?? bot.workingDirectory,
              // In a project, the bot still reads and writes its notes directory.
              ...(bot.projectDirectory === null
                ? {}
                : { additionalDirectories: [bot.workingDirectory] }),
              env: {
                ...claudeOptions.env,
                ...makeBrowserEnvironment(bot),
                // Claude Code loads CLAUDE.md from an additional directory only with this variable.
                CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: "1",
              },
              model: bot.model,
              settingSources: ["user", "project", "local"],
              // The skills of the bot's template load for this bot only.
              plugins: botPlugins(bot),
              // clots shows the bot's name, so Claude Code does not need a request to name the session.
              title: bot.name,
              settings: {
                // Claude Code keeps its memory per working directory, so all bots in a project would share it. Each bot keeps its own, and a clone shares the memory of the bot that it mirrors.
                autoMemoryDirectory: join(bot.parentDirectory ?? bot.workingDirectory, "memory"),
                // Each request pays for the whole thread again. Without this, a thread on a 1M model compacts only near 970k tokens.
                autoCompactWindow: AUTO_COMPACT_WINDOW,
              },
              // A recorded prompt survives a resume, so a restart for new settings would keep the old name and instructions.
              systemPrompt: {
                type: "preset",
                preset: "claude_code",
                append: systemPrompt,
                snapshot: false,
              },
              // The thread shows whole replies, but a partial message tells it at once that a tool call starts.
              includePartialMessages: true,
              /**
               * A classifier allows or denies each tool call. It asks the operator through canUseTool
               * only when it cannot decide.
               */
              permissionMode: "auto",
              canUseTool: canUseToolFor(runtime),
              mcpServers: { clots: clotsServerFor(runtime, bot) },
              hooks: { PostToolUse: [{ matcher: "Bash", hooks: [loginHintFor(runtime, bot)] }] },
              // The thread has no question dialog. The bot asks in plain text.
              disallowedTools: ["AskUserQuestion"],
              ...(bot.sdkSessionId === null ? {} : { resume: bot.sdkSessionId }),
              // The process id tells the next server whether this session outlived a restart.
              spawnClaudeCodeProcess: ({ command, args, cwd, env, signal }) => {
                const child = spawn(command, args, {
                  cwd,
                  env,
                  signal,
                  stdio: ["pipe", "pipe", "ignore"],
                });

                if (child.pid !== undefined) {
                  Effect.runFork(repository.setClaudePid(bot.id, child.pid));
                }

                // The SDK starts the same Node child process itself. Bun's types lack its event methods.
                return child as unknown as SpawnedProcess;
              },
            },
          });
          runtime.session = {
            prompts,
            query: session,
            systemPrompt,
            startedAs: bot,
            skills,
            ended,
          };

          // Iterate the Query itself: `return()` on the raw generator waits behind a pending read.
          const messages: AsyncIterable<SDKMessage> = { [Symbol.asyncIterator]: () => session };

          yield* Stream.fromAsyncIterable(messages, (error) => error).pipe(
            Stream.runForEach((message) => handle(runtime, bot.id, message)),
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.void
                : record(
                    runtime,
                    bot.id,
                    "assistant",
                    `The session stopped: ${Cause.pretty(cause)}`,
                  ),
            ),
            Effect.ensuring(repository.setClaudePid(bot.id, null)),
            Effect.ensuring(
              Effect.sync(() => {
                session.close();
                runtime.session = null;
                runtime.approvals.clear();
                runtime.finishHandoff = null;
                runtime.finishLoginRequest = null;
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
          if (leftover !== undefined && leftover !== null) {
            process.kill(leftover.pid, "SIGTERM");
          }

          const session = runtimes.get(botId)?.session;
          if (session === undefined || session === null) {
            return;
          }

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
            // Bots in other projects can share a name, so a mention reaches only the sender's own project.
            const mentioned = bots.filter(
              (bot) =>
                bot.id !== sender.id &&
                bot.projectId === sender.projectId &&
                mentions(text, bot.name),
            );

            if (mentioned.length === 0) {
              return "";
            }

            const lines = mentioned.map((bot) =>
              bot.sdkSessionId === null
                ? `- @${bot.name}: bot id ${bot.id}, no Claude Code session yet.`
                : `- @${bot.name}: bot id ${bot.id}, Claude Code session ${bot.sdkSessionId}, transcript ${transcriptPath(bot, bot.sdkSessionId)}`,
            );

            return `\n\nMentioned clots bots. Use the clots tools read_bot_thread and send_bot_message to see what a bot does or to message it.\n${lines.join("\n")}`;
          }),
        );

      const send = (
        bot: StoredBot,
        role: Exclude<MessageRole, "assistant">,
        text: string,
        uploads: ReadonlyArray<Upload> = [],
      ) =>
        Effect.gen(function* () {
          const runtime = runtimeFor(bot.id);
          runtime.lastPromptFrom = role;
          const saved = saveUploads(bot, uploads);
          yield* record(
            runtime,
            bot.id,
            role,
            text,
            saved.map((file) => file.attachment),
          );
          setLive(runtime, { status: statusWhileRunning(runtime) });

          // The bot sees an image at once. For each file it also gets the path, so it can read or use the file.
          const images = saved
            .filter((file) => INLINE_IMAGE_TYPES.has(file.upload.mediaType))
            .map((file) => ({
              type: "image",
              source: { type: "base64", media_type: file.upload.mediaType, data: file.upload.data },
            }));
          const paths =
            saved.length === 0
              ? ""
              : `\n\nAttached files:\n${saved.map((file) => file.path).join("\n")}`;
          const note = yield* mentionNote(text, bot);
          const origins: Partial<Record<MessageRole, string>> = {
            bot: "\n\n(This came from another clots bot. Answer with send_bot_message only when it needs an answer.)",
            // Without this, a bot that gets its routine's prompt can set the routine up again instead of doing it.
            routine:
              "\n\n(This is one of your clots routines firing on its schedule. Do the task now. Do not create, list or change routines unless the task asks.)",
          };
          const origin = origins[role] ?? "";

          yield* deliver(bot, runtime, {
            type: "user",
            message: {
              role: "user",
              content: [
                ...images,
                { type: "text", text: `${toOwnSkills(bot, text)}${paths}${note}${origin}`.trim() },
              ],
            },
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

          // Changed settings or skills need a new session, but the running turn must finish first.
          if (
            runtime.session !== null &&
            (runtime.session.systemPrompt !== systemPromptFor(bot) || hasOldSkills(runtime.session))
          ) {
            const settingsChanged = runtime.session.systemPrompt !== systemPromptFor(bot);
            runtime.restart = {
              prompts: [
                settingsChanged
                  ? withSettingsNote(prompt, settingsNote(runtime.session.startedAs, bot))
                  : prompt,
              ],
            };
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
      const restartAfterTurn = (
        botId: BotId,
        runtime: BotRuntime,
        session: NonNullable<BotRuntime["session"]>,
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          Queue.endUnsafe(session.prompts);
          yield* Deferred.await(session.ended);

          const waiting = runtime.restart?.prompts ?? [];
          runtime.restart = null;

          const current = yield* repository.find(botId);

          if (current === undefined) {
            return;
          }

          // The old session went idle when it ended, but the waiting prompts still run.
          setLive(runtime, { status: "working" });
          for (const prompt of waiting) {
            yield* deliver(current, runtime, prompt);
          }
        });

      const removeRuntime = (botId: BotId) =>
        stop(botId).pipe(Effect.andThen(Effect.sync(() => runtimes.delete(botId))));

      const noteSettingsChange = (bot: StoredBot, changes: BotChanges) => {
        const notes = [
          changes.name !== undefined && changes.name !== bot.name
            ? `Renamed to ${changes.name}`
            : "",
          changes.instructions !== undefined && changes.instructions !== bot.instructions
            ? "Instructions updated"
            : "",
        ].filter((note) => note !== "");

        // A thread without messages has no conversation for the divider to split, and it shows the empty state until the first message.
        if (notes.length === 0 || bot.lastMessageAt === null) {
          return Effect.void;
        }

        return record(runtimeFor(bot.id), bot.id, "settings", notes.join(" · "));
      };

      const deleteBot = (bot: StoredBot): Effect.Effect<void> =>
        Effect.gen(function* () {
          // A clone mirrors its bot, so it cannot outlive it.
          const clones = (yield* repository.list).filter((each) => each.clonedFrom === bot.id);
          yield* Effect.forEach(clones, deleteBot);

          yield* removeRuntime(bot.id);
          yield* closeBrowser(bot);
          yield* repository.remove(bot);
          removeClaudeTranscripts(bot);
          yield* PubSub.publish(statusChanges, undefined);
        });

      // A session that was running when the server stopped may still run its turn.
      for (const bot of yield* repository.list) {
        if (bot.claudePid !== null) {
          yield* Effect.forkIn(followLeftover(bot, bot.claudePid), scope);
        }
      }

      return BotSessions.of({
        statusChanges,
        skillChanges,
        ownSkillChanges,
        checkOwnSkills,
        live: (botId) => runtimeFor(botId).live,
        events: (botId) => runtimeFor(botId).events,
        view: (botId) =>
          Effect.acquireRelease(
            Effect.sync(() => void (runtimeFor(botId).viewers += 1)),
            () => Effect.sync(() => void (runtimeFor(botId).viewers -= 1)),
          ),

        send,
        runRoutine,
        moveRoutine,
        deleteRoutine,

        interrupt: (botId) =>
          Effect.promise(async () => {
            const runtime = runtimeFor(botId);
            if (runtime.live.status !== "idle") {
              runtime.stopping = true;
            }

            // The session from before a restart takes no commands, so Stop ends its process.
            if (runtime.leftover !== null) {
              process.kill(runtime.leftover.pid, "SIGTERM");
            }

            await runtime.session?.query.interrupt();
          }),

        stopTask: (botId, taskId) =>
          Effect.promise(async () => {
            await runtimeFor(botId).session?.query.stopTask(taskId);
          }),

        setModel: (botId, model) =>
          Effect.promise(async () => {
            await runtimeFor(botId).session?.query.setModel(model);
          }),

        stop,

        loadSkills,

        remove: removeRuntime,

        deleteBot,
        createRoutine,

        noteSettingsChange,

        resolveApproval: (botId, approvalId, decision) =>
          Effect.sync(() => runtimeFor(botId).approvals.get(approvalId)?.(decision)),

        resolveHandoff: (botId, handoffId) =>
          Effect.sync(() => {
            const runtime = runtimeFor(botId);
            if (runtime.live.handoff?.id !== handoffId) {
              return;
            }

            runtime.finishHandoff?.();
            runtime.finishHandoff = null;
            setLive(runtime, { handoff: null });
            setLive(runtime, { status: statusWhileRunning(runtime) });
          }),

        findLogins: (bot, url) =>
          loginSourcesFor(bot, url).pipe(Effect.map((sources) => sources.map(toLoginSource))),

        copyLogin: (bot, source, url) => copyLoginBetween(source, bot, url),

        resolveLoginRequest: (botId, requestId, decision) =>
          Effect.sync(() => {
            const runtime = runtimeFor(botId);
            const request = runtime.live.loginRequest;

            // A copy that runs or that already worked takes no new decision.
            if (
              request?.id !== requestId ||
              request.state === "copying" ||
              request.state === "done"
            ) {
              return;
            }

            runtime.finishLoginRequest?.(decision);
          }),
      });
    }),
  );
}
