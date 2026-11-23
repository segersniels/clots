import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

import {
  ApprovalDecision,
  Bot,
  BotColor,
  BotId,
  BotShape,
  BotModel,
  BotSummary,
  Schedule,
  ThreadEvent,
} from "./domain.ts";

/** The path of the RPC WebSocket on the clots server. */
export const RPC_PATH = "/rpc";

/** The path prefix of a bot's browser stream WebSocket: `/browser/<botId>`. */
export const BROWSER_STREAM_PATH = "/browser";

export class BotNotFound extends Schema.TaggedError<BotNotFound>()("BotNotFound", {
  botId: BotId,
}) {}

export class InvalidCron extends Schema.TaggedError<InvalidCron>()("InvalidCron", {
  cron: Schema.String,
}) {}

export class ClotsRpcs extends RpcGroup.make(
  Rpc.make("WatchBots", { success: Schema.Array(BotSummary), stream: true }),
  Rpc.make("CreateBot", {
    payload: { name: Schema.String, instructions: Schema.String, color: BotColor, shape: BotShape },
    success: Bot,
  }),
  /** Changes the model of a bot. A running session switches at once. */
  Rpc.make("SetBotModel", {
    payload: { botId: BotId, model: BotModel },
    error: BotNotFound,
  }),

  /** Replays the stored messages after `afterSequence`, then sends live events. */
  Rpc.make("SubscribeThread", {
    payload: { botId: BotId, afterSequence: Schema.Number },
    success: ThreadEvent,
    error: BotNotFound,
    stream: true,
  }),
  Rpc.make("SendMessage", {
    payload: { botId: BotId, text: Schema.String },
    error: BotNotFound,
  }),
  Rpc.make("InterruptBot", { payload: { botId: BotId }, error: BotNotFound }),
  Rpc.make("ResolveApproval", {
    payload: { botId: BotId, approvalId: Schema.String, decision: ApprovalDecision },
    error: BotNotFound,
  }),
  Rpc.make("ResolveHandoff", {
    payload: { botId: BotId, handoffId: Schema.String },
    error: BotNotFound,
  }),

  Rpc.make("WatchSchedules", {
    payload: { botId: BotId },
    success: Schema.Array(Schedule),
    stream: true,
  }),
  Rpc.make("CreateSchedule", {
    payload: { botId: BotId, cron: Schema.String, prompt: Schema.String },
    success: Schedule,
    error: Schema.Union([BotNotFound, InvalidCron]),
  }),
  Rpc.make("SetSchedulePaused", { payload: { id: Schema.String, paused: Schema.Boolean } }),
  Rpc.make("DeleteSchedule", { payload: { id: Schema.String } }),
) {}
