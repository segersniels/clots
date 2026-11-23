import { Effect, Layer } from "effect";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ClotsConfig } from "../config.ts";

/** The sidecar binary that `bun run build` makes from `apps/sidecar`. */
const SIDECAR_BINARY = join(import.meta.dir, "../../../sidecar/clots-sidecar");

/** What the sidecar reports in `status.json`. The Go struct in `apps/sidecar/main.go` matches it. */
export interface SidecarStatus {
  readonly state: "needs_login" | "needs_https" | "ready";
  readonly authUrl?: string;
  readonly url?: string;
}

const stateDirectory = (home: string) => join(home, "tailscale");

/** Reads the last status that the sidecar wrote. Returns `undefined` before the first write. */
export const readSidecarStatus = (home: string): SidecarStatus | undefined => {
  try {
    return JSON.parse(readFileSync(join(stateDirectory(home), "status.json"), "utf8"));
  } catch {
    return undefined;
  }
};

export const sidecarIsBuilt = () => existsSync(SIDECAR_BINARY);

/** Runs the sidecar for as long as the server runs. Without a built sidecar, clots stays local. */
export const SidecarLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ClotsConfig;

    if (!sidecarIsBuilt()) {
      yield* Effect.logWarning("The sidecar is not built, so clots is reachable on this machine only.");

      return;
    }

    mkdirSync(stateDirectory(config.home), { recursive: true });

    yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.spawn(
          [SIDECAR_BINARY, "--state-dir", stateDirectory(config.home), "--upstream", `127.0.0.1:${config.port}`],
          { stdout: "inherit", stderr: "inherit" },
        ),
      ),
      (sidecar) => Effect.sync(() => sidecar.kill()),
    );
  }),
);
