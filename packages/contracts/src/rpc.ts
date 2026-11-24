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
  Project,
  Schedule,
  Skill,
  ThreadEvent,
  Upload,
} from "./domain.ts";

/** The path of the RPC WebSocket on the clots server. */
export const RPC_PATH = "/rpc";

/** The path prefix of an attachment's bytes: `/attachments/<botId>/<attachmentId>`. */
export const ATTACHMENTS_PATH = "/attachments";

/** The path prefix of a bot's browser stream WebSocket: `/browser/<botId>`. */
export const BROWSER_STREAM_PATH = "/browser";

export class BotNotFound extends Schema.TaggedError<BotNotFound>()("BotNotFound", {
  botId: BotId,
}) {}

export class InvalidCron extends Schema.TaggedError<InvalidCron>()("InvalidCron", {
  cron: Schema.String,
}) {}

export class UpdateFailed extends Schema.TaggedError<UpdateFailed>()("UpdateFailed", {
  message: Schema.String,
}) {}

/** The server's version and the latest release. A client compares the desktop app's version with `latest` itself. */
export const UpdateInfo = Schema.Struct({
  current: Schema.String,
  latest: Schema.optional(Schema.Struct({ version: Schema.String, url: Schema.String })),
  /** The server can install the latest release itself: it is older and runs as an installed service. */
  serverUpdate: Schema.Boolean,
});
export type UpdateInfo = typeof UpdateInfo.Type;

/** One usage limit of the Claude plan: the 5-hour session, the week, or the week of one model. */
export const UsageWindow = Schema.Struct({
  kind: Schema.Literals(["session", "weekly", "model"]),
  /** The model's name for a `model` window, such as "Fable". */
  model: Schema.NullOr(Schema.String),
  /** The part of the limit that is used, 0 to 100. */
  percent: Schema.Number,
  resetsAt: Schema.NullOr(Schema.Number),
  /** Claude marks the window as close to its limit. */
  critical: Schema.Boolean,
});
export type UsageWindow = typeof UsageWindow.Type;

/** The Claude login of the server, which every bot shares, and the usage limits of its plan. */
export const Account = Schema.Struct({
  /** The person's name from the Claude profile, if Claude Code has one. */
  name: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  /** The plan for people, such as "Ultra". */
  plan: Schema.String,
  /** The usage limits, or `null` when Claude Code could not tell them. */
  usage: Schema.NullOr(Schema.Array(UsageWindow)),
  /** When the server last asked Claude Code. */
  checkedAt: Schema.Number,
});
export type Account = typeof Account.Type;

export class ProjectDirectoryNotFound extends Schema.TaggedError<ProjectDirectoryNotFound>()(
  "ProjectDirectoryNotFound",
  { directory: Schema.String },
) {}

/**
 * A navigation from the take-over toolbar. `open` takes a URL as its target, `tab` and `closeTab` a
 * tab id from the stream, and `stop` the target id of the page that loads. `newTab` takes none.
 */
export const BrowserAction = Schema.Literals(["back", "forward", "reload", "stop", "open", "tab", "newTab", "closeTab"]);
export type BrowserAction = typeof BrowserAction.Type;

export class ClotsRpcs extends RpcGroup.make(
  Rpc.make("WatchBots", { success: Schema.Array(BotSummary), stream: true }),
  /** Creates a bot in a project, or in no project when `projectId` is left out or `null`. */
  Rpc.make("CreateBot", {
    payload: {
      name: Schema.String,
      instructions: Schema.String,
      color: BotColor,
      shape: BotShape,
      projectId: Schema.optional(Schema.NullOr(Schema.String)),
    },
    success: Bot,
  }),
  /**
   * Changes the given fields of a bot and leaves the others. A running session gets a new name or
   * new instructions with the next message, after it finishes its current work.
   */
  Rpc.make("UpdateBot", {
    payload: {
      botId: BotId,
      name: Schema.optional(Schema.String),
      instructions: Schema.optional(Schema.String),
      color: Schema.optional(BotColor),
      shape: Schema.optional(BotShape),
    },
    error: BotNotFound,
  }),

  /** Closes the bot's browser. Its logins stay in the profile, and the bot opens the browser again when it needs it. */
  Rpc.make("StopBrowser", { payload: { botId: BotId }, error: BotNotFound }),

  /** Navigates the bot's browser, as the buttons and the address bar of a browser do. */
  Rpc.make("NavigateBrowser", {
    payload: { botId: BotId, action: BrowserAction, target: Schema.optional(Schema.String) },
    error: BotNotFound,
  }),

  /** Puts the bots of one sidebar group in the given order. */
  Rpc.make("ReorderBots", { payload: { botIds: Schema.Array(BotId) } }),

  Rpc.make("SetBotUnread", {
    payload: { botId: BotId, unread: Schema.Boolean },
    error: BotNotFound,
  }),

  /** Creates a bot with the settings of another bot. The copy starts with an empty thread and no notes. */
  Rpc.make("DuplicateBot", {
    payload: { botId: BotId },
    success: Bot,
    error: BotNotFound,
  }),

  /** Stops the bot and deletes it with its thread, routines and notes directory. */
  Rpc.make("DeleteBot", {
    payload: { botId: BotId },
    error: BotNotFound,
  }),

  /** Compacts the bot's conversation, as `/compact` does in Claude Code. */
  Rpc.make("CompactBot", {
    payload: { botId: BotId },
    error: BotNotFound,
  }),

  /** Changes the model of a bot. A running session switches at once. */
  Rpc.make("SetBotModel", {
    payload: { botId: BotId, model: BotModel },
    error: BotNotFound,
  }),

  Rpc.make("WatchProjects", { success: Schema.Array(Project), stream: true }),
  Rpc.make("CreateProject", {
    payload: { name: Schema.String, directory: Schema.NullOr(Schema.String) },
    success: Project,
    error: ProjectDirectoryNotFound,
  }),

  Rpc.make("RenameProject", { payload: { projectId: Schema.String, name: Schema.String } }),

  /** Deletes a project. Its bots move to no project and keep their threads. The directory on the host stays. */
  Rpc.make("DeleteProject", { payload: { projectId: Schema.String } }),

  /** Moves a bot and its clones to a project, or to no project. They then start new sessions in the new directory. */
  Rpc.make("SetBotProject", {
    payload: { botId: BotId, projectId: Schema.NullOr(Schema.String) },
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
    payload: { botId: BotId, text: Schema.String, attachments: Schema.Array(Upload) },
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

  /** The skills that the bot can start with `/name`, as its last session reported them. */
  Rpc.make("WatchSkills", {
    payload: { botId: BotId },
    success: Schema.Array(Skill),
    stream: true,
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
  /** Changes the schedule and the prompt of a routine. The next run follows from the new schedule. */
  Rpc.make("UpdateSchedule", {
    payload: { id: Schema.String, cron: Schema.String, prompt: Schema.String },
    error: InvalidCron,
  }),
  Rpc.make("SetSchedulePaused", { payload: { id: Schema.String, paused: Schema.Boolean } }),
  Rpc.make("DeleteSchedule", { payload: { id: Schema.String } }),
  Rpc.make("GetUpdateInfo", { success: UpdateInfo }),
  Rpc.make("GetAccount", { success: Account }),
  /** Installs the latest release and restarts the server. The connection drops, and the client connects again. */
  Rpc.make("UpdateServer", { error: UpdateFailed }),
) {}
