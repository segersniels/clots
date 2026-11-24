import {
  ClotsRpcs,
  RPC_PATH,
  type ApprovalDecision,
  type Bot,
  type BotId,
  type BotModel,
  type BotSummary,
  type BrowserAction,
  type Project,
  type Upload,
  type Schedule,
  type Skill,
  type UpdateInfo,
  type Account,
} from "@clots/contracts";
import { Context, Effect, Fiber, Layer, ManagedRuntime, Schedule as RetrySchedule, Stream } from "effect";
import { RpcClient, RpcClientError, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";

import { makeStore, type Store } from "./store.ts";
import { applyThreadEvent, emptyThread, type ThreadState } from "./thread.ts";

export type ConnectionState = "connecting" | "connected" | "disconnected";

export interface ClotsClient {
  readonly connection: Store<ConnectionState>;
  readonly bots: Store<ReadonlyArray<BotSummary>>;
  readonly projects: Store<ReadonlyArray<Project>>;
  thread(botId: BotId): Store<ThreadState>;
  schedules(botId: BotId): Store<ReadonlyArray<Schedule>>;
  skills(botId: BotId): Store<ReadonlyArray<Skill>>;
  createBot(bot: Pick<Bot, "name" | "instructions" | "color" | "shape"> & Partial<Pick<Bot, "projectId">>): Promise<Bot>;
  updateBot(botId: BotId, changes: Partial<Pick<Bot, "name" | "instructions" | "color" | "shape">>): Promise<void>;
  setBotModel(botId: BotId, model: BotModel): Promise<void>;
  setBotUnread(botId: BotId, unread: boolean): Promise<void>;
  /** Puts the bots of one sidebar group in this order. */
  reorderBots(botIds: ReadonlyArray<BotId>): Promise<void>;
  /** Closes the bot's browser. The bot opens it again when it needs it. */
  stopBrowser(botId: BotId): Promise<void>;
  /** Navigates the bot's browser. `open` takes a URL, `tab` a tab id and `stop` a page's target id. */
  navigateBrowser(botId: BotId, action: BrowserAction, target?: string): Promise<void>;
  duplicateBot(botId: BotId): Promise<Bot>;
  deleteBot(botId: BotId): Promise<void>;
  compactBot(botId: BotId): Promise<void>;
  /** Creates a project. `directory` is an optional path on the host. */
  createProject(name: string, directory: string | null): Promise<Project>;
  renameProject(projectId: string, name: string): Promise<void>;
  /** Deletes a project. Its bots move to no project. */
  deleteProject(projectId: string): Promise<void>;
  setBotProject(botId: BotId, projectId: string | null): Promise<void>;
  sendMessage(botId: BotId, text: string, attachments?: ReadonlyArray<Upload>): Promise<void>;
  interruptBot(botId: BotId): Promise<void>;
  resolveApproval(botId: BotId, approvalId: string, decision: ApprovalDecision): Promise<void>;
  resolveHandoff(botId: BotId, handoffId: string): Promise<void>;
  createSchedule(botId: BotId, cron: string, prompt: string): Promise<Schedule>;
  updateSchedule(id: string, cron: string, prompt: string): Promise<void>;
  setSchedulePaused(id: string, paused: boolean): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  getUpdateInfo(): Promise<UpdateInfo>;
  getAccount(): Promise<Account>;
  /** Installs the latest release on the server, which then restarts. */
  updateServer(): Promise<void>;
  dispose(): Promise<void>;
}

class Rpc extends Context.Service<Rpc, RpcClient.FromGroup<typeof ClotsRpcs, RpcClientError.RpcClientError>>()(
  "clots/client-runtime/Rpc",
) {
  static readonly layer = Layer.effect(Rpc, RpcClient.make(ClotsRpcs));
}

type RpcService = Rpc["Service"];

/**
 * Connects to a clots server. `origin` is the HTTP origin of the server, for example
 * `https://clots.example.ts.net`. The client uses only the global `WebSocket`, so it runs in a
 * browser and in React Native.
 */
export const makeClotsClient = (origin: string): ClotsClient => {
  const connection = makeStore<ConnectionState>("connecting");
  const socketUrl = origin.replace(/^http/, "ws") + RPC_PATH;

  const hooks = Layer.succeed(RpcClient.ConnectionHooks, {
    onConnect: Effect.sync(() => connection.set(() => "connected")),
    onDisconnect: Effect.sync(() => connection.set(() => "disconnected")),
  });

  // The protocol owns the socket and opens it again after a failure.
  const protocol = RpcClient.layerProtocolSocket({ retryTransientErrors: true }).pipe(
    Layer.provide([
      Socket.layerWebSocket(socketUrl).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal)),
      RpcSerialization.layerJson,
      hooks,
    ]),
  );
  const runtime = ManagedRuntime.make(Rpc.layer.pipe(Layer.provide(protocol)));

  const call = <A, E>(use: (rpc: RpcService) => Effect.Effect<A, E>) =>
    runtime.runPromise(Effect.flatMap(Effect.service(Rpc), use));

  /**
   * Makes a store that a server stream feeds while a view observes it. A dropped connection ends
   * the stream, so the store subscribes again. `subscribe` reads the current value to resume.
   */
  const makeStreamStore = <T, A>(
    initial: T,
    subscribe: (rpc: RpcService, current: T) => Stream.Stream<A, unknown>,
    apply: (current: T, value: A) => T,
  ) => {
    const store: ReturnType<typeof makeStore<T>> = makeStore<T>(initial, (set) => {
      const fiber = runtime.runFork(
        Effect.service(Rpc).pipe(
          Effect.flatMap((rpc) =>
            Stream.suspend(() => subscribe(rpc, store.get())).pipe(
              Stream.runForEach((value) => Effect.sync(() => set((current) => apply(current, value)))),
            ),
          ),
          Effect.ignore,
          Effect.repeat(RetrySchedule.spaced("1 second")),
        ),
      );

      return () => void runtime.runFork(Fiber.interrupt(fiber));
    });

    return store;
  };

  const bots = makeStreamStore<ReadonlyArray<BotSummary>, ReadonlyArray<BotSummary>>(
    [],
    (rpc) => rpc.WatchBots(),
    (_, list) => list,
  );

  const projects = makeStreamStore<ReadonlyArray<Project>, ReadonlyArray<Project>>(
    [],
    (rpc) => rpc.WatchProjects(),
    (_, list) => list,
  );

  const threads = new Map<BotId, Store<ThreadState>>();
  const schedules = new Map<BotId, Store<ReadonlyArray<Schedule>>>();
  const skills = new Map<BotId, Store<ReadonlyArray<Skill>>>();

  return {
    connection,
    bots,
    projects,

    thread: (botId) => {
      const existing = threads.get(botId);
      if (existing !== undefined) return existing;

      const store = makeStreamStore(
        emptyThread,
        (rpc, current) => rpc.SubscribeThread({ botId, afterSequence: current.lastSequence }),
        applyThreadEvent,
      );
      threads.set(botId, store);

      return store;
    },

    schedules: (botId) => {
      const existing = schedules.get(botId);
      if (existing !== undefined) return existing;

      const store = makeStreamStore<ReadonlyArray<Schedule>, ReadonlyArray<Schedule>>(
        [],
        (rpc) => rpc.WatchSchedules({ botId }),
        (_, list) => list,
      );
      schedules.set(botId, store);

      return store;
    },

    skills: (botId) => {
      const existing = skills.get(botId);
      if (existing !== undefined) return existing;

      const store = makeStreamStore<ReadonlyArray<Skill>, ReadonlyArray<Skill>>(
        [],
        (rpc) => rpc.WatchSkills({ botId }),
        (_, list) => list,
      );
      skills.set(botId, store);

      return store;
    },

    createBot: (bot) => call((rpc) => rpc.CreateBot(bot)),
    updateBot: (botId, changes) => call((rpc) => rpc.UpdateBot({ botId, ...changes })),
    createProject: (name, directory) => call((rpc) => rpc.CreateProject({ name, directory })),
    renameProject: (projectId, name) => call((rpc) => rpc.RenameProject({ projectId, name })),
    deleteProject: (projectId) => call((rpc) => rpc.DeleteProject({ projectId })),
    setBotProject: (botId, projectId) => call((rpc) => rpc.SetBotProject({ botId, projectId })),
    setBotModel: (botId, model) => call((rpc) => rpc.SetBotModel({ botId, model })),
    setBotUnread: (botId, unread) => call((rpc) => rpc.SetBotUnread({ botId, unread })),
    reorderBots: (botIds) => call((rpc) => rpc.ReorderBots({ botIds })),
    stopBrowser: (botId) => call((rpc) => rpc.StopBrowser({ botId })),
    navigateBrowser: (botId, action, target) =>
      call((rpc) => rpc.NavigateBrowser({ botId, action, ...(target === undefined ? {} : { target }) })),
    duplicateBot: (botId) => call((rpc) => rpc.DuplicateBot({ botId })),
    deleteBot: (botId) => call((rpc) => rpc.DeleteBot({ botId })),
    compactBot: (botId) => call((rpc) => rpc.CompactBot({ botId })),
    sendMessage: (botId, text, attachments = []) => call((rpc) => rpc.SendMessage({ botId, text, attachments })),
    interruptBot: (botId) => call((rpc) => rpc.InterruptBot({ botId })),
    resolveApproval: (botId, approvalId, decision) =>
      call((rpc) => rpc.ResolveApproval({ botId, approvalId, decision })),
    resolveHandoff: (botId, handoffId) => call((rpc) => rpc.ResolveHandoff({ botId, handoffId })),
    createSchedule: (botId, cron, prompt) => call((rpc) => rpc.CreateSchedule({ botId, cron, prompt })),
    updateSchedule: (id, cron, prompt) => call((rpc) => rpc.UpdateSchedule({ id, cron, prompt })),
    setSchedulePaused: (id, paused) => call((rpc) => rpc.SetSchedulePaused({ id, paused })),
    deleteSchedule: (id) => call((rpc) => rpc.DeleteSchedule({ id })),
    getUpdateInfo: () => call((rpc) => rpc.GetUpdateInfo()),
    getAccount: () => call((rpc) => rpc.GetAccount()),
    updateServer: () => call((rpc) => rpc.UpdateServer()),
    dispose: () => runtime.dispose(),
  };
};
