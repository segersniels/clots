/**
 * Gives a bot another model while its session runs, and asks the bot which model it is.
 * Usage: bun model.ts <botId> <model>
 */
import { makeClotsClient } from "@clots/client-runtime";
import type { BotId, BotModel } from "@clots/contracts";

const [botId, model] = process.argv.slice(2) as [BotId, BotModel];
const client = makeClotsClient(process.env.CLOTS_URL ?? "http://127.0.0.1:4587");
const thread = client.thread(botId);

/** Sends one prompt and waits for the reply. */
const ask = (text: string) =>
  new Promise<string>((resolve) => {
    let sentAt: number | undefined;

    const stop = thread.subscribe(() => {
      const { live, synced, messages } = thread.get();
      if (!synced) return;

      if (sentAt === undefined) {
        sentAt = messages.length;
        void client.sendMessage(botId, text);

        return;
      }

      const last = messages.at(-1);
      if (live.status !== "idle" || last?.role !== "assistant" || messages.length < sentAt + 2) return;

      stop();
      resolve(last.text);
    });
  });

const question = "Which model are you? Reply with the exact model id from your system prompt, nothing else.";

console.log(`[before] ${await ask(question)}`);
await client.setBotModel(botId, model);
console.log(`[after ${model}] ${await ask(question)}`);

await client.dispose();
process.exit(0);
