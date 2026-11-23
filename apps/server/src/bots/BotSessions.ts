import {
  createSdkMcpServer,
  query,
  tool,
  type CanUseTool,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ApprovalDecision,
  BotId,
  BotModel,
  BotStatus,
  MessageRole,
  ThreadEvent,
  ThreadLiveState,
} from "@clots/contracts";
import { Cause, Context, Effect, Layer, PubSub, Queue, Stream } from "effect";
import { z } from "zod";

import { ClotsConfig } from "../config.ts";
import { BotRepository, type StoredBot } from "./BotRepository.ts";
import { makeBrowserEnvironment } from "../browser/BrowserEnvironment.ts";
import { makeClaudeEnvironment } from "./ClaudeEnvironment.ts";

const HANDOFF_TOOL = "request_handoff";

const IDLE: ThreadLiveState = {
  status: "idle",
  activity: null,
  streamingText: "",
  approvals: [],
  handoff: null,
};

/** The in-memory state of one bot. The session exists only while a `claude` process runs. */
interface BotRuntime {
  live: ThreadLiveState;
  readonly events: PubSub.PubSub<ThreadEvent>;
  session: { readonly prompts: Queue.Queue<SDKUserMessage>; readonly query: Query } | null;
  readonly approvals: Map<string, (decision: ApprovalDecision) => void>;
  finishHandoff: (() => void) | null;
}

const systemPromptFor = (bot: StoredBot) =>
  [
    `You are ${bot.name}, an always-on bot that the operator talks to through clots.`,
    "You have one ongoing thread. Your working directory is your durable memory: keep notes in CLAUDE.md and other files there.",
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
    send(bot: StoredBot, role: Exclude<MessageRole, "assistant">, text: string): Effect.Effect<void>;
    interrupt(botId: BotId): Effect.Effect<void>;
    /** Switches the model of a running session. A bot without a session reads its model at the next start. */
    setModel(botId: BotId, model: BotModel): Effect.Effect<void>;
    resolveApproval(botId: BotId, approvalId: string, decision: ApprovalDecision): Effect.Effect<void>;
    resolveHandoff(botId: BotId, handoffId: string): Effect.Effect<void>;
    live(botId: BotId): ThreadLiveState;
    events(botId: BotId): PubSub.PubSub<ThreadEvent>;
    /** Fires when the status of a bot changes. */
    readonly statusChanges: PubSub.PubSub<void>;
  }
>()("clots/bots/BotSessions") {
  static readonly layer = Layer.effect(
    BotSessions,
    Effect.gen(function* () {
      const config = yield* ClotsConfig;
      const repository = yield* BotRepository;
      const scope = yield* Effect.scope;
      const statusChanges = yield* PubSub.unbounded<void>();
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

      const record = (runtime: BotRuntime, botId: BotId, role: MessageRole, text: string) =>
        repository.appendMessage(botId, role, text).pipe(
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

      const handoffServerFor = (runtime: BotRuntime) =>
        createSdkMcpServer({
          name: "clots",
          tools: [
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

      const handle = (runtime: BotRuntime, botId: BotId, message: SDKMessage) =>
        Effect.gen(function* () {
          if (message.type === "system" && message.subtype === "init") {
            yield* repository.setSdkSessionId(botId, message.session_id);

            return;
          }

          if (message.type === "result") {
            if (message.subtype !== "success") {
              yield* record(runtime, botId, "assistant", `The turn failed: ${message.subtype}.`);
            }

            setLive(runtime, { status: "idle", activity: null, streamingText: "" });

            return;
          }

          // Subagent output stays out of the thread. Only the bot's own messages show.
          if (message.type !== "stream_event" && message.type !== "assistant") return;
          if (message.parent_tool_use_id !== null) return;

          // A queued prompt can start a new turn after the previous result.
          if (runtime.live.status === "idle") setLive(runtime, { status: "working" });

          if (message.type === "stream_event") {
            const event = message.event;

            if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
              setLive(runtime, { activity: `Using ${event.content_block.name}` });
            }

            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              runtime.live = {
                ...runtime.live,
                activity: null,
                streamingText: runtime.live.streamingText + event.delta.text,
              };
              publish(runtime, { _tag: "Delta", text: event.delta.text });
            }

            return;
          }

          const text = textOf(message.message.content);
          if (text !== "") yield* record(runtime, botId, "assistant", text);

          setLive(runtime, { streamingText: "" });
        });

      const startSession = (bot: StoredBot, runtime: BotRuntime) =>
        Effect.gen(function* () {
          const prompts = yield* Queue.unbounded<SDKUserMessage>();
          const session = query({
            prompt: Stream.toAsyncIterable(Stream.fromQueue(prompts)),
            options: {
              ...claudeOptions,
              cwd: bot.workingDirectory,
              env: { ...claudeOptions.env, ...makeBrowserEnvironment(bot) },
              model: bot.model,
              settingSources: ["user", "project", "local"],
              systemPrompt: { type: "preset", preset: "claude_code", append: systemPromptFor(bot) },
              includePartialMessages: true,
              // The bot can edit its own files. Other risky tools go to the operator through canUseTool.
              permissionMode: "acceptEdits",
              canUseTool: canUseToolFor(runtime),
              mcpServers: { clots: handoffServerFor(runtime) },
              // The thread has no question dialog. The bot asks in plain text.
              disallowedTools: ["AskUserQuestion"],
              ...(bot.sdkSessionId === null ? {} : { resume: bot.sdkSessionId }),
            },
          });
          runtime.session = { prompts, query: session };

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
            Effect.forkIn(scope),
          );

          return runtime.session;
        });

      return BotSessions.of({
        statusChanges,
        live: (botId) => runtimeFor(botId).live,
        events: (botId) => runtimeFor(botId).events,

        send: (bot, role, text) =>
          Effect.gen(function* () {
            const runtime = runtimeFor(bot.id);
            yield* record(runtime, bot.id, role, text);
            setLive(runtime, { status: statusWhileRunning(runtime) });

            const session = runtime.session ?? (yield* startSession(bot, runtime));
            Queue.offerUnsafe(session.prompts, {
              type: "user",
              message: { role: "user", content: text },
              parent_tool_use_id: null,
            } as SDKUserMessage);
          }),

        interrupt: (botId) =>
          Effect.promise(async () => {
            await runtimeFor(botId).session?.query.interrupt();
          }),

        setModel: (botId, model) =>
          Effect.promise(async () => {
            await runtimeFor(botId).session?.query.setModel(model);
          }),

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
