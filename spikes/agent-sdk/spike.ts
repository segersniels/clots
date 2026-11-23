/**
 * Spike 1: Agent SDK under Bun with the subscription login.
 * Usage: bun spike.ts create | bun spike.ts resume <sessionId>
 */
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync } from "node:fs";

const HOST_SESSION_VARIABLES = [
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

const env: Record<string, string | undefined> = { ...process.env, CLAUDE_CODE_ENTRYPOINT: "clots" };
for (const name of HOST_SESSION_VARIABLES) delete env[name];

delete env.ANTHROPIC_API_KEY;

const [mode, resumeId] = process.argv.slice(2);
const cwd = "/tmp/clots-spike-bot";
mkdirSync(cwd, { recursive: true });

const prompt =
  mode === "resume"
    ? "What was the secret word I told you earlier? Answer with the word only."
    : "Remember the secret word: marmalade. Then use the Write tool to create hello.txt containing 'hi'. Reply 'done'.";

let finish!: () => void;
const finished = new Promise<void>((resolve) => (finish = resolve));

async function* input(): AsyncGenerator<SDKUserMessage> {
  yield {
    type: "user",
    message: { role: "user", content: prompt },
    parent_tool_use_id: null,
  } as SDKUserMessage;
  // Keep the input open until the result arrives; canUseTool needs streaming input.
  await finished;
}

const session = query({
  prompt: input(),
  options: {
    cwd,
    env,
    pathToClaudeCodeExecutable: Bun.which("claude")!,
    settingSources: ["user", "project", "local"],
    systemPrompt: { type: "preset", preset: "claude_code", append: "You are a clots spike bot." },
    includePartialMessages: true,
    permissionMode: "default",
    ...(mode === "resume" ? { resume: resumeId } : {}),
    canUseTool: async (toolName, toolInput) => {
      console.log(`[canUseTool] ${toolName} ${JSON.stringify(toolInput)}`);

      return { behavior: "allow", updatedInput: toolInput };
    },
  },
});

let partials = 0;
for await (const message of session) {
  if (message.type === "system" && message.subtype === "init") {
    console.log(`[init] session=${message.session_id} model=${message.model} apiKeySource=${message.apiKeySource}`);
    console.log(`[init] mcp_servers=${JSON.stringify(message.mcp_servers)}`);
    console.log(`[init] skills=${message.skills?.length} plugins=${message.plugins?.length}`);
    console.log(`[account] ${JSON.stringify(await session.accountInfo())}`);
    console.log(`[mcpServerStatus] ${JSON.stringify((await session.mcpServerStatus()).map((s) => `${s.name}:${s.status}`))}`);
  }

  if (message.type === "stream_event") partials++;

  if (message.type === "result") {
    console.log(`[result] subtype=${message.subtype} session=${message.session_id} partial_events=${partials}`);
    if (message.subtype === "success") console.log(`[result] text=${message.result}`);

    finish();
  }
}
