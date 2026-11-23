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
