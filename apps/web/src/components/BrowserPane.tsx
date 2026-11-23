import { BROWSER_STREAM_PATH, type BotId } from "@clots/contracts";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";

/** The wait before the pane looks again for a browser that the bot has not started yet. */
const RECONNECT_DELAY_MS = 3000;

interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * Shows the live screen of the bot's browser. In take-over mode, the pane sends the operator's
 * mouse and keyboard input to the page.
 */
export function BrowserPane({ botId, botName }: { botId: BotId; botName: string }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 1280, height: 720 });
  const [takeOver, setTakeOver] = useState(false);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const url = `${window.location.origin.replace(/^http/, "ws")}${BROWSER_STREAM_PATH}/${botId}`;
      const opened = new WebSocket(url);
      socket.current = opened;

      opened.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type !== "frame") return;

        setFrame(`data:image/jpeg;base64,${message.data}`);
        setViewport({ width: message.metadata.deviceWidth, height: message.metadata.deviceHeight });

        // The ack tells the browser that this client is ready for the next frame.
        opened.send(JSON.stringify({ type: "ack", seq: message.seq }));
      });

      opened.addEventListener("close", () => {
        setFrame(null);
        if (!closed) retry = setTimeout(connect, RECONNECT_DELAY_MS);
      });
    };
    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, [botId]);

  const send = (message: object) => {
    if (takeOver && socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message));
  };

  const sendMouse = (eventType: string) => (event: MouseEvent<HTMLImageElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();

    send({
      type: "input_mouse",
      eventType,
      x: Math.round(((event.clientX - bounds.left) / bounds.width) * viewport.width),
      y: Math.round(((event.clientY - bounds.top) / bounds.height) * viewport.height),
      button: "left",
      clickCount: 1,
    });
  };

  const sendKey = (eventType: string) => (event: KeyboardEvent) => {
    if (!takeOver) return;

    event.preventDefault();
    send({
      type: "input_keyboard",
      eventType,
      key: event.key,
      code: event.code,
      // Only a printable key inserts text.
      ...(eventType === "keyDown" && event.key.length === 1 ? { text: event.key } : {}),
    });
  };

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex aspect-[16/10] items-center justify-center rounded-xl bg-muted p-5">
        {frame === null ? (
          <p className="text-sm text-muted-foreground">The browser is not open</p>
        ) : (
          <div className={takeOver ? "fixed inset-0 z-10 flex items-center justify-center bg-black/85 p-12" : "contents"}>
            <img
              src={frame}
              alt={`${botName}'s screen`}
              tabIndex={0}
              draggable={false}
              onClick={() => setTakeOver(true)}
              onMouseDown={sendMouse("mousePressed")}
              onMouseUp={sendMouse("mouseReleased")}
              onMouseMove={sendMouse("mouseMoved")}
              onKeyDown={sendKey("keyDown")}
              onKeyUp={sendKey("keyUp")}
              className={`max-h-full max-w-full rounded-md shadow-md outline-none ${takeOver ? "cursor-crosshair" : "cursor-pointer"}`}
            />
            {takeOver && (
              <Button variant="secondary" className="absolute right-5 top-12" onClick={() => setTakeOver(false)}>
                Give back
              </Button>
            )}
          </div>
        )}
      </div>

      {/* A click on the screen starts the take-over. */}
      <p className="text-center text-sm text-muted-foreground">{botName}'s screen</p>
    </section>
  );
}
