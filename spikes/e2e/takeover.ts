/**
 * Sends a click and typed text through the clots browser proxy.
 * Usage: bun takeover.ts <botId>
 */
import { BROWSER_STREAM_PATH } from "@clots/contracts";

const socket = new WebSocket(`ws://127.0.0.1:4587${BROWSER_STREAM_PATH}/${process.argv[2]}`);
const send = (message: object) => socket.send(JSON.stringify(message));
const click = (x: number, y: number) => {
  for (const eventType of ["mousePressed", "mouseReleased"]) {
    send({ type: "input_mouse", eventType, x, y, button: "left", clickCount: 1 });
  }
};

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.type === "frame") send({ type: "ack", seq: message.seq });
});

socket.addEventListener("open", async () => {
  await Bun.sleep(1000);
  click(60, 40);
  await Bun.sleep(300);
  click(100, 140);
  await Bun.sleep(300);

  for (const key of "clots") {
    send({ type: "input_keyboard", eventType: "keyDown", key, text: key });
    send({ type: "input_keyboard", eventType: "keyUp", key });
  }

  await Bun.sleep(1000);
  socket.close();
  process.exit(0);
});
