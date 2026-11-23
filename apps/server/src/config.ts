import { Context, Layer } from "effect";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  }
>()("clots/config/ClotsConfig") {
  static readonly layer = Layer.sync(ClotsConfig, () => {
    const claudePath = Bun.which("claude");

    // The operator installs Claude Code. clots does not bundle it.
    if (claudePath === null) throw new Error("clots: `claude` is not on PATH. Install Claude Code first.");

    const webRoot = join(import.meta.dir, "../../web/dist");

    return ClotsConfig.of({
      home: process.env.CLOTS_HOME ?? join(homedir(), ".clots"),
      port: Number(process.env.CLOTS_PORT ?? 4587),
      claudePath,
      webRoot: existsSync(webRoot) ? webRoot : undefined,
    });
  });
}
