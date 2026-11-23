import { BROWSER_STREAM_PATH, type BotId } from "@clots/contracts";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

import { BotRepository } from "../bots/BotRepository.ts";

/**
 * Relays a bot's agent-browser stream to a client. agent-browser accepts only loopback clients, so
 * the clots server is the bridge. Frames go to the client, and input and frame acks go back.
 */
export const BrowserProxyLayer = HttpRouter.add(
  "GET",
  `${BROWSER_STREAM_PATH}/:botId`,
  Effect.fn(function* (request) {
    const bots = yield* BotRepository;
    const { botId } = yield* HttpRouter.params;
    const bot = yield* bots.find(botId as BotId);
    if (bot === undefined) return HttpServerResponse.empty({ status: 404 });

    const socket = yield* request.upgrade;
    const writer = yield* socket.writer;
    const reader = yield* socket.reader;
    const services = yield* Effect.context();

    // The client acks each frame, so the browser never sends more than the link can carry.
    const upstream = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocket(`ws://127.0.0.1:${bot.browserStreamPort}/?pacing=ack&maxFps=10`)),
      (opened) => Effect.sync(() => opened.close()),
    );
    upstream.addEventListener("message", (event) => {
      Effect.runForkWith(services)(Effect.ignore(writer.write(String(event.data))));
    });

    // The bot has no browser yet, or closed it. The client connects again later.
    const upstreamClosed = Effect.callback<void>((resume) => {
      upstream.addEventListener("close", () => resume(Effect.void));
      upstream.addEventListener("error", () => resume(Effect.void));
    });

    const forwardInput = Effect.gen(function* () {
      while (true) {
        for (const chunk of yield* reader.pull) {
          if (typeof chunk === "string" && upstream.readyState === WebSocket.OPEN) upstream.send(chunk);
        }
      }
    });

    yield* Effect.raceFirst(upstreamClosed, Effect.ignore(forwardInput));

    return HttpServerResponse.empty();
  }),
);
