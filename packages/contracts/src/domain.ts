import { CHARACTER_COLORS, CHARACTER_SHAPES } from "@clots/character/traits";
import { Schema } from "effect";

export const BotId = Schema.String.pipe(Schema.brand("BotId"));
export type BotId = typeof BotId.Type;

/** States what a bot does now. `waiting` means that it needs the operator (an approval or a handoff). */
export const BotStatus = Schema.Literals(["idle", "working", "waiting"]);
export type BotStatus = typeof BotStatus.Type;

/** The colors that a bot character can have. */
export const BotColor = Schema.Literals(CHARACTER_COLORS);
export type BotColor = typeof BotColor.Type;

/** The shapes that a bot character can have. */
export const BotShape = Schema.Literals(CHARACTER_SHAPES);
export type BotShape = typeof BotShape.Type;

/**
 * The model classes that a bot can use. Each one is a Claude Code alias, so Claude Code picks the
 * newest model of that class that the account can use.
 */
export const BotModel = Schema.Literals(["haiku", "sonnet", "opus", "fable"]);
export type BotModel = typeof BotModel.Type;

/**
 * A group of bots. A project can point at a directory on the host, for example a repository.
 * A bot of that project then works in that directory.
 */
export const Project = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  directory: Schema.NullOr(Schema.String),
});
export type Project = typeof Project.Type;

export const Bot = Schema.Struct({
  id: BotId,
  name: Schema.String,
  instructions: Schema.String,
  color: BotColor,
  shape: BotShape,
  model: BotModel,
  projectId: Schema.NullOr(Schema.String),
  /** The bot that made this bot as a clone, or `null` for a bot that the operator made. Only a clone can be deleted by a bot. */
  clonedFrom: Schema.NullOr(BotId),
  createdAt: Schema.Number,
});
export type Bot = typeof Bot.Type;

/** A bot plus the live fields that the bot list shows. */
export const BotSummary = Schema.Struct({
  ...Bot.fields,
  status: BotStatus,
  statusLine: Schema.String,
  lastMessageAt: Schema.NullOr(Schema.Number),
  /** The operator marked the bot as unread. The mark goes away when the operator opens the bot. */
  unread: Schema.Boolean,
});
export type BotSummary = typeof BotSummary.Type;

/** `routine` marks a prompt that a schedule sent, not the operator. */
/**
 * A `trace` message keeps the tool calls that the bot made between two of its messages. A `bot`
 * message comes from another bot through the `send_bot_message` tool.
 */
export const MessageRole = Schema.Literals(["user", "assistant", "routine", "trace", "bot"]);
export type MessageRole = typeof MessageRole.Type;

/** A file that the operator sent with a message. The server keeps the bytes. */
export const Attachment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mediaType: Schema.String,
  size: Schema.Number,
});
export type Attachment = typeof Attachment.Type;

/** The largest file that a message can carry. The composer leaves out a larger one, and the server rejects it. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Counts the bytes that a base64 text holds: 3 for every 4 characters, less one for each `=` of padding. */
const base64Bytes = (data: string) => Math.floor((data.length * 3) / 4) - (data.length - data.replace(/=+$/, "").length);

/** A file on its way to the server, with its bytes as base64. */
export const Upload = Schema.Struct({
  name: Schema.String,
  mediaType: Schema.String,
  // The check runs when the server decodes a request, so a larger file never reaches the server's code.
  data: Schema.String.check(Schema.makeFilter((data: string) => base64Bytes(data) <= MAX_UPLOAD_BYTES)),
});
export type Upload = typeof Upload.Type;

/**
 * A cookie of a site that the operator signed in to on their own machine. The server loads it into
 * the bot's browser, so the bot is signed in too. `expires` is in seconds, and -1 marks a session cookie.
 */
export const BrowserCookie = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
  domain: Schema.String,
  path: Schema.String,
  expires: Schema.Number,
  httpOnly: Schema.Boolean,
  secure: Schema.Boolean,
  sameSite: Schema.optional(Schema.Literals(["Strict", "Lax", "None"])),
});
export type BrowserCookie = typeof BrowserCookie.Type;

/** One tool call of the running turn, as the thread shows it. */
export const TraceStep = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.Literals(["running", "done"]),
});
export type TraceStep = typeof TraceStep.Type;

export const Message = Schema.Struct({
  id: Schema.String,
  botId: BotId,
  sequence: Schema.Number,
  role: MessageRole,
  text: Schema.String,
  attachments: Schema.Array(Attachment),
  /** The tool calls of a `trace` message. Other messages have none. */
  steps: Schema.Array(TraceStep),
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

/** A task that runs in the background of a bot's session, such as a subagent. */
export const BackgroundTask = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
});
export type BackgroundTask = typeof BackgroundTask.Type;

/** The live thread state that the server does not store. A client replaces its copy on each one. */
export const ThreadLiveState = Schema.Struct({
  status: BotStatus,
  /** The tool calls of the running turn. The list is empty between turns. */
  steps: Schema.Array(TraceStep),
  approvals: Schema.Array(PendingApproval),
  handoff: Schema.NullOr(Handoff),
  /** The work that runs in the background. It can outlive the turn that started it. */
  tasks: Schema.Array(BackgroundTask),
});
export type ThreadLiveState = typeof ThreadLiveState.Type;

export const ThreadEvent = Schema.Union([
  Schema.TaggedStruct("Message", { message: Message }),
  Schema.TaggedStruct("Live", { state: ThreadLiveState }),
]);
export type ThreadEvent = typeof ThreadEvent.Type;

/** A skill or custom command that the operator can start in a message with `/name`. */
export const Skill = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
});
export type Skill = typeof Skill.Type;

export const Schedule = Schema.Struct({
  id: Schema.String,
  botId: BotId,
  cron: Schema.String,
  prompt: Schema.String,
  paused: Schema.Boolean,
  nextRunAt: Schema.Number,
});
export type Schedule = typeof Schedule.Type;
