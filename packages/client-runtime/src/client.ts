import {
  ClotsRpcs,
  RPC_PATH,
  type ApprovalDecision,
  type Bot,
  type BotId,
  type BotModel,
  type BotSummary,
  type Schedule,
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
  thread(botId: BotId): Store<ThreadState>;
  schedules(botId: BotId): Store<ReadonlyArray<Schedule>>;
  createBot(bot: Pick<Bot, "name" | "instructions" | "color" | "shape">): Promise<Bot>;
  setBotModel(botId: BotId, model: BotModel): Promise<void>;
  sendMessage(botId: BotId, text: string): Promise<void>;
  interruptBot(botId: BotId): Promise<void>;
  resolveApproval(botId: BotId, approvalId: string, decision: ApprovalDecision): Promise<void>;
  resolveHandoff(botId: BotId, handoffId: string): Promise<void>;
  createSchedule(botId: BotId, cron: string, prompt: string): Promise<Schedule>;
  setSchedulePaused(id: string, paused: boolean): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
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

  const threads = new Map<BotId, Store<ThreadState>>();
  const schedules = new Map<BotId, Store<ReadonlyArray<Schedule>>>();

  return {
    connection,
    bots,

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

    createBot: (bot) => call((rpc) => rpc.CreateBot(bot)),
    setBotModel: (botId, model) => call((rpc) => rpc.SetBotModel({ botId, model })),
    sendMessage: (botId, text) => call((rpc) => rpc.SendMessage({ botId, text })),
    interruptBot: (botId) => call((rpc) => rpc.InterruptBot({ botId })),
    resolveApproval: (botId, approvalId, decision) =>
      call((rpc) => rpc.ResolveApproval({ botId, approvalId, decision })),
    resolveHandoff: (botId, handoffId) => call((rpc) => rpc.ResolveHandoff({ botId, handoffId })),
    createSchedule: (botId, cron, prompt) => call((rpc) => rpc.CreateSchedule({ botId, cron, prompt })),
    setSchedulePaused: (id, paused) => call((rpc) => rpc.SetSchedulePaused({ id, paused })),
    deleteSchedule: (id) => call((rpc) => rpc.DeleteSchedule({ id })),
    dispose: () => runtime.dispose(),
  };
};
