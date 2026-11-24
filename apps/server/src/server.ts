import { RPC_PATH, ClotsRpcs } from "@clots/contracts";
import { BunHttpServer } from "@effect/platform-bun";
import { SqliteClient } from "@effect/sql-sqlite-bun";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpStaticServer } from "effect/http";
import { RpcSerialization, RpcServer } from "effect/rpc";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { AttachmentRouteLayer } from "./bots/AttachmentRoute.ts";
import { BotRepository } from "./bots/BotRepository.ts";
import { BotSessions } from "./bots/BotSessions.ts";
import { ensureBrowser } from "./browser/BrowserEnvironment.ts";
import { BrowserProxyLayer } from "./browser/BrowserProxy.ts";
import { ClotsConfig } from "./config.ts";
import { MigrationsLayer } from "./persistence/Migrations.ts";
import { ProjectRepository } from "./projects/ProjectRepository.ts";
import { HandlersLayer } from "./rpc/Handlers.ts";
import { ScheduleRepository } from "./schedules/ScheduleRepository.ts";
import { SchedulerLayer } from "./schedules/Scheduler.ts";
import { SidecarLayer } from "./sidecar/Sidecar.ts";

const SqlLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ClotsConfig;
    mkdirSync(config.home, { recursive: true });

    return MigrationsLayer.pipe(
      Layer.provideMerge(SqliteClient.layer({ filename: join(config.home, "clots.db") })),
    );
  }),
);

const ServicesLayer = Layer.mergeAll(SchedulerLayer, SidecarLayer, HandlersLayer).pipe(
  Layer.provideMerge(BotSessions.layer),
  Layer.provideMerge(Layer.mergeAll(BotRepository.layer, ScheduleRepository.layer, ProjectRepository.layer)),
  Layer.provide(SqlLayer),
);

const RpcLayer = RpcServer.layer(ClotsRpcs).pipe(
  Layer.provide(RpcServer.layerProtocolWebsocket({ path: RPC_PATH })),
  Layer.provide(RpcSerialization.layerJson),
);

/** Serves the built web client. The server also runs without a build, for example behind `vite dev`. */
const WebLayer = Layer.unwrap(
  Effect.gen(function* () {
    const { webRoot } = yield* ClotsConfig;
    if (webRoot === undefined) return Layer.empty;

    return HttpStaticServer.layer({ root: webRoot, spa: true });
  }),
);

/** The whole clots server. The sidecar is the only way in from another machine, so it binds to loopback. */
export const ServerLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ClotsConfig;

    // The download runs in the background, so the server answers at once.
    yield* Effect.forkDetach(ensureBrowser);

    return HttpRouter.serve(Layer.mergeAll(RpcLayer, BrowserProxyLayer, AttachmentRouteLayer, WebLayer), { disableLogger: true }).pipe(
      Layer.provide(ServicesLayer),
      Layer.provide(BunHttpServer.layer({ hostname: "127.0.0.1", port: config.port })),
    );
  }),
).pipe(Layer.provide(ClotsConfig.layer));
