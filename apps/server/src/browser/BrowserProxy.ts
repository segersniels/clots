import { BROWSER_STREAM_PATH, type BotId } from "@clots/contracts";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { BotRepository } from "../bots/BotRepository.ts";
import { BotSessions } from "../bots/BotSessions.ts";
import { readPages, takeSharpPicture } from "./BotChrome.ts";
import { devToolsPort } from "./BrowserEnvironment.ts";

/** The time between two looks at the titles and addresses of the bot's pages while a client watches. */
const PAGE_POLL_MS = 500;

/** The time without a change of the page after which the client gets a sharp picture of it. */
const STILL_PAGE_MS = 250;

/** The start of a frame message of agent-browser, which puts the picture first. */
const FRAME_START = '{"data":"';

/** The tabs as agent-browser lists them, with the fields that clots takes from Chrome. */
interface TabList {
  readonly tabs: ReadonlyArray<{
    readonly targetId: string;
    readonly active: boolean;
    readonly title: string;
    readonly url: string;
  }>;
}

/**
 * Relays a bot's agent-browser stream to a client. agent-browser accepts only loopback clients, so
 * the clots server is the bridge. Frames go to the client, and input and frame acks go back.
 *
 * A frame goes out in two messages: its details as text, then its picture as bytes. The picture
 * arrives here as base64 text, which is a third larger than the bytes.
 */
export const BrowserProxyLayer = HttpRouter.add(
  "GET",
  `${BROWSER_STREAM_PATH}/:botId`,
  Effect.fn(function* (request) {
    const bots = yield* BotRepository;
    const sessions = yield* BotSessions;
    const { botId } = yield* HttpRouter.params;
    const bot = yield* bots.find(botId as BotId);
    if (bot === undefined) {
      return HttpServerResponse.empty({ status: 404 });
    }

    const socket = yield* request.upgrade;
    yield* sessions.watchBrowser(bot.id);
    const writer = yield* socket.writer;
    const reader = yield* socket.reader;
    const services = yield* Effect.context();

    // The client acks each frame, so the browser never sends more than the link can carry.
    const upstream = yield* Effect.acquireRelease(
      Effect.sync(
        () => new WebSocket(`ws://127.0.0.1:${bot.browserStreamPort}/?pacing=ack&maxFps=10`),
      ),
      (opened) => Effect.sync(() => opened.close()),
    );

    const send = (text: string) => Effect.runForkWith(services)(Effect.ignore(writer.write(text)));

    /**
     * agent-browser keeps the titles and addresses from its last command, and Chrome sends no event
     * when a page sets its title. So the tabs go out with what Chrome shows now, when agent-browser
     * lists them and twice a second, and only when something changed.
     */
    let listed: TabList | undefined;
    let sent = "";

    const sendTabs = async () => {
      if (listed === undefined) {
        return;
      }

      const pages = await readPages(devToolsPort(bot));
      const tabs = listed.tabs.map((tab) => {
        const page = pages.find((each) => each.targetId === tab.targetId);

        return page === undefined ? tab : { ...tab, title: page.title, url: page.url };
      });
      const text = JSON.stringify({ ...listed, tabs });

      if (text === sent) {
        return;
      }

      sent = text;
      send(text);
    };

    yield* Effect.acquireRelease(
      Effect.sync(() => setInterval(() => void sendTabs(), PAGE_POLL_MS)),
      (timer) => Effect.sync(() => clearInterval(timer)),
    );

    let lastPicture = "";
    let lastDetails = "";
    let changes = 0;
    let stillTimer: ReturnType<typeof setTimeout> | undefined;
    yield* Effect.addFinalizer(() => Effect.sync(() => clearTimeout(stillTimer)));

    const sendPicture = (details: string, picture: Uint8Array) => {
      send(details);
      Effect.runForkWith(services)(Effect.ignore(writer.write(picture)));
    };

    /** Sends a sharp picture of the page that the client watches, unless the page changed in the meantime. */
    const sendSharpPicture = async () => {
      const page = listed?.tabs.find((tab) => tab.active);
      if (page === undefined) {
        return;
      }

      const changesBefore = changes;
      const picture = await takeSharpPicture(devToolsPort(bot), page.targetId);
      if (picture === undefined || changes !== changesBefore) {
        return;
      }

      // The picture has no number, so the client does not ack it.
      sendPicture(lastDetails.replace(/"seq":\d+,/, ""), picture);
    };

    upstream.addEventListener("message", (event) => {
      const text = String(event.data);

      if (text.startsWith(FRAME_START)) {
        const pictureEnd = text.lastIndexOf('","metadata":');
        const picture = text.slice(FRAME_START.length, pictureEnd);
        const details = `{${text.slice(pictureEnd + 2)}`;

        // The browser sends the same picture again and again while the page is still. The client has it, so the ack comes from here.
        if (picture === lastPicture) {
          upstream.send(JSON.stringify({ type: "ack", seq: JSON.parse(details).seq }));

          return;
        }

        lastPicture = picture;
        lastDetails = details;
        changes += 1;
        sendPicture(details, Buffer.from(picture, "base64"));
        clearTimeout(stillTimer);
        stillTimer = setTimeout(() => void sendSharpPicture(), STILL_PAGE_MS);

        return;
      }

      // A frame is base64 inside quotes, so only a tabs message can hold this text.
      if (!text.includes('"type":"tabs"')) {
        send(text);

        return;
      }

      listed = JSON.parse(text);
      void sendTabs();
    });

    // The bot has no browser yet, or closed it. The client connects again later.
    const upstreamClosed = Effect.callback<void>((resume) => {
      upstream.addEventListener("close", () => resume(Effect.void));
      upstream.addEventListener("error", () => resume(Effect.void));
    });

    // The client asks for its frame rate as soon as its own socket opens, which is often before this one is.
    const early: Array<string> = [];
    upstream.addEventListener("open", () => early.splice(0).forEach((text) => upstream.send(text)));

    const forwardInput = Effect.gen(function* () {
      while (true) {
        for (const chunk of yield* reader.pull) {
          if (typeof chunk !== "string") {
            continue;
          }

          if (upstream.readyState === WebSocket.CONNECTING) {
            early.push(chunk);
          } else if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(chunk);
          }
        }
      }
    });

    yield* Effect.raceFirst(upstreamClosed, Effect.ignore(forwardInput));

    return HttpServerResponse.empty();
  }),
);
