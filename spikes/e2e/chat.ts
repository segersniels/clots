/**
 * End-to-end check against a running clots server.
 * Usage: bun chat.ts create "<name>" "<text>" | bun chat.ts send <botId> "<text>"
 */
import { makeClotsClient } from "@clots/client-runtime";
import type { BotId } from "@clots/contracts";

const [mode, first, text] = process.argv.slice(2);
const client = makeClotsClient(process.env.CLOTS_URL ?? "http://127.0.0.1:4587");

const botId =
  mode === "create" ? (await client.createBot({ name: first!, instructions: "Answer in one short sentence.", color: "blue", shape: "circle" })).id : (first as BotId);
console.log(`[bot] ${botId}`);

const thread = client.thread(botId);
let printed = 0;
let sent = false;

await new Promise<void>((resolve) => {
  thread.subscribe(() => {
    const state = thread.get();

    for (const message of state.messages.slice(printed)) {
      console.log(`[${message.sequence} ${message.role}] ${message.text}`);
    }
    printed = state.messages.length;

    for (const approval of state.live.approvals) {
      console.log(`[approval] ${approval.toolName} ${approval.input.replaceAll(/\s+/g, " ")}`);
      void client.resolveApproval(botId, approval.id, "allow");
    }

    if (state.synced && !sent) {
      sent = true;
      void client.sendMessage(botId, text!);

      return;
    }

    const last = state.messages.at(-1);
    if (sent && state.live.status === "idle" && last?.role === "assistant" && last.text !== "") resolve();
  });
});

console.log(`[done] connection=${client.connection.get()}`);
await client.dispose();
process.exit(0);
