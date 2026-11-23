/**
 * Sends an image and a text file to a bot and prints what the bot says about them.
 * Usage: bun attachment.ts <botId> <image path>
 */
import { makeClotsClient } from "@clots/client-runtime";
import type { BotId } from "@clots/contracts";

const [botId, imagePath] = process.argv.slice(2) as [BotId, string];
const client = makeClotsClient(process.env.CLOTS_URL ?? "http://127.0.0.1:4587");
const thread = client.thread(botId);
let sent = false;

const image = Buffer.from(await Bun.file(imagePath).arrayBuffer()).toString("base64");
const note = Buffer.from("The launch code is 7421.").toString("base64");

await new Promise<void>((resolve) => {
  thread.subscribe(() => {
    const { live, synced, messages } = thread.get();

    if (synced && !sent) {
      sent = true;
      void client.sendMessage(botId, "What is the title text in the image, and what is the launch code in the note?", [
        { name: "screen.png", mediaType: "image/png", data: image },
        { name: "note.txt", mediaType: "text/plain", data: note },
      ]);

      return;
    }

    if (live.steps.length > 0) console.log(`[steps] ${live.steps.map((step) => `${step.title}:${step.status}`).join(" | ")}`);

    const last = messages.at(-1);
    if (!sent || live.status !== "idle" || last?.role !== "assistant") return;

    const question = messages.findLast((message) => message.role === "user");
    console.log(`[stored attachments] ${question?.attachments.map((file) => `${file.name} ${file.size}B`).join(", ")}`);
    console.log(`[reply] ${last.text}`);
    resolve();
  });
});

await client.dispose();
process.exit(0);
