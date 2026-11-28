import {
  ClotsRpcs,
  RPC_PATH,
  type ApprovalDecision,
  type Bot,
  type BotId,
  type BotModel,
  type BotSummary,
  type BrowserAction,
  type LoginDecision,
  type LoginSource,
  type Project,
  type Upload,
  type RoutinePlace,
  type Schedule,
  type Skill,
  type UpdateInfo,
  type Account,
  type MessageHit,
  type BotSkill,
  type RemoteAccess,
} from "@clots/contracts";
import {
  Cause,
  Context,
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Schedule as RetrySchedule,
  Stream,
} from "effect";
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
  /** Counts the operator as a viewer of the bot's conversation until the returned function runs. A viewed bot does not turn unread. */
  viewBot(botId: BotId): () => void;
  schedules(botId: BotId): Store<ReadonlyArray<Schedule>>;
  skills(botId: BotId): Store<ReadonlyArray<Skill>>;
  /** Follows the skills that only this bot has, from its files. It holds `null` until the first list arrives. */
  botSkills(botId: BotId): Store<ReadonlyArray<BotSkill> | null>;
  /** Adds one of the bot's own skills, or changes the skill that had `previousName`. It fails with an `InvalidSkill` that says why. */
  saveBotSkill(botId: BotId, skill: BotSkill, previousName?: string): Promise<void>;
  deleteBotSkill(botId: BotId, name: string): Promise<void>;
  createBot(
    bot: Pick<Bot, "name" | "instructions" | "color" | "shape"> &
      Partial<Pick<Bot, "projectId">> & { readonly skills?: ReadonlyArray<BotSkill> },
  ): Promise<Bot>;
  updateBot(
    botId: BotId,
    changes: Partial<Pick<Bot, "name" | "instructions" | "color" | "shape">>,
  ): Promise<void>;
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
  /** Creates a project. `directory` is an optional path on the host. */
  createProject(name: string, directory: string | null): Promise<Project>;
  renameProject(projectId: string, name: string): Promise<void>;
  /** Deletes a project. Its bots move to no project. */
  deleteProject(projectId: string): Promise<void>;
  setBotProject(botId: BotId, projectId: string | null): Promise<void>;
  /** Sends the operator's message. `messageId` is the id that the stored copy gets, so the thread can match it to the message it shows while sending. */
  sendMessage(
    botId: BotId,
    messageId: string,
    text: string,
    attachments?: ReadonlyArray<Upload>,
  ): Promise<void>;
  interruptBot(botId: BotId): Promise<void>;
  stopTask(botId: BotId, taskId: string): Promise<void>;
  resolveApproval(botId: BotId, approvalId: string, decision: ApprovalDecision): Promise<void>;
  resolveHandoff(botId: BotId, handoffId: string): Promise<void>;
  /** Lists the other bots of the bot's project that are logged in on the site of a page, latest first. */
  findLogins(botId: BotId, url: string): Promise<ReadonlyArray<LoginSource>>;
  /** Copies another bot's login on the site of a page into the bot's browser. It fails with a `LoginCopyFailed` that says why. */
  copyLogin(botId: BotId, fromBotId: BotId, url: string): Promise<void>;
  resolveLoginRequest(botId: BotId, requestId: string, decision: LoginDecision): Promise<void>;
  /** Adds a routine. With "clone", a clone of the bot runs it in its own thread. */
  createSchedule(
    botId: BotId,
    cron: string,
    prompt: string,
    place: RoutinePlace,
  ): Promise<Schedule>;
  /** Changes a routine. A move to "clone" makes a new clone that runs it. */
  updateSchedule(id: string, cron: string, prompt: string, place: RoutinePlace): Promise<void>;
  setSchedulePaused(id: string, paused: boolean): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
  getUpdateInfo(): Promise<UpdateInfo>;
  getAccount(): Promise<Account>;
  /** Follows how other devices reach the server over Tailscale. It holds `null` until the first state arrives. */
  readonly remoteAccess: Store<RemoteAccess | null>;
  /** Puts the server on the tailnet or takes it off. The server keeps the choice. */
  setRemoteAccess(enabled: boolean): Promise<void>;
  searchMessages(query: string, limit: number): Promise<ReadonlyArray<MessageHit>>;
  /** Starts every open server stream again from where it is. A stream can stop without an error, for example after the computer sleeps. */
  resubscribe(): void;
  /** Installs the latest release on the server, which then restarts. */
  updateServer(): Promise<void>;
  dispose(): Promise<void>;
}

class Rpc extends Context.Service<
  Rpc,
  RpcClient.FromGroup<typeof ClotsRpcs, RpcClientError.RpcClientError>
>()("clots/client-runtime/Rpc") {
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

  /** Holds a restart for each stream that a view observes now. */
  const openStreams = new Set<() => void>();

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
      const follow = Effect.service(Rpc).pipe(
        Effect.flatMap((rpc) =>
          Stream.suspend(() => subscribe(rpc, store.get())).pipe(
            Stream.runForEach((value) =>
              Effect.sync(() => set((current) => apply(current, value))),
            ),
          ),
        ),
        // A stop or a restart interrupts the stream, and the connection state already shows a lost server. Only another failure is worth a warning.
        Effect.tapCause((cause) =>
          Cause.hasInterruptsOnly(cause) || connection.get() !== "connected"
            ? Effect.void
            : Effect.logWarning("A server stream failed. It subscribes again.", cause),
        ),
        Effect.ignore,
        Effect.repeat(RetrySchedule.spaced("1 second")),
      );
      let fiber = runtime.runFork(follow);

      /** Restarts the stream. The old stream ends before the new one starts, so an old event cannot arrive after a new one. */
      const restart = () => {
        const previous = fiber;
        fiber = runtime.runFork(Fiber.interrupt(previous).pipe(Effect.andThen(follow)));
      };
      openStreams.add(restart);

      return () => {
        openStreams.delete(restart);
        void runtime.runFork(Fiber.interrupt(fiber));
      };
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

  const remoteAccess = makeStreamStore<RemoteAccess | null, RemoteAccess>(
    null,
    (rpc) => rpc.WatchRemoteAccess(),
    (_, state) => state,
  );

  const threads = new Map<BotId, Store<ThreadState>>();
  const schedules = new Map<BotId, Store<ReadonlyArray<Schedule>>>();
  const skills = new Map<BotId, Store<ReadonlyArray<Skill>>>();
  const botSkills = new Map<BotId, Store<ReadonlyArray<BotSkill> | null>>();

  return {
    connection,
    bots,
    projects,

    thread: (botId) => {
      const existing = threads.get(botId);
      if (existing !== undefined) {
        return existing;
      }

      const store = makeStreamStore(
        emptyThread,
        (rpc, current) =>
          Stream.concat(
            Stream.succeed({ _tag: "Subscribed" } as const),
            rpc.SubscribeThread({ botId, afterSequence: current.lastSequence }),
          ),
        applyThreadEvent,
      );
      threads.set(botId, store);

      return store;
    },

    viewBot: (botId) => {
      // A dropped connection ends the view, so the client views the bot again.
      const fiber = runtime.runFork(
        Effect.service(Rpc).pipe(
          Effect.flatMap((rpc) => Stream.runDrain(rpc.ViewBot({ botId }))),
          Effect.ignore,
          Effect.repeat(RetrySchedule.spaced("1 second")),
        ),
      );

      return () => void runtime.runFork(Fiber.interrupt(fiber));
    },

    schedules: (botId) => {
      const existing = schedules.get(botId);
      if (existing !== undefined) {
        return existing;
      }

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
      if (existing !== undefined) {
        return existing;
      }

      const store = makeStreamStore<ReadonlyArray<Skill>, ReadonlyArray<Skill>>(
        [],
        (rpc) => rpc.WatchSkills({ botId }),
        (_, list) => list,
      );
      skills.set(botId, store);

      return store;
    },

    botSkills: (botId) => {
      const existing = botSkills.get(botId);
      if (existing !== undefined) {
        return existing;
      }

      const store = makeStreamStore<ReadonlyArray<BotSkill> | null, ReadonlyArray<BotSkill>>(
        null,
        (rpc) => rpc.WatchBotSkills({ botId }),
        (_, list) => list,
      );
      botSkills.set(botId, store);

      return store;
    },

    saveBotSkill: (botId, skill, previousName) =>
      call((rpc) =>
        rpc.SaveBotSkill({ botId, skill, ...(previousName === undefined ? {} : { previousName }) }),
      ),
    deleteBotSkill: (botId, name) => call((rpc) => rpc.DeleteBotSkill({ botId, name })),

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
      call((rpc) =>
        rpc.NavigateBrowser({ botId, action, ...(target === undefined ? {} : { target }) }),
      ),
    duplicateBot: (botId) => call((rpc) => rpc.DuplicateBot({ botId })),
    deleteBot: (botId) => call((rpc) => rpc.DeleteBot({ botId })),
    sendMessage: (botId, messageId, text, attachments = []) =>
      call((rpc) => rpc.SendMessage({ botId, messageId, text, attachments })),
    interruptBot: (botId) => call((rpc) => rpc.InterruptBot({ botId })),
    stopTask: (botId, taskId) => call((rpc) => rpc.StopTask({ botId, taskId })),
    resolveApproval: (botId, approvalId, decision) =>
      call((rpc) => rpc.ResolveApproval({ botId, approvalId, decision })),
    resolveHandoff: (botId, handoffId) => call((rpc) => rpc.ResolveHandoff({ botId, handoffId })),
    findLogins: (botId, url) => call((rpc) => rpc.FindLogins({ botId, url })),
    copyLogin: (botId, fromBotId, url) => call((rpc) => rpc.CopyLogin({ botId, fromBotId, url })),
    resolveLoginRequest: (botId, requestId, decision) =>
      call((rpc) => rpc.ResolveLoginRequest({ botId, requestId, decision })),
    createSchedule: (botId, cron, prompt, place) =>
      call((rpc) => rpc.CreateSchedule({ botId, cron, prompt, place })),
    updateSchedule: (id, cron, prompt, place) =>
      call((rpc) => rpc.UpdateSchedule({ id, cron, prompt, place })),
    setSchedulePaused: (id, paused) => call((rpc) => rpc.SetSchedulePaused({ id, paused })),
    deleteSchedule: (id) => call((rpc) => rpc.DeleteSchedule({ id })),
    getUpdateInfo: () => call((rpc) => rpc.GetUpdateInfo()),
    getAccount: () => call((rpc) => rpc.GetAccount()),
    remoteAccess,
    // The answer holds the new state, so the store shows it before the next report of the stream.
    setRemoteAccess: (enabled) =>
      call((rpc) => rpc.SetRemoteAccess({ enabled })).then((state) =>
        remoteAccess.set(() => state),
      ),
    searchMessages: (query, limit) => call((rpc) => rpc.SearchMessages({ query, limit })),
    resubscribe: () => {
      for (const restart of openStreams) {
        restart();
      }
    },
    updateServer: () => call((rpc) => rpc.UpdateServer()),
    dispose: () => runtime.dispose(),
  };
};
