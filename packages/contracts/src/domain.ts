import { Schema } from "effect";

export const BotId = Schema.String.pipe(Schema.brand("BotId"));
export type BotId = typeof BotId.Type;

/** States what a bot does now. `waiting` means that it needs the operator (an approval or a handoff). */
export const BotStatus = Schema.Literals(["idle", "working", "waiting"]);
export type BotStatus = typeof BotStatus.Type;

/** The colors that a bot picture can have. */
export const BotColor = Schema.Literals([
  "brown", "red", "orange", "amber", "green", "teal", "blue", "purple", "pink", "gray",
]);
export type BotColor = typeof BotColor.Type;

/** The outlines that a bot picture can have. */
export const BotShape = Schema.Literals([
  "circle", "oval", "square", "pill", "triangle", "hexagon", "cloud", "drop",
]);
export type BotShape = typeof BotShape.Type;

/**
 * The model classes that a bot can use. Each one is a Claude Code alias, so Claude Code picks the
 * newest model of that class that the account can use.
 */
export const BotModel = Schema.Literals(["haiku", "sonnet", "opus", "fable"]);
export type BotModel = typeof BotModel.Type;

export const Bot = Schema.Struct({
  id: BotId,
  name: Schema.String,
  instructions: Schema.String,
  color: BotColor,
  shape: BotShape,
  model: BotModel,
  createdAt: Schema.Number,
});
export type Bot = typeof Bot.Type;

/** A bot plus the live fields that the bot list shows. */
export const BotSummary = Schema.Struct({
  ...Bot.fields,
  status: BotStatus,
  statusLine: Schema.String,
  lastMessageAt: Schema.NullOr(Schema.Number),
});
export type BotSummary = typeof BotSummary.Type;

/** `routine` marks a prompt that a schedule sent, not the operator. */
export const MessageRole = Schema.Literals(["user", "assistant", "routine"]);
export type MessageRole = typeof MessageRole.Type;

export const Message = Schema.Struct({
  id: Schema.String,
  botId: BotId,
  sequence: Schema.Number,
  role: MessageRole,
  text: Schema.String,
  createdAt: Schema.Number,
});
export type Message = typeof Message.Type;

/** A tool call that waits for the operator's decision. */
export const PendingApproval = Schema.Struct({
  id: Schema.String,
  toolName: Schema.String,
  input: Schema.String,
  canAllowAlways: Schema.Boolean,
});
export type PendingApproval = typeof PendingApproval.Type;

export const ApprovalDecision = Schema.Literals(["allow", "allowAlways", "deny"]);
export type ApprovalDecision = typeof ApprovalDecision.Type;

/** A request from the bot for the operator to take over its browser. */
export const Handoff = Schema.Struct({
  id: Schema.String,
  reason: Schema.String,
});
export type Handoff = typeof Handoff.Type;

/** The live thread state that the server does not store. A client replaces its copy on each one. */
export const ThreadLiveState = Schema.Struct({
  status: BotStatus,
  activity: Schema.NullOr(Schema.String),
  streamingText: Schema.String,
  approvals: Schema.Array(PendingApproval),
  handoff: Schema.NullOr(Handoff),
});
export type ThreadLiveState = typeof ThreadLiveState.Type;

export const ThreadEvent = Schema.Union([
  Schema.TaggedStruct("Message", { message: Message }),
  Schema.TaggedStruct("Delta", { text: Schema.String }),
  Schema.TaggedStruct("Live", { state: ThreadLiveState }),
]);
export type ThreadEvent = typeof ThreadEvent.Type;

export const Schedule = Schema.Struct({
  id: Schema.String,
  botId: BotId,
  cron: Schema.String,
  prompt: Schema.String,
  paused: Schema.Boolean,
  nextRunAt: Schema.Number,
});
export type Schedule = typeof Schedule.Type;
