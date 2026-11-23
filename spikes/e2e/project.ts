/**
 * Creates a project with a directory, moves a new bot into it, and asks the bot where it works.
 * Usage: bun project.ts <directory>
 */
import { makeClotsClient } from "@clots/client-runtime";

const directory = process.argv[2]!;
const client = makeClotsClient(process.env.CLOTS_URL ?? "http://127.0.0.1:4587");

try {
  await client.createProject("Missing", "/no/such/directory");
} catch (error) {
  console.log(`[missing directory rejected] ${String(error).slice(0, 60)}`);
}

const project = await client.createProject("Spike", directory);
const bot = await client.createBot({ name: "Builder", instructions: "", color: "teal", shape: "square" });
await client.setBotProject(bot.id, project.id);
console.log(`[project] ${project.name} at ${project.directory}`);

const thread = client.thread(bot.id);
const startedAt = Date.now();
let sent = false;

await new Promise<void>((resolve) => {
  thread.subscribe(() => {
    const { live, synced, messages } = thread.get();

    if (synced && !sent) {
      sent = true;
      void client.sendMessage(bot.id, "Hey! In which directory do you work? One sentence.");

      return;
    }

    const last = messages.at(-1);
    if (!sent || live.status !== "idle" || last?.role !== "assistant") return;

    console.log(`[reply after ${Math.round((Date.now() - startedAt) / 1000)}s] ${last.text}`);
    resolve();
  });
});

await client.dispose();
process.exit(0);
