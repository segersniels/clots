/**
 * Fills a new clots server with a few bots, one chat and some routines, for screenshots.
 * Usage: bun seed.ts
 */
import { makeClotsClient } from "@clots/client-runtime";

const client = makeClotsClient(process.env.CLOTS_URL ?? "http://127.0.0.1:4587");
const brief = "Answer in one or two short sentences.";

const chief = await client.createBot({ name: "Chief of Staff", instructions: brief, color: "purple", shape: "circle" });
await client.createBot({ name: "Inbox Manager", instructions: brief, color: "green", shape: "cloud" });
await client.createBot({ name: "Research", instructions: brief, color: "blue", shape: "drop" });
await client.createBot({ name: "Expense Manager", instructions: brief, color: "pink", shape: "triangle" });
await client.createBot({ name: "Night Shift", instructions: brief, color: "orange", shape: "hexagon" });

await client.createSchedule(chief.id, "0 8 * * *", "Morning briefing");
await client.createSchedule(chief.id, "0 18 * * 1-5", "Inbox cleanup");
const weekly = await client.createSchedule(chief.id, "0 9 * * 1", "Weekly team update");
await client.setSchedulePaused(weekly.id, true);

const thread = client.thread(chief.id);
const prompts = ["Hey, what is a good first step to plan a product launch?", "Perfect. Give me a two-line checklist for launch day."];
let next = 0;

await new Promise<void>((resolve) => {
  thread.subscribe(() => {
    const { live, synced, messages } = thread.get();
    const answered = messages.filter((message) => message.role === "assistant").length;
    if (!synced || live.status !== "idle" || answered < next) return;
    if (next === prompts.length) return resolve();

    void client.sendMessage(chief.id, prompts[next++]!);
  });
});

console.log(chief.id);
await client.dispose();
process.exit(0);
