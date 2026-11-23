/**
 * Spike 2: connect to the agent-browser stream, save a frame, then click and type through the stream.
 * Usage: bun stream.ts <port>
 */
const port = process.argv[2];
const socket = new WebSocket(`ws://127.0.0.1:${port}/?pacing=ack&maxFps=10`);

const send = (message: unknown) => socket.send(JSON.stringify(message));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let frames = 0;
let latestFrame = "";

socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));

  if (message.type !== "frame") {
    console.log(`[${message.type}] ${JSON.stringify(message).slice(0, 200)}`);

    return;
  }

  frames++;
  latestFrame = message.data;
  send({ type: "ack", seq: message.seq });
});

socket.addEventListener("open", async () => {
  console.log("[open] connected");
  await sleep(1500);
  await Bun.write("frame-before.jpg", Buffer.from(latestFrame, "base64"));

  // The button covers the top-left corner; the click also focuses nothing else.
  send({ type: "input_mouse", eventType: "mousePressed", x: 60, y: 40, button: "left", clickCount: 1 });
  send({ type: "input_mouse", eventType: "mouseReleased", x: 60, y: 40, button: "left", clickCount: 1 });
  await sleep(300);

  // Click the input, then type.
  send({ type: "input_mouse", eventType: "mousePressed", x: 100, y: 140, button: "left", clickCount: 1 });
  send({ type: "input_mouse", eventType: "mouseReleased", x: 100, y: 140, button: "left", clickCount: 1 });
  await sleep(300);

  for (const key of "clots") {
    send({ type: "input_keyboard", eventType: "keyDown", key, text: key });
    send({ type: "input_keyboard", eventType: "keyUp", key });
  }

  await sleep(1500);
  await Bun.write("frame-after.jpg", Buffer.from(latestFrame, "base64"));
  console.log(`[done] frames=${frames}`);
  socket.close();
});

socket.addEventListener("error", (event) => console.log("[error]", event));
