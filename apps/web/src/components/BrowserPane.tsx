import { BROWSER_STREAM_PATH, type BotId } from "@clots/contracts";
import {
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";

import { SquareIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useMountEffect } from "@/hooks/use-mount-effect";

import { client, useStore } from "../client.ts";
import {
  AddressBar,
  BrowserNavigation,
  BrowserTabStrip,
  BrowserToolbar,
  BrowserViewport,
  BrowserWindow,
  GiveBackButton,
  OWN_ESCAPE,
  type BrowserTab,
} from "./BrowserWindow.tsx";
import { PANE_LABEL } from "./BotSettings.tsx";
import { Collapse } from "./Collapse.tsx";
import { LoginBar } from "./LoginBar.tsx";

/** Is `true` when the operator uses a Mac, where the Command key does what Control does on Linux. */
const OPERATOR_ON_MAC = navigator.userAgent.includes("Mac");

/** The frame rate of the small preview. The server asks for the same rate when the stream opens. */
const PREVIEW_FPS = 10;

/** The frame rate while the operator controls the page, so that scrolling and typing look smooth. */
const TAKE_OVER_FPS = 30;

/** The wait before the pane looks again for a browser that the bot has not started yet. */
const RECONNECT_DELAY_MS = 3000;

/** The storage key prefix of the last shape of each bot's page, so the take-over window opens at the right size. */
const SCREEN_RATIO_KEY = "clots.screenRatio.";

/** The shape of the normal screen (1280 × 800). A take-over opens at it, and a bot that never showed a frame starts at it. */
const DEFAULT_SCREEN_RATIO = 16 / 10;

/** Reads the last shape of the bot's page. A missing value or a blocked storage gives the default shape. */
function readScreenRatio(botId: BotId) {
  try {
    return Number(localStorage.getItem(SCREEN_RATIO_KEY + botId)) || DEFAULT_SCREEN_RATIO;
  } catch {
    return DEFAULT_SCREEN_RATIO;
  }
}

/** The agent-browser commands that load a page. The stream reports when each starts and ends, which drives the loading line. */
const NAVIGATIONS = new Set(["navigate", "back", "forward", "reload"]);

/**
 * Shows the live screen of the bot's browser. In take-over mode, the pane sends the operator's
 * mouse and keyboard input to the page.
 */
export function BrowserPane({ botId, botName }: { botId: BotId; botName: string }) {
  const [frame, setFrame] = useState<string | null>(null);
  const [pageWidth, setPageWidth] = useState(1280);
  // The frame metadata can state a wrong page height, so the page's shape comes from the frame itself.
  const [frameRatio, setFrameRatio] = useState(() => readScreenRatio(botId));
  const [takeOver, setTakeOver] = useState(false);
  const [tabs, setTabs] = useState<ReadonlyArray<BrowserTab>>([]);
  const [address, setAddress] = useState("");
  // The ids of the navigations that run. A page loads while one runs, also when the bot started it.
  const [navigations, setNavigations] = useState<ReadonlySet<string>>(new Set());
  const bot = useStore(client.bots).find((candidate) => candidate.id === botId);
  // The browser takes a moment to close. The button stays disabled until the stream ends.
  const [stopping, setStopping] = useState(false);
  const socket = useRef<WebSocket | null>(null);
  // The section keeps the last frame while it closes, so the card does not go blank as it leaves.
  const [lastFrame, setLastFrame] = useState(frame);

  // Frames in the bot's own page size can arrive while the take-over resets it, and must not change the window.
  const resettingViewport = useRef(false);

  /** Asks the stream for the frame rate that fits: smooth while the operator controls the page. */
  const sendFrameRate = (opened: WebSocket, controlled: boolean) =>
    opened.send(
      JSON.stringify({ type: "config", maxFps: controlled ? TAKE_OVER_FPS : PREVIEW_FPS }),
    );

  // The socket opens again after a drop, and the new one must ask for the same frame rate.
  const takeOverNow = useRef(takeOver);
  const screen = useRef<HTMLImageElement>(null);

  // The parent keys the pane by the bot, so one stream serves the pane's whole life.
  useMountEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // The ack of the last frame that came while the window was hidden. Without it, the browser sends no more frames.
    let heldAck: number | undefined;

    const ack = (opened: WebSocket, seq: number) =>
      opened.send(JSON.stringify({ type: "ack", seq }));

    /** Asks for the current page when the window shows again, by sending the ack it held back. */
    const sendHeldAck = () => {
      const opened = socket.current;
      if (document.visibilityState === "hidden" || heldAck === undefined || opened === null) {
        return;
      }

      if (opened.readyState === WebSocket.OPEN) {
        ack(opened, heldAck);
      }

      heldAck = undefined;
    };

    const connect = () => {
      heldAck = undefined;
      const url = `${window.location.origin.replace(/^http/, "ws")}${BROWSER_STREAM_PATH}/${botId}`;
      const opened = new WebSocket(url);
      opened.binaryType = "arraybuffer";
      socket.current = opened;

      // A frame arrives as two messages: its details as text, then its picture as bytes.
      let details: { seq?: number; metadata: { deviceWidth: number } } | undefined;
      let previous: string | undefined;
      opened.addEventListener("open", () => sendFrameRate(opened, takeOverNow.current));

      opened.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) {
          if (details === undefined) {
            return;
          }

          const received = URL.createObjectURL(new Blob([event.data], { type: "image/jpeg" }));
          setFrame(received);
          setLastFrame(received);
          setPageWidth(details.metadata.deviceWidth);

          // The picture before this one can still be on its way to the screen, so it stays for a moment.
          const old = previous;
          previous = received;
          if (old !== undefined) {
            setTimeout(() => URL.revokeObjectURL(old), 1000);
          }

          // The sharp picture of a still page comes from the clots server and has no number to ack.
          if (details.seq === undefined) {
            return;
          }

          // Nobody sees a hidden window, so its frames would only cross the link for nothing.
          if (document.visibilityState === "hidden") {
            heldAck = details.seq;

            return;
          }

          // The ack tells the browser that this client is ready for the next frame.
          ack(opened, details.seq);

          return;
        }

        const message = JSON.parse(String(event.data));

        if (message.type === "tabs") {
          const listed: ReadonlyArray<BrowserTab> = message.tabs;
          setTabs(listed);
          setAddress(listed.find((tab) => tab.active)?.url ?? "");
        }

        if (message.type === "url") {
          setAddress(message.url);
        }

        if (message.type === "command" && NAVIGATIONS.has(message.action)) {
          setNavigations((running) => new Set(running).add(message.id));
        }

        if (message.type === "result") {
          setNavigations((running) =>
            running.has(message.id)
              ? new Set([...running].filter((id) => id !== message.id))
              : running,
          );
        }

        if (message.type === "frame") {
          details = message;
        }
      });

      opened.addEventListener("close", () => {
        setFrame(null);
        setTabs([]);
        setAddress("");
        setNavigations(new Set());
        setStopping(false);
        if (!closed) {
          retry = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      });
    };
    connect();
    document.addEventListener("visibilitychange", sendHeldAck);

    return () => {
      closed = true;
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", sendHeldAck);
      socket.current?.close();
    };
  });

  /** Opens or closes the take-over, and asks the open stream for the frame rate that fits. */
  const changeTakeOver = (next: boolean) => {
    setTakeOver(next);
    takeOverNow.current = next;

    const opened = socket.current;
    if (opened?.readyState === WebSocket.OPEN) {
      sendFrameRate(opened, next);
    }
  };

  /** Closes the browser to free its memory. The bot opens it again with its logins when it needs it. */
  const stopBrowser = async () => {
    setStopping(true);

    try {
      await client.stopBrowser(botId);
    } catch {
      setStopping(false);
    }
  };

  const navigate = (action: Parameters<typeof client.navigateBrowser>[1], target?: string) =>
    void client.navigateBrowser(botId, action, target);

  /** Opens the take-over window at the normal screen size, also when the bot made its page tall or narrow. */
  const openTakeOver = async () => {
    changeTakeOver(true);
    setFrameRatio(DEFAULT_SCREEN_RATIO);
    resettingViewport.current = true;

    await client.navigateBrowser(botId, "resetViewport").finally(() => {
      resettingViewport.current = false;
    });
  };

  /** Follows the shape of the page, and keeps it, so the next take-over of this bot opens at that size. */
  const followFrameShape = (image: HTMLImageElement) => {
    const ratio = image.naturalWidth / image.naturalHeight;
    if (resettingViewport.current || Math.abs(ratio - frameRatio) < 0.001) {
      return;
    }

    setFrameRatio(ratio);
    try {
      localStorage.setItem(SCREEN_RATIO_KEY + botId, String(ratio));
    } catch {
      // The window opens at the default shape next time.
    }
  };

  const send = (message: object) => {
    if (takeOver && socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(message));
    }
  };

  const sendMouse = (eventType: string, event: MouseEvent<HTMLImageElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();

    send({
      type: "input_mouse",
      eventType,
      x: Math.round(((event.clientX - bounds.left) / bounds.width) * pageWidth),
      y: Math.round(((event.clientY - bounds.top) / bounds.height) * (pageWidth / frameRatio)),
      button: "left",
      clickCount: 1,
    });
  };

  /** Scrolls the page under the pointer, as the wheel or the trackpad does in a browser. */
  const sendWheel = (event: WheelEvent<HTMLImageElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();

    send({
      type: "input_mouse",
      eventType: "mouseWheel",
      x: Math.round(((event.clientX - bounds.left) / bounds.width) * pageWidth),
      y: Math.round(((event.clientY - bounds.top) / bounds.height) * (pageWidth / frameRatio)),
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
  };

  const sendKey = (eventType: string, event: KeyboardEvent) => {
    if (!takeOver) {
      return;
    }

    // The bot's browser runs on Linux, so a Mac shortcut such as Command+A must arrive as Control+A.
    const control = event.ctrlKey || (OPERATOR_ON_MAC && event.metaKey);
    const meta = event.metaKey && !OPERATOR_ON_MAC;

    // The page's own clipboard is on the server. The paste shortcut stays here, so `pasteText` gets this clipboard.
    if (control && event.key.toLowerCase() === "v") {
      return;
    }

    event.preventDefault();
    send({
      type: "input_keyboard",
      eventType,
      key: event.key,
      code: event.code,
      modifiers:
        (event.altKey ? 1 : 0) | (control ? 2 : 0) | (meta ? 4 : 0) | (event.shiftKey ? 8 : 0),
      // A key without text, such as an arrow, works only with its key code.
      windowsVirtualKeyCode: event.keyCode,
      // Only a printable key inserts text, and not as part of a shortcut.
      ...(eventType === "keyDown" && event.key.length === 1 && !control && !meta
        ? { text: event.key }
        : {}),
    });
  };

  /** Types the operator's clipboard text into the page, one key at a time, because the stream has no paste message. */
  const pasteText = (event: ClipboardEvent) => {
    event.preventDefault();

    for (const character of event.clipboardData.getData("text/plain").replaceAll("\r\n", "\n")) {
      // A line break is an Enter press. Every other character arrives as typed text.
      const key =
        character === "\n"
          ? { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" }
          : { key: character, text: character };
      send({ type: "input_keyboard", eventType: "keyDown", modifiers: 0, ...key });
      send({ type: "input_keyboard", eventType: "keyUp", modifiers: 0, key: key.key });
    }
  };

  return (
    // An offline screen offers nothing to do, so the section shows only while the screen is live.
    <Collapse open={frame !== null}>
      <section className="flex flex-col gap-1 pt-5">
        <h2 className={PANE_LABEL}>Computer</h2>
        <div className="rounded-xl bg-muted/60 p-1.5">
          <div className="flex items-center justify-between py-1 pr-1 pl-1">
            <div>
              <p>{botName}'s screen</p>
              <p className="text-[0.8125rem] text-muted-foreground">Live. Click to take over.</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              disabled={stopping}
              onClick={stopBrowser}
              className="rounded-full"
            >
              <SquareIcon />
              {stopping ? "Stopping…" : "Stop"}
            </Button>
          </div>

          {lastFrame !== null && (
            <div className="pt-1.5">
              <img
                src={lastFrame}
                alt={`${botName}'s screen`}
                tabIndex={0}
                draggable={false}
                onLoad={(event) => followFrameShape(event.currentTarget)}
                onClick={() => void openTakeOver()}
                onKeyDown={(event) => event.key === "Enter" && void openTakeOver()}
                className="w-full cursor-pointer rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          )}

          {bot !== undefined && (
            <BrowserWindow
              botName={botName}
              open={takeOver}
              onOpenChange={changeTakeOver}
              frameRatio={frameRatio}
              initialFocus={screen}
            >
              {/* The strip is always there, so its + is in reach and the page does not move when a second tab opens. */}
              <BrowserTabStrip
                tabs={tabs}
                onSelect={(tab) => navigate("tab", tab.tabId)}
                onNew={() => navigate("newTab")}
                onClose={(tab) => navigate("closeTab", tab.tabId)}
              />
              <BrowserToolbar>
                <BrowserNavigation
                  loading={navigations.size > 0}
                  onNavigate={(action) =>
                    navigate(
                      action,
                      action === "stop" ? tabs.find((tab) => tab.active)?.targetId : undefined,
                    )
                  }
                />
                <AddressBar
                  address={address}
                  loading={navigations.size > 0}
                  onOpen={(typed) => navigate("open", typed)}
                />
                <GiveBackButton bot={bot} />
              </BrowserToolbar>
              <BrowserViewport botName={botName} frameRatio={frameRatio} live={frame !== null}>
                {frame === null ? null : (
                  <>
                    <img
                      {...OWN_ESCAPE}
                      ref={screen}
                      src={frame}
                      alt={`${botName}'s screen`}
                      tabIndex={0}
                      draggable={false}
                      onMouseDown={(event) => sendMouse("mousePressed", event)}
                      onMouseUp={(event) => sendMouse("mouseReleased", event)}
                      onMouseMove={(event) => sendMouse("mouseMoved", event)}
                      onWheel={sendWheel}
                      onKeyDown={(event) => sendKey("keyDown", event)}
                      onKeyUp={(event) => sendKey("keyUp", event)}
                      onPaste={pasteText}
                      // The page fits the window by its width, or by its height when it is tall. The width is set here, so a small picture grows to fill the window.
                      className="block h-auto max-h-(--page-max-height) max-w-full cursor-default object-contain outline-none"
                      style={{ width: `calc(var(--page-max-height) * ${frameRatio})` }}
                    />
                    <LoginBar botId={botId} botName={botName} address={address} />
                  </>
                )}
              </BrowserViewport>
            </BrowserWindow>
          )}
        </div>
      </section>
    </Collapse>
  );
}
