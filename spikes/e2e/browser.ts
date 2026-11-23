/**
 * Asks a bot to open a page and to request a handoff. Checks the browser stream through the clots
 * server and sends take-over input. Usage: bun browser.ts <botId>
 */
import { makeClotsClient } from "@clots/client-runtime";
import { BROWSER_STREAM_PATH, type BotId } from "@clots/contracts";

const botId = process.argv[2] as BotId;
const origin = process.env.CLOTS_URL ?? "http://127.0.0.1:4587";
const client = makeClotsClient(origin);
const thread = client.thread(botId);
let handled = false;

const checkStream = () =>
  new Promise<void>((resolve) => {
    const socket = new WebSocket(`${origin.replace(/^http/, "ws")}${BROWSER_STREAM_PATH}/${botId}`);
    let frames = 0;

    socket.addEventListener("message", async (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type !== "frame") return;

      socket.send(JSON.stringify({ type: "ack", seq: message.seq }));
      frames++;
      if (frames !== 1) return;

      await Bun.write("browser-frame.jpg", Buffer.from(message.data, "base64"));
      console.log(`[stream] frame ${message.metadata.deviceWidth}x${message.metadata.deviceHeight} saved`);

      // Take-over input: click the link on example.com.
      for (const eventType of ["mousePressed", "mouseReleased"]) {
        socket.send(JSON.stringify({ type: "input_mouse", eventType, x: 640, y: 290, button: "left", clickCount: 1 }));
      }

      setTimeout(() => {
        console.log(`[stream] frames=${frames}`);
        socket.close();
        resolve();
      }, 4000);
    });
  });

await new Promise<void>((resolve) => {
  let sent = false;

  thread.subscribe(async () => {
    const { live, synced, messages } = thread.get();

    for (const approval of live.approvals) {
      console.log(`[approval] ${approval.toolName} ${approval.input.replaceAll(/\s+/g, " ").slice(0, 140)}`);
      void client.resolveApproval(botId, approval.id, "allowAlways");
    }

    if (synced && !sent) {
      sent = true;
      void client.sendMessage(
        botId,
        "Open https://example.com in your browser with agent-browser. Then call the request_handoff tool with the reason 'Please click the link'. After the handoff returns, tell me the URL of the page.",
      );

      return;
    }

    if (live.handoff !== null && !handled) {
      handled = true;
      console.log(`[handoff] ${live.handoff.reason} (status=${live.status})`);
      await checkStream();
      await client.resolveHandoff(botId, live.handoff.id);

      return;
    }

    const last = messages.at(-1);
    if (handled && live.status === "idle" && last?.role === "assistant") {
      console.log(`[reply] ${last.text}`);
      resolve();
    }
  });
});

await client.dispose();
process.exit(0);
