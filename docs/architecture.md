# Architecture

clots is a Bun and Turborepo monorepo. It uses [Effect](https://effect.website) 4 throughout: RPC, SQL, HTTP and sockets.

```
apps/
  server/      Bun + Effect + Claude Agent SDK + SQLite, and the clots CLI
  web/         React client (Vite, TanStack Router, Tailwind, shadcn)
  desktop/     Electron window around the web client
  sidecar/     Go tsnet proxy
packages/
  contracts/       Effect Schema types and the RPC group
  client-runtime/  connection, stream resume and client state
  character/       the clot characters that bots wear, and their shapes and colors
spikes/        throwaway scripts and end-to-end scripts
```

## Data flow

```
client ──WebSocket /rpc──▶ server ──Agent SDK──▶ claude (one process per active bot)
client ──WebSocket /browser/<bot>──▶ server ──▶ agent-browser stream of that bot
client ──HTTP /attachments/<bot>/<file>──▶ server ──▶ the bot's attachments/ folder
phone  ──HTTPS on the tailnet──▶ sidecar ──▶ server on 127.0.0.1
```

## Contracts

`packages/contracts` defines the domain types (`Bot`, `Message`, `Schedule`, `ThreadEvent`) and one RPC group, `ClotsRpcs`. The server and each client import the same definitions, so a change in a payload is a type error on both sides.

## Server

- **Persistence** (`persistence/`, `bots/BotRepository.ts`, `schedules/ScheduleRepository.ts`): SQLite through `@effect/sql-sqlite-bun`, with the Effect migrator. The tables are `bots`, `threads`, `messages`, `schedules` and `projects`.
- **Bot sessions** (`bots/BotSessions.ts`): one long-lived `query()` per active bot. A queue feeds the prompts as streaming input, so a new message steers the running session. The session id goes to the `threads` table, and the next start resumes it. A session starts with the first message, not with the server.
- **Approvals**: sessions run in the `auto` permission mode. When its classifier cannot decide, the SDK's `canUseTool` callback puts a request in the live state of the thread and waits for the operator's decision.
- **clots tools**: each session gets an in-process MCP server, `clots`. `request_handoff` pauses the bot until the operator is done in the browser. `list_bots`, `read_bot_thread` and `send_bot_message` let a bot see and message other bots. `clone_bot` and `delete_bot` let a bot make clones for a task and remove them.
- **Scheduler** (`schedules/Scheduler.ts`): checks each 15 seconds for due routines and sends their prompts.
- **Browser** (`browser/`): each bot gets its own agent-browser session, profile and stream port through environment variables. `BrowserProxy.ts` relays the stream WebSocket, because agent-browser accepts loopback clients only.
- **Claude environment** (`bots/ClaudeEnvironment.ts`): removes API credentials and the variables of a parent Claude Code session, and sets `CLAUDE_CODE_ENTRYPOINT=clots`.

## Thread streams and resume

A client subscribes with `SubscribeThread({ botId, afterSequence })`. The server:

1. Subscribes to the live events of the bot.
2. Replays the stored messages with a sequence after `afterSequence`.
3. Sends the live state (status, running tool calls, approvals, handoff).
4. Sends live events: `Message` (stored, with a sequence) and `Live` (a new live state). A reply arrives whole, as a `Message`, when the bot finishes it.

Stored messages are the durable log. The live state is in memory only. After a dropped connection, the client subscribes again with its last sequence and gets only what it missed.

## Client runtime

`packages/client-runtime` owns the connection and the state. It uses only the global `WebSocket`, so the same package serves the web client and a future React Native app.

- `makeClotsClient(origin)` returns stores (`bots`, `thread(botId)`, `schedules(botId)`, `connection`) and commands.
- A store has `get()` and `subscribe()`, which fits React's `useSyncExternalStore`.
- A store runs its server stream only while a view observes it, and keeps its value and its resume cursor when the view goes away.
- `applyThreadEvent` is the pure reducer for a thread.

## Web client

`apps/web` is a Vite app with file-based TanStack Router routes. All controls are [shadcn](https://ui.shadcn.com) components (Base UI variant) in `src/components/ui`. The thread uses the shadcn chat parts: `MessageScroller`, `Message`, `Bubble` and `InputGroup`. The message field is a [TipTap](https://tiptap.dev) editor, so skills and bot mentions show as chips. The theme is the set of shadcn CSS variables in `src/styles.css`.
