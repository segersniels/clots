import { BROWSER_STREAM_PATH, type BotId } from "@clots/contracts";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { BotRepository } from "../bots/BotRepository.ts";
import { BotSessions } from "../bots/BotSessions.ts";
import { readPages } from "./BotChrome.ts";
import { devToolsPort } from "./BrowserEnvironment.ts";

/** The time between two looks at the titles and addresses of the bot's pages while a client watches. */
const PAGE_POLL_MS = 500;

/** The tabs as agent-browser lists them, with the fields that clots takes from Chrome. */
interface TabList {
  readonly tabs: ReadonlyArray<{
    readonly targetId: string;
    readonly title: string;
    readonly url: string;
  }>;
}

/**
 * Relays a bot's agent-browser stream to a client. agent-browser accepts only loopback clients, so
 * the clots server is the bridge. Frames go to the client, and input and frame acks go back.
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

    upstream.addEventListener("message", (event) => {
      const text = String(event.data);

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
