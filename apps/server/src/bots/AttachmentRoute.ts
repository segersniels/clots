import { ATTACHMENTS_PATH, type BotId } from "@clots/contracts";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { BotRepository } from "./BotRepository.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const notFound = HttpServerResponse.empty({ status: 404 });

/** Serves the bytes of an attachment, so that the thread can show the image or link the file. */
export const AttachmentRouteLayer = HttpRouter.add(
  "GET",
  `${ATTACHMENTS_PATH}/:botId/:attachmentId`,
  Effect.gen(function* () {
    const bots = yield* BotRepository;
    const { botId, attachmentId } = yield* HttpRouter.params;

    // The id becomes part of a file name lookup, so only a real id passes.
    if (attachmentId === undefined || !UUID.test(attachmentId)) return notFound;

    const bot = yield* bots.find(botId as BotId);
    if (bot === undefined) return notFound;

    const directory = join(bot.workingDirectory, "attachments");
    const file = yield* Effect.try(() => readdirSync(directory).find((name) => name.startsWith(attachmentId))).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (file === undefined) return notFound;

    return yield* HttpServerResponse.file(join(directory, file)).pipe(Effect.orElseSucceed(() => notFound));
  }),
);
