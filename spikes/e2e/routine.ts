/**
 * Adds a routine that runs each minute, waits for its first run, then deletes it.
 * Usage: bun routine.ts <botId>
 */
import { makeClotsClient } from "@clots/client-runtime";
import type { BotId } from "@clots/contracts";

const botId = process.argv[2] as BotId;
const client = makeClotsClient(process.env.CLOTS_URL ?? "http://127.0.0.1:4587");

try {
  await client.createSchedule(botId, "not a cron", "x");
} catch (error) {
  console.log(`[invalid cron rejected] ${String(error).slice(0, 80)}`);
}

const schedule = await client.createSchedule(botId, "* * * * *", "Routine check: reply with the single word pong.");
console.log(`[schedule] next run ${new Date(schedule.nextRunAt).toISOString()}`);

const thread = client.thread(botId);

await new Promise<void>((resolve) => {
  thread.subscribe(() => {
    const { messages, live } = thread.get();
    const routineAt = messages.findLastIndex((message) => message.role === "routine");
    const reply = messages[routineAt + 1];
    if (routineAt === -1 || reply === undefined || live.status !== "idle") return;

    console.log(`[routine] ${messages[routineAt]!.text}`);
    console.log(`[reply] ${reply.text}`);
    resolve();
  });
});

await client.deleteSchedule(schedule.id);
await client.dispose();
process.exit(0);
