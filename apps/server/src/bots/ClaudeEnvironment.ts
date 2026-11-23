import { rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { StoredBot } from "./BotRepository.ts";

/**
 * A Claude Code session that started clots exports these variables. A `claude` process that
 * inherits them acts as a part of that session. The list comes from T3 Code's `ClaudeHome.ts`.
 */
const CLAUDE_HOST_SESSION_VARIABLES = [
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_HOST_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_CHILD_NOTES_DIR",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_DESKTOP_APP_VERSION",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
  "CLAUDE_AGENT_SDK_VERSION",
];

/** clots supports the subscription login only, so no API credential reaches `claude`. */
const API_CREDENTIAL_VARIABLES = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

/** Builds the environment of the `claude` processes that clots starts. */
export const makeClaudeEnvironment = (
  hostEnvironment: Record<string, string | undefined>,
): Record<string, string | undefined> => {
  const environment: Record<string, string | undefined> = {
    ...hostEnvironment,
    CLAUDE_CODE_ENTRYPOINT: "clots",
  };

  for (const name of [...CLAUDE_HOST_SESSION_VARIABLES, ...API_CREDENTIAL_VARIABLES]) {
    delete environment[name];
  }

  return environment;
};

/** Builds the path of the folder where `claude` keeps the transcripts of one working directory. */
const transcriptFolder = (directory: string) =>
  join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects", directory.replaceAll(/[^a-zA-Z0-9]/g, "-"));

/**
 * Deletes the transcripts that `claude` kept for a bot. The folder of the notes directory belongs
 * to the bot alone. A project folder is shared, so only the bot's own session goes from there.
 */
export const removeClaudeTranscripts = (bot: StoredBot) => {
  rmSync(transcriptFolder(bot.workingDirectory), { recursive: true, force: true });
  if (bot.projectDirectory === null || bot.sdkSessionId === null) return;

  const projectFolder = transcriptFolder(bot.projectDirectory);
  rmSync(join(projectFolder, `${bot.sdkSessionId}.jsonl`), { force: true });
  rmSync(join(projectFolder, bot.sdkSessionId), { recursive: true, force: true });
};

/** Builds the path of the transcript that `claude` writes for a session of the bot. */
export const transcriptPath = (bot: StoredBot, sessionId: string) =>
  join(transcriptFolder(bot.projectDirectory ?? bot.workingDirectory), `${sessionId}.jsonl`);
