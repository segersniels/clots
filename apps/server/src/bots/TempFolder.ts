import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { StoredBot } from "./BotRepository.ts";

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
