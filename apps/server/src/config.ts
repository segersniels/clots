import { Context, Layer } from "effect";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { runtimePaths } from "./paths.ts";

/** The port of the operator's own clots server. */
export const DEFAULT_PORT = 4587;

/** The host settings of one clots server. */
export class ClotsConfig extends Context.Service<
  ClotsConfig,
  {
    /** The directory that holds the database and the working directories of the bots. */
    readonly home: string;
    readonly port: number;
    readonly claudePath: string;
    /** The built web client, or `undefined` when no build exists. */
    readonly webRoot: string | undefined;
    /**
     * The port of the Vite dev server, set only by `bun run dev` in the repository root, which also starts Vite. The sidecar then forwards to Vite,
     * so a device on the tailnet gets the client with hot reload. Vite forwards the API to this server.
     */
    readonly webDevPort: number | undefined;
    /** Whether the sidecar puts the server on the tailnet. `clots up --local` turns it off. */
    readonly tailnet: boolean;
  }
>()("clots/config/ClotsConfig") {
  static readonly layer = Layer.sync(ClotsConfig, () => {
    const claudePath = Bun.which("claude");

    // The operator installs Claude Code. clots does not bundle it.
    if (claudePath === null) throw new Error("clots: `claude` is not on PATH. Install Claude Code first.");

    const { webRoot } = runtimePaths;

    return ClotsConfig.of({
      home: process.env.CLOTS_HOME ?? join(homedir(), ".clots"),
      port: Number(process.env.CLOTS_PORT ?? DEFAULT_PORT),
      claudePath,
      webRoot: existsSync(webRoot) ? webRoot : undefined,
      webDevPort: process.env.CLOTS_WEB_DEV_PORT === undefined ? undefined : Number(process.env.CLOTS_WEB_DEV_PORT),
      tailnet: process.env.CLOTS_TAILNET !== "off",
    });
  });
}
