import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { StoredBot } from "./BotRepository.ts";

/** The session folder size above which clots asks a bot to clean up. */
export const SESSION_FOLDER_LIMIT_KB = 2 * 1024 * 1024;

/** The growth above the remembered size that brings the line back. Small growth, such as a log, does not. */
export const WARNING_STEP_KB = 1024 * 1024;

/**
 * Builds the folder where the bot's Claude Code keeps its temporary files, such as the scratchpad.
 * The default /tmp is RAM on many Linux hosts, so a few GB from one bot made every bot fail.
 * The folder is hidden, so the bot's own Grep and Glob in its notes folder skip it.
 */
export const botTempDirectory = (bot: StoredBot) => join(bot.workingDirectory, ".tmp");

/**
 * Lists the session folders in the bot's temp folder. Claude Code puts each one in a folder for
 * the user id and then a folder named after the project path.
 */
const sessionFolders = (bot: StoredBot) => {
  const userFolder = join(botTempDirectory(bot), `claude-${process.getuid?.() ?? 0}`);
  if (!existsSync(userFolder)) {
    return [];
  }

  return readdirSync(userFolder, { withFileTypes: true })
    .filter((project) => project.isDirectory())
    .flatMap((project) =>
      readdirSync(join(userFolder, project.name), { withFileTypes: true })
        .filter((session) => session.isDirectory())
        .map((session) => ({
          sessionId: session.name,
          path: join(userFolder, project.name, session.name),
        })),
    );
};

/** Deletes the session folders of the bot, except the folder of its current session. */
export const removeOldSessionFolders = (bot: StoredBot, currentSessionId: string | null) => {
  for (const folder of sessionFolders(bot)) {
    if (folder.sessionId !== currentSessionId) {
      rmSync(folder.path, { recursive: true, force: true });
    }
  }
};

/** Measures a folder in KB with `du`, which counts the blocks that the files really use. */
const measureKb = async (path: string) => {
  const du = Bun.spawn(["du", "-sk", path], { stdout: "pipe", stderr: "ignore" });
  const output = await new Response(du.stdout).text();
  await du.exited;

  return Number.parseInt(output, 10);
};

/** Formats a size in KB as GB with one decimal. */
const formatGb = (kb: number) => `${(kb / 1024 / 1024).toFixed(1)} GB`;

/** Measures the folder of the bot's session. Returns `undefined` when the folder is missing. */
export const measureSessionFolder = async (bot: StoredBot, sessionId: string) => {
  const folder = sessionFolders(bot).find((each) => each.sessionId === sessionId);
  if (folder === undefined) {
    return undefined;
  }

  const kb = await measureKb(folder.path);

  // The bot can delete the folder while du runs.
  if (Number.isNaN(kb)) {
    return undefined;
  }

  return { path: folder.path, kb };
};

/**
 * Decides whether a measured size gets a new warning, and returns the size to remember: the
 * smallest size since the last warning. A bot whose needed data stays above the limit gets the
 * line again only when the folder grows by a step, because a line on every message costs tokens
 * and pushes the bot to delete what it needs.
 */
export const decideWarning = (
  kb: number,
  warnedKb: number | null,
  limitKb = SESSION_FOLDER_LIMIT_KB,
) => {
  if (kb <= limitKb) {
    return { warn: false, warnedKb: null };
  }

  if (warnedKb === null) {
    return { warn: true, warnedKb: kb };
  }

  // After a cleanup, the growth is counted from the smaller size.
  if (kb <= warnedKb) {
    return { warn: false, warnedKb: kb };
  }

  if (kb <= warnedKb + WARNING_STEP_KB) {
    return { warn: false, warnedKb };
  }

  return { warn: true, warnedKb: kb };
};

/** Builds the line that asks the bot to clean up its session folder. */
export const cleanupLine = (folder: { path: string; kb: number }) =>
  `(clots: your session folder ${folder.path} holds ${formatGb(folder.kb)}. It has your scratchpad and the output of your background tasks, and it uses disk space that all bots share. Only your own session writes there, so everything in it comes from your earlier work, even what you do not remember. Before you continue, delete what you no longer need there.)`;
